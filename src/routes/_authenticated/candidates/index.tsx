import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Briefcase,
  CheckSquare,
  Download,
  FileSpreadsheet,
  Filter,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Upload,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AccessDenied, errorToAccessScreen } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { HubSubNav, RECRUITMENT_HUB_TABS } from "@/components/hub-subnav";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { actorQueryOptions, useActor } from "@/hooks/use-actor";
import { downloadCsv, toCsv } from "@/lib/csv";
import { sendBulkRecruitmentEmails } from "@/lib/email-center.functions";
import {
  CATEGORY_LABELS,
  USER_CATEGORIES,
  type UserCategory,
} from "@/lib/permissions";
import {
  applyCandidateColumnMapping,
  CANDIDATE_IMPORT_COLUMNS,
  CANDIDATE_TEMPLATE_SAMPLE_ROWS,
  type CandidateColumnMapping,
  type CandidateImportColumn,
  type ValidatedCandidateImportRow,
} from "@/lib/recruitment/candidate-import";
import { DEFAULT_EMAIL_TEMPLATES } from "@/lib/recruitment/email-templates";
import {
  CANDIDATE_PIPELINE_STAGES,
  CANDIDATE_SIDE_STATUSES,
  CANDIDATE_SOURCES,
  CANDIDATE_SOURCE_LABELS,
  CANDIDATE_STATUSES,
  CANDIDATE_STATUS_LABELS,
  type CandidateSource,
  type CandidateStatus,
} from "@/lib/recruitment/pipeline";
import {
  bulkUpdateCandidates,
  commitCandidateImport,
  listCandidateImportBatches,
  listCandidates,
  retryFailedCandidateImport,
  upsertCandidate,
  validateCandidateImportUpload,
  type CandidateImportRowOutcome,
} from "@/lib/recruitment.functions";
import { downloadXlsx } from "@/lib/xlsx-export";

export const Route = createFileRoute("/_authenticated/candidates/")({
  head: () => ({
    meta: [
      { title: "Candidates & Recruitment | The AI School HRM" },
      {
        name: "description",
        content:
          "Manage candidate applications, pipeline stages, CSV/Excel candidate imports, and hiring conversions.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(actorQueryOptions),
  component: CandidatesPage,
  errorComponent: ({ error }) => errorToAccessScreen(error),
});

const STATUS_BADGE_CLASS: Record<CandidateStatus, string> = {
  applied: "border-border bg-muted/50 text-foreground",
  screening: "border-info/40 bg-info/10 text-info",
  shortlisted: "border-primary/40 bg-primary/10 text-primary",
  interview_scheduled: "border-warning/40 bg-warning/10 text-warning",
  interviewed: "border-info/40 bg-info/10 text-info",
  selected: "border-success/40 bg-success/10 text-success",
  offer_sent: "border-primary/40 bg-primary/10 text-primary",
  offer_accepted: "border-success/50 bg-success/15 text-success",
  onboarding: "border-success/60 bg-success/20 text-success",
  rejected: "border-destructive/40 bg-destructive/10 text-destructive",
  on_hold: "border-warning/40 bg-warning/10 text-warning",
  withdrawn: "border-border bg-muted text-muted-foreground",
};

function CandidatesPage() {
  useSuspenseQuery(actorQueryOptions);
  const actor = useActor();
  const queryClient = useQueryClient();

  const canRead = actor.can("recruitment:read:all");
  const canManage = actor.can("recruitment:manage:all");
  const canSendEmail = actor.can("emails:send:all");

  const candidatesQuery = useQuery({
    queryKey: ["recruitment", "candidates"],
    queryFn: () => listCandidates(),
    enabled: canRead,
  });

  const batchesQuery = useQuery({
    queryKey: ["recruitment", "import-batches"],
    queryFn: () => listCandidateImportBatches(),
    enabled: canRead,
  });

  const [activeTab, setActiveTab] = useState<"pipeline" | "import">("pipeline");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [hrFilter, setHrFilter] = useState<string>("all");

  // Selection & bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState<string>("");
  const [bulkHrId, setBulkHrId] = useState<string>("");
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkEmailOpen, setBulkEmailOpen] = useState(false);
  const [bulkTemplateSlug, setBulkTemplateSlug] = useState<string>("candidate_shortlisted");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [importConfirmOpen, setImportConfirmOpen] = useState(false);

  // Add Candidate dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [savingCandidate, setSavingCandidate] = useState(false);
  const [draft, setDraft] = useState({
    fullName: "",
    email: "",
    phone: "",
    departmentId: "",
    designation: "",
    appliedCategory: "full_time" as UserCategory,
    source: "direct" as CandidateSource,
    experienceYears: "",
    currentCompany: "",
    expectedCtc: "",
    noticePeriodDays: "",
    availableJoiningDate: "",
    location: "",
    skills: "",
    linkedinUrl: "",
    assignedHrId: "",
    notesSummary: "",
  });

  // CSV / Excel Candidate Import state
  const [importFileName, setImportFileName] = useState("");
  const [rawGrid, setRawGrid] = useState<(string | number | null)[][]>([]);
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<CandidateColumnMapping>({});
  const [previewRows, setPreviewRows] = useState<ValidatedCandidateImportRow[] | null>(null);
  const [previewSummary, setPreviewSummary] = useState<{
    total: number;
    valid: number;
    warning: number;
    duplicate: number;
    invalid: number;
    importable: number;
  } | null>(null);
  const [importRowFilter, setImportRowFilter] = useState<
    "all" | "valid" | "warning" | "duplicate" | "error"
  >("all");
  const [importBusy, setImportBusy] = useState(false);
  const [commitReport, setCommitReport] = useState<{
    batchId: string;
    importedCount: number;
    duplicateCount: number;
    invalidCount: number;
    failedCount: number;
    outcomes: CandidateImportRowOutcome[];
  } | null>(null);

  if (!canRead) {
    return (
      <AccessDenied
        kind="forbidden"
        detail="Candidate management is restricted to HR, Super Admin, and authorized read-only oversight roles."
      />
    );
  }

  const data = candidatesQuery.data;
  const allCandidates = data?.candidates ?? [];
  const kpis = data?.kpis;

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of allCandidates) {
      counts[c.status] = (counts[c.status] ?? 0) + 1;
    }
    return counts;
  }, [allCandidates]);

  const hasActiveFilters =
    search.trim().length > 0 ||
    statusFilter !== "all" ||
    deptFilter !== "all" ||
    sourceFilter !== "all" ||
    hrFilter !== "all";

  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allCandidates.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (deptFilter !== "all" && (c.department_id ?? "none") !== deptFilter) return false;
      if (sourceFilter !== "all" && c.source !== sourceFilter) return false;
      if (hrFilter !== "all" && (c.assigned_hr_id ?? "none") !== hrFilter) return false;
      if (!q) return true;
      return (
        c.full_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.candidate_code.toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q) ||
        (c.designation ?? "").toLowerCase().includes(q) ||
        (c.skills ?? []).some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [allCandidates, search, statusFilter, deptFilter, sourceFilter, hrFilter]);

  const visibleImportRows = useMemo(() => {
    if (!previewRows) return [];
    if (importRowFilter === "all") return previewRows;
    return previewRows.filter((r) => r.severity === importRowFilter);
  }, [previewRows, importRowFilter]);

  function toggleSelectAll(checked: boolean) {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(filteredCandidates.map((c) => c.id)));
  }

  function toggleOne(id: string, checked: boolean) {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
  }

  async function handleCreateCandidate(e: React.FormEvent) {
    e.preventDefault();
    setSavingCandidate(true);
    try {
      const res = await upsertCandidate({
        data: {
          fullName: draft.fullName,
          email: draft.email,
          phone: draft.phone || null,
          departmentId: draft.departmentId || null,
          designation: draft.designation || null,
          appliedCategory: draft.appliedCategory,
          source: draft.source,
          experienceYears: draft.experienceYears ? Number(draft.experienceYears) : null,
          currentCompany: draft.currentCompany || null,
          expectedCtc: draft.expectedCtc || null,
          noticePeriodDays: draft.noticePeriodDays ? Number(draft.noticePeriodDays) : null,
          availableJoiningDate: draft.availableJoiningDate || null,
          location: draft.location || null,
          skills: draft.skills
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          linkedinUrl: draft.linkedinUrl || null,
          assignedHrId: draft.assignedHrId || null,
          notesSummary: draft.notesSummary || null,
        },
      });
      toast.success(`Added candidate ${res.candidateCode}`);
      setCreateOpen(false);
      setDraft({
        fullName: "",
        email: "",
        phone: "",
        departmentId: "",
        designation: "",
        appliedCategory: "full_time",
        source: "direct",
        experienceYears: "",
        currentCompany: "",
        expectedCtc: "",
        noticePeriodDays: "",
        availableJoiningDate: "",
        location: "",
        skills: "",
        linkedinUrl: "",
        assignedHrId: "",
        notesSummary: "",
      });
      await queryClient.invalidateQueries({ queryKey: ["recruitment", "candidates"] });
      await queryClient.invalidateQueries({ queryKey: ["role-dashboard"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save candidate.");
    } finally {
      setSavingCandidate(false);
    }
  }

  async function runBulkStageOrHrUpdate() {
    if (selectedIds.size === 0) return;
    if (!bulkStage && !bulkHrId) {
      toast.error("Select a stage or HR owner to apply.");
      return;
    }
    setBulkBusy(true);
    try {
      const res = await bulkUpdateCandidates({
        data: {
          candidateIds: Array.from(selectedIds),
          ...(bulkStage ? { toStatus: bulkStage } : {}),
          ...(bulkHrId ? { assignedHrId: bulkHrId === "unassign" ? null : bulkHrId } : {}),
        },
      });
      toast.success(
        `Updated ${res.updatedCount} candidate(s)` +
          (res.skippedCount > 0 ? ` (${res.skippedCount} skipped due to stage rules)` : ""),
      );
      setSelectedIds(new Set());
      setBulkStage("");
      setBulkHrId("");
      await queryClient.invalidateQueries({ queryKey: ["recruitment", "candidates"] });
      await queryClient.invalidateQueries({ queryKey: ["role-dashboard"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bulk update failed.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function runBulkEmailSend() {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const res = await sendBulkRecruitmentEmails({
        data: {
          candidateIds: Array.from(selectedIds),
          templateSlug: bulkTemplateSlug,
        },
      });
      toast.success(
        `Bulk dispatch complete: ${res.sentCount} sent, ${res.skippedDuplicateCount} duplicate(s) skipped, ${res.failedCount} failed.`,
      );
      setBulkEmailOpen(false);
      setSelectedIds(new Set());
      await queryClient.invalidateQueries({ queryKey: ["recruitment", "candidates"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bulk email send failed.");
    } finally {
      setBulkBusy(false);
    }
  }

  function downloadCandidateTemplate(format: "csv" | "xlsx") {
    if (format === "csv") {
      downloadCsv(
        "candidate_import_template.csv",
        toCsv(
          CANDIDATE_TEMPLATE_SAMPLE_ROWS,
          CANDIDATE_IMPORT_COLUMNS.map((col) => ({
            key: col,
            header: col,
            value: (r: Record<CandidateImportColumn, string>) => r[col],
          })),
        ),
      );
    } else {
      void downloadXlsx(
        "candidate_import_template.xlsx",
        "Candidates",
        CANDIDATE_TEMPLATE_SAMPLE_ROWS,
      );
    }
  }

  async function runValidationOnGrid(
    grid: (string | number | null)[][],
    fileName: string,
    customMapping?: CandidateColumnMapping,
  ) {
    const mapped = applyCandidateColumnMapping(grid, customMapping);
    setSheetHeaders(mapped.headers);
    setColumnMapping(mapped.mapping);
    if (mapped.rows.length === 0) {
      throw new Error("No candidate rows found in the uploaded file.");
    }
    const validated = await validateCandidateImportUpload({
      data: {
        fileName,
        rows: mapped.rows,
        columnMapping: mapped.mapping,
      },
    });
    setPreviewRows(validated.rows as ValidatedCandidateImportRow[]);
    setPreviewSummary(validated.summary);
  }

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportBusy(true);
    setCommitReport(null);
    try {
      const XLSX = await import("xlsx");
      const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
      const workbook = isCsv
        ? XLSX.read(await file.text(), { type: "string", raw: true })
        : XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("Workbook contains no sheets.");
      const grid = (
        XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]!, {
          header: 1,
          blankrows: false,
          raw: true,
          defval: "",
        }) as (string | number | Date | null)[][]
      ).map((row) =>
        row.map((cell) => {
          if (!(cell instanceof Date)) return cell;
          return new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kolkata",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(cell);
        }),
      );
      setImportFileName(file.name);
      setRawGrid(grid);
      await runValidationOnGrid(grid, file.name);
      setImportRowFilter("all");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not parse candidate file.");
    } finally {
      event.target.value = "";
      setImportBusy(false);
    }
  }

  async function handleRemapColumn(col: CandidateImportColumn, sourceHeader: string) {
    const nextMapping: CandidateColumnMapping = { ...columnMapping };
    if (sourceHeader === "__none__") {
      delete nextMapping[col];
    } else {
      nextMapping[col] = sourceHeader;
    }
    setImportBusy(true);
    try {
      await runValidationOnGrid(rawGrid, importFileName, nextMapping);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Re-mapping failed.");
    } finally {
      setImportBusy(false);
    }
  }

  async function handleCommitImport() {
    if (!rawGrid.length || !previewSummary || previewSummary.importable === 0) return;
    setImportBusy(true);
    try {
      const mapped = applyCandidateColumnMapping(rawGrid, columnMapping);
      const res = await commitCandidateImport({
        data: {
          fileName: importFileName,
          rows: mapped.rows,
          columnMapping,
        },
      });
      setCommitReport({
        batchId: res.batchId,
        importedCount: res.importedCount,
        duplicateCount: res.duplicateCount,
        invalidCount: res.invalidCount,
        failedCount: res.failedCount,
        outcomes: res.outcomes,
      });
      toast.success(
        `Imported ${res.importedCount} candidate(s). Skipped ${res.duplicateCount} duplicate(s) & ${res.invalidCount} invalid row(s).`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["recruitment", "candidates"] }),
        queryClient.invalidateQueries({ queryKey: ["recruitment", "import-batches"] }),
        queryClient.invalidateQueries({ queryKey: ["role-dashboard"] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Candidate import failed.");
    } finally {
      setImportBusy(false);
    }
  }

  async function handleRetryBatch(batchId: string) {
    setImportBusy(true);
    try {
      const res = await retryFailedCandidateImport({ data: { batchId } });
      toast.success(
        `Recovered ${res.recovered} row(s). Remaining failed: ${res.remainingFailed}.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["recruitment", "candidates"] }),
        queryClient.invalidateQueries({ queryKey: ["recruitment", "import-batches"] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Retry failed.");
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <AppShell
      title="Candidates & Recruitment Pipeline"
      description="Track applicants from Applied to Offer Accepted & Employee Onboarding"
      actions={
        canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveTab("import")}
            >
              <FileSpreadsheet className="mr-1.5 size-4" />
              Import CSV / Excel
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 size-4" />
              Add Candidate
            </Button>
          </div>
        ) : undefined
      }
    >
      <HubSubNav tabs={RECRUITMENT_HUB_TABS} />

      {data && !data.schemaReady && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-warning/50 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="font-semibold text-foreground">
              Phase P2 Database Migration Pending Approval
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The versioned SQL migration{" "}
              <code className="font-mono">
                20261112000000_p2_recruitment_interviews_and_email_center.sql
              </code>{" "}
              is prepared locally and has not been applied to production yet. Once approved and
              applied, candidate records, imports, interviews, and email logs will persist live.
            </p>
          </div>
        </div>
      )}

      {/* 8 Real DB-backed Recruitment KPIs */}
      {kpis && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-8">
          {[
            { label: "Total Candidates", value: kpis.totalCandidates },
            { label: "New Applications", value: kpis.newApplications },
            { label: "Shortlisted", value: kpis.shortlistedCandidates },
            { label: "Interviews Sched.", value: kpis.interviewsScheduled },
            { label: "Selected", value: kpis.selectedCandidates },
            { label: "Offers Sent", value: kpis.offersSent },
            { label: "Pending Onboarding", value: kpis.pendingOnboarding },
            { label: "Conversion Rate", value: `${kpis.conversionRatePct}%` },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-lg border border-border bg-card px-3 py-2.5"
            >
              <p className="leading-tight text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {item.label}
              </p>
              <p className="mt-1 font-mono text-lg font-bold text-foreground">{item.value}</p>
            </div>
          ))}
        </div>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "pipeline" | "import")}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="pipeline">
            <Users className="mr-1.5 size-4" />
            Candidate Pipeline ({allCandidates.length})
          </TabsTrigger>
          {canManage && (
            <TabsTrigger value="import">
              <FileSpreadsheet className="mr-1.5 size-4" />
              CSV / Excel Candidate Import
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="pipeline" className="space-y-4">
          {/* Interactive Pipeline Stage Funnel Strip */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Pipeline stage filter">
            <button
              type="button"
              aria-pressed={statusFilter === "all"}
              onClick={() => setStatusFilter("all")}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                statusFilter === "all"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-muted/60"
              }`}
            >
              All Stages
              <span className="font-mono text-[11px] opacity-80">({allCandidates.length})</span>
            </button>
            {[...CANDIDATE_PIPELINE_STAGES, ...CANDIDATE_SIDE_STATUSES].map((st) => {
              const count = stageCounts[st] ?? 0;
              const active = statusFilter === st;
              return (
                <button
                  key={st}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter(active ? "all" : st)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  {CANDIDATE_STATUS_LABELS[st]}
                  <span className="font-mono text-[11px] opacity-80">({count})</span>
                </button>
              );
            })}
          </div>

          {/* Search & Filters */}
          <Card>
            <CardContent className="pt-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <div className="relative sm:col-span-2">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    aria-label="Search candidates"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, code, email, phone, designation, skills..."
                    className="pl-8"
                  />
                </div>
                <select
                  aria-label="Filter by stage"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All Pipeline Stages</option>
                  {CANDIDATE_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {CANDIDATE_STATUS_LABELS[st]}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter by department"
                  value={deptFilter}
                  onChange={(e) => setDeptFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All Departments</option>
                  {(data?.departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                  <option value="none">Unassigned Department</option>
                </select>
                <select
                  aria-label="Filter by source"
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All Sources</option>
                  {CANDIDATE_SOURCES.map((src) => (
                    <option key={src} value={src}>
                      {CANDIDATE_SOURCE_LABELS[src]}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter by HR"
                  value={hrFilter}
                  onChange={(e) => setHrFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All HR Owners</option>
                  {(data?.hrUsers ?? []).map((hr) => (
                    <option key={hr.id} value={hr.id}>
                      {hr.fullName}
                    </option>
                  ))}
                </select>
              </div>
              {hasActiveFilters && (
                <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
                  <span>
                    Showing <strong className="text-foreground">{filteredCandidates.length}</strong>{" "}
                    of {allCandidates.length} candidate(s)
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearch("");
                      setStatusFilter("all");
                      setDeptFilter("all");
                      setSourceFilter("all");
                      setHrFilter("all");
                    }}
                  >
                    Reset filters
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Bulk Action Bar */}
          {canManage && selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <CheckSquare className="size-4 text-primary" />
                <span>{selectedIds.size} candidate(s) selected</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Bulk stage"
                  value={bulkStage}
                  onChange={(e) => setBulkStage(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2.5 text-xs"
                >
                  <option value="">Move to stage...</option>
                  {CANDIDATE_STATUSES.filter((s) => s !== "onboarding").map((st) => (
                    <option key={st} value={st}>
                      {CANDIDATE_STATUS_LABELS[st]}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Bulk HR owner"
                  value={bulkHrId}
                  onChange={(e) => setBulkHrId(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2.5 text-xs"
                >
                  <option value="">Assign HR rep...</option>
                  {(data?.hrUsers ?? []).map((hr) => (
                    <option key={hr.id} value={hr.id}>
                      {hr.fullName}
                    </option>
                  ))}
                  <option value="unassign">Unassign HR</option>
                </select>
                <Button
                  size="sm"
                  disabled={bulkBusy || (!bulkStage && !bulkHrId)}
                  onClick={() => setBulkConfirmOpen(true)}
                >
                  Apply Bulk Update
                </Button>
                {canSendEmail && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={bulkBusy}
                    onClick={() => setBulkEmailOpen(true)}
                  >
                    <Mail className="mr-1.5 size-3.5" />
                    Bulk Email
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear
                </Button>
              </div>
            </div>
          )}

          {/* Candidate Table */}
          <Card>
            <CardContent className="p-0">
              {candidatesQuery.isLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Loading candidates...
                </div>
              ) : filteredCandidates.length === 0 ? (
                <div className="p-10 text-center">
                  <Briefcase className="mx-auto size-8 text-muted-foreground/60" />
                  <p className="mt-2 font-medium text-foreground">No candidates match your view</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {canManage
                      ? "Add a candidate manually or import a CSV / Excel candidate sheet."
                      : "No candidate applications are recorded for the selected filters yet."}
                  </p>
                </div>
              ) : (
                <>
                  {/* Mobile Candidate Cards */}
                  <div className="divide-y divide-border md:hidden">
                    {filteredCandidates.map((cand) => {
                      const st = cand.status as CandidateStatus;
                      return (
                        <div key={cand.id} className="space-y-2.5 p-4 text-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2.5 min-w-0">
                              {canManage && (
                                <Checkbox
                                  checked={selectedIds.has(cand.id)}
                                  onCheckedChange={(v) => toggleOne(cand.id, Boolean(v))}
                                  aria-label={`Select ${cand.full_name}`}
                                  className="mt-1"
                                />
                              )}
                              <div className="min-w-0">
                                <span className="font-mono text-xs text-muted-foreground">
                                  {cand.candidate_code}
                                </span>
                                <Link
                                  to="/candidates/$candidateId"
                                  params={{ candidateId: cand.id }}
                                  className="block truncate font-semibold text-foreground hover:text-primary hover:underline"
                                >
                                  {cand.full_name}
                                </Link>
                                <p className="truncate text-xs text-muted-foreground">
                                  {cand.email}
                                </p>
                              </div>
                            </div>
                            <Badge
                              variant="outline"
                              className={`shrink-0 ${STATUS_BADGE_CLASS[st] ?? ""}`}
                            >
                              {CANDIDATE_STATUS_LABELS[st] ?? cand.status}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>
                              <strong className="text-foreground">{cand.designation ?? "—"}</strong>{" "}
                              · {cand.departmentName ?? "No dept"} · HR:{" "}
                              {cand.assignedHrName ?? "Unassigned"}
                            </span>
                            <Button asChild variant="outline" size="sm">
                              <Link
                                to="/candidates/$candidateId"
                                params={{ candidateId: cand.id }}
                              >
                                Open Profile
                              </Link>
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Desktop Candidate Table */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <tr>
                          {canManage && (
                            <th scope="col" className="w-10 px-4 py-3">
                              <Checkbox
                                checked={
                                  filteredCandidates.length > 0 &&
                                  filteredCandidates.every((c) => selectedIds.has(c.id))
                                }
                                onCheckedChange={(v) => toggleSelectAll(Boolean(v))}
                                aria-label="Select all visible candidates"
                              />
                            </th>
                          )}
                          <th scope="col" className="px-4 py-3">Candidate</th>
                          <th scope="col" className="px-4 py-3">Role &amp; Department</th>
                          <th scope="col" className="px-4 py-3">Stage</th>
                          <th scope="col" className="px-4 py-3">Source</th>
                          <th scope="col" className="px-4 py-3">Assigned HR</th>
                          <th scope="col" className="px-4 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {filteredCandidates.map((cand) => {
                          const st = cand.status as CandidateStatus;
                          return (
                            <tr key={cand.id} className="hover:bg-muted/25">
                              {canManage && (
                                <td className="px-4 py-3">
                                  <Checkbox
                                    checked={selectedIds.has(cand.id)}
                                    onCheckedChange={(v) => toggleOne(cand.id, Boolean(v))}
                                    aria-label={`Select ${cand.full_name}`}
                                  />
                                </td>
                              )}
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs text-muted-foreground">
                                    {cand.candidate_code}
                                  </span>
                                  <Link
                                    to="/candidates/$candidateId"
                                    params={{ candidateId: cand.id }}
                                    className="font-medium text-foreground hover:text-primary hover:underline"
                                  >
                                    {cand.full_name}
                                  </Link>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {cand.email}
                                  {cand.phone ? ` · ${cand.phone}` : ""}
                                </p>
                              </td>
                              <td className="px-4 py-3">
                                <p className="font-medium text-foreground">
                                  {cand.designation ?? "—"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {cand.departmentName ?? "No dept"} ·{" "}
                                  {CATEGORY_LABELS[cand.applied_category] ?? cand.applied_category}
                                </p>
                              </td>
                              <td className="px-4 py-3">
                                <Badge
                                  variant="outline"
                                  className={STATUS_BADGE_CLASS[st] ?? ""}
                                >
                                  {CANDIDATE_STATUS_LABELS[st] ?? cand.status}
                                </Badge>
                                {cand.upcomingInterviewsCount > 0 && (
                                  <p className="mt-0.5 text-[11px] text-warning">
                                    {cand.upcomingInterviewsCount} upcoming interview(s)
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3 text-xs text-muted-foreground">
                                {CANDIDATE_SOURCE_LABELS[cand.source as CandidateSource] ??
                                  cand.source}
                              </td>
                              <td className="px-4 py-3 text-xs">
                                {cand.assignedHrName ?? "Unassigned"}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Button asChild variant="outline" size="sm">
                                  <Link
                                    to="/candidates/$candidateId"
                                    params={{ candidateId: cand.id }}
                                  >
                                    Open Profile
                                  </Link>
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: CSV / Excel Candidate Import (strictly separate from employee /roster-import) */}
        {canManage && (
          <TabsContent value="import" className="space-y-5">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="font-display text-base font-semibold">
                      Bulk Candidate Import (CSV / Excel)
                    </CardTitle>
                    <CardDescription>
                      Import applicant sheets into the Recruitment Pipeline. Completely isolated
                      from employee roster onboarding — zero auth accounts are created until a
                      selected candidate is explicitly converted.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadCandidateTemplate("csv")}
                    >
                      <Download className="mr-1.5 size-4" />
                      CSV Template
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadCandidateTemplate("xlsx")}
                    >
                      <Download className="mr-1.5 size-4" />
                      Excel Template
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-border p-4">
                  <Upload className="size-5 text-primary" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-foreground">
                      Upload a `.csv` or `.xlsx` applicant file
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Detects duplicates within the file, existing candidates, active employees, and
                      pending invitations before writing anything.
                    </p>
                  </div>
                  <Input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    disabled={importBusy}
                    onChange={handleImportFile}
                    className="max-w-xs cursor-pointer"
                  />
                </div>

                {/* Column Mapping Controls */}
                {sheetHeaders.length > 0 && (
                  <div className="rounded-lg border border-border bg-muted/20 p-4">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Filter className="size-3.5" />
                      Column Mapping ({importFileName})
                    </div>
                    <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                      {CANDIDATE_IMPORT_COLUMNS.map((col) => {
                        const isRequired = col === "Full Name" || col === "Email";
                        const isMissingRequired = isRequired && !columnMapping[col];
                        return (
                          <div key={col} className="space-y-1">
                            <label className="block text-[11px] font-medium text-foreground">
                              {col}
                              {isRequired && <span className="text-destructive"> *</span>}
                            </label>
                            <select
                              aria-label={`Map column ${col}`}
                              value={columnMapping[col] ?? "__none__"}
                              onChange={(e) => handleRemapColumn(col, e.target.value)}
                              className={`h-8 w-full rounded border bg-background px-2 text-xs ${
                                isMissingRequired
                                  ? "border-warning bg-warning/5 text-foreground"
                                  : "border-input"
                              }`}
                            >
                              <option value="__none__">— Not mapped —</option>
                              {sheetHeaders.map((h) => (
                                <option key={h} value={h}>
                                  {h}
                                </option>
                              ))}
                            </select>
                            {isMissingRequired && (
                              <p className="text-[11px] font-medium text-warning">
                                Required column unmapped
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Validation Summary & Row Preview */}
                {previewSummary && previewRows && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
                      <div className="flex flex-wrap gap-2 text-xs">
                        {(
                          [
                            { id: "all", label: `All (${previewSummary.total})` },
                            { id: "valid", label: `Valid (${previewSummary.valid})` },
                            { id: "warning", label: `Warnings (${previewSummary.warning})` },
                            { id: "duplicate", label: `Duplicates (${previewSummary.duplicate})` },
                            { id: "error", label: `Invalid (${previewSummary.invalid})` },
                          ] as const
                        ).map((f) => (
                          <Button
                            key={f.id}
                            size="sm"
                            aria-pressed={importRowFilter === f.id}
                            variant={importRowFilter === f.id ? "default" : "outline"}
                            onClick={() => setImportRowFilter(f.id)}
                          >
                            {f.label}
                          </Button>
                        ))}
                      </div>
                      <Button
                        disabled={importBusy || previewSummary.importable === 0}
                        onClick={() => setImportConfirmOpen(true)}
                      >
                        {importBusy
                          ? "Importing..."
                          : `Import ${previewSummary.importable} Valid Candidate(s)`}
                      </Button>
                    </div>

                    <div className="max-h-96 overflow-auto rounded-lg border border-border">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted text-left uppercase tracking-wider text-muted-foreground">
                          <tr>
                            <th scope="col" className="px-3 py-2">Row</th>
                            <th scope="col" className="px-3 py-2">Name &amp; Email</th>
                            <th scope="col" className="px-3 py-2">Designation / Dept</th>
                            <th scope="col" className="px-3 py-2">Category / Source</th>
                            <th scope="col" className="px-3 py-2">Validation Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {visibleImportRows.map((row) => (
                            <tr key={row.rowNumber}>
                              <td className="px-3 py-2 font-mono">{row.rowNumber}</td>
                              <td className="px-3 py-2">
                                <p className="font-medium text-foreground">
                                  {row.fullName || "—"}
                                </p>
                                <p className="text-muted-foreground">{row.email || "—"}</p>
                              </td>
                              <td className="px-3 py-2">
                                {row.designation ?? "—"} · {row.departmentName ?? "No dept"}
                              </td>
                              <td className="px-3 py-2">
                                {row.appliedCategory} · {row.source}
                              </td>
                              <td className="px-3 py-2">
                                {row.severity === "valid" && (
                                  <Badge variant="outline" className="border-success/40 text-success">
                                    Ready
                                  </Badge>
                                )}
                                {row.severity === "warning" && (
                                  <div className="space-y-0.5 text-warning">
                                    <Badge variant="outline" className="border-warning/40 text-warning">
                                      Warning (Importable)
                                    </Badge>
                                    <p>{row.warnings.join(" ")}</p>
                                  </div>
                                )}
                                {row.severity === "duplicate" && (
                                  <div className="space-y-0.5 text-destructive">
                                    <Badge variant="outline" className="border-destructive/40 text-destructive">
                                      Duplicate ({row.duplicateSource})
                                    </Badge>
                                    <p>{row.errors.join(" ")}</p>
                                  </div>
                                )}
                                {row.severity === "error" && (
                                  <div className="space-y-0.5 text-destructive">
                                    <Badge variant="outline" className="border-destructive/40 text-destructive">
                                      Invalid Row
                                    </Badge>
                                    <p>{row.errors.join(" ")}</p>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {commitReport && (
                  <div className="rounded-lg border border-success/40 bg-success/10 p-4 text-xs">
                    <p className="font-semibold text-foreground">
                      Partial Import Completed — {commitReport.importedCount} imported,{" "}
                      {commitReport.duplicateCount} duplicate(s) skipped,{" "}
                      {commitReport.invalidCount} invalid row(s) skipped,{" "}
                      {commitReport.failedCount} DB error(s).
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Import Batch History & Safe Retry */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="font-display text-base font-semibold">
                  Candidate Import History
                </CardTitle>
                <CardDescription>
                  Audit log of previous CSV / Excel candidate imports with safe retry for failed rows
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(batchesQuery.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">No candidate import batches yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th scope="col" className="pb-2 pr-3">File</th>
                          <th scope="col" className="pb-2 pr-3">Total</th>
                          <th scope="col" className="pb-2 pr-3">Imported</th>
                          <th scope="col" className="pb-2 pr-3">Duplicates</th>
                          <th scope="col" className="pb-2 pr-3">Invalid</th>
                          <th scope="col" className="pb-2 pr-3">Failed</th>
                          <th scope="col" className="pb-2 pr-3">Date</th>
                          <th scope="col" className="pb-2 text-right">Retry</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {(batchesQuery.data ?? []).map((b) => (
                          <tr key={b.id}>
                            <td className="py-2 pr-3 font-medium">{b.file_name}</td>
                            <td className="py-2 pr-3 font-mono">{b.total_rows}</td>
                            <td className="py-2 pr-3 font-mono text-success">{b.imported_count}</td>
                            <td className="py-2 pr-3 font-mono text-warning">{b.duplicate_count}</td>
                            <td className="py-2 pr-3 font-mono text-muted-foreground">
                              {b.invalid_count}
                            </td>
                            <td className="py-2 pr-3 font-mono text-destructive">
                              {b.failed_count}
                            </td>
                            <td className="py-2 pr-3 font-mono text-muted-foreground">
                              {b.created_at.slice(0, 16).replace("T", " ")}
                            </td>
                            <td className="py-2 text-right">
                              {b.failed_count > 0 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={importBusy}
                                  onClick={() => handleRetryBatch(b.id)}
                                >
                                  <RefreshCw className="mr-1 size-3" />
                                  Retry Failed
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Add Candidate Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Candidate</DialogTitle>
            <DialogDescription>
              Create a new candidate profile in the Recruitment Pipeline (stage starts at Applied).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateCandidate} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="add-cand-name">Full Name *</Label>
                <Input
                  id="add-cand-name"
                  required
                  value={draft.fullName}
                  onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
                  placeholder="Ananya Krishnan"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-cand-email">Email Address *</Label>
                <Input
                  id="add-cand-email"
                  required
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  placeholder="candidate@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-cand-phone">Phone</Label>
                <Input
                  id="add-cand-phone"
                  value={draft.phone}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  placeholder="+91 98765 43210"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-cand-designation">Designation</Label>
                <Input
                  id="add-cand-designation"
                  value={draft.designation}
                  onChange={(e) => setDraft({ ...draft, designation: e.target.value })}
                  placeholder="AI Trainer / Engineer"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-cand-dept">Department</Label>
                <select
                  id="add-cand-dept"
                  value={draft.departmentId}
                  onChange={(e) => setDraft({ ...draft, departmentId: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Unassigned</option>
                  {(data?.departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-cand-category">Employment Category</Label>
                <select
                  id="add-cand-category"
                  value={draft.appliedCategory}
                  onChange={(e) =>
                    setDraft({ ...draft, appliedCategory: e.target.value as UserCategory })
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {USER_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-cand-source">Application Source</Label>
                <select
                  id="add-cand-source"
                  value={draft.source}
                  onChange={(e) =>
                    setDraft({ ...draft, source: e.target.value as CandidateSource })
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {CANDIDATE_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {CANDIDATE_SOURCE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-cand-hr">Assigned HR Representative</Label>
                <select
                  id="add-cand-hr"
                  value={draft.assignedHrId}
                  onChange={(e) => setDraft({ ...draft, assignedHrId: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Assign to me</option>
                  {(data?.hrUsers ?? []).map((hr) => (
                    <option key={hr.id} value={hr.id}>
                      {hr.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-cand-exp">Experience (Years)</Label>
                <Input
                  id="add-cand-exp"
                  type="number"
                  step="0.5"
                  min="0"
                  max="60"
                  value={draft.experienceYears}
                  onChange={(e) => setDraft({ ...draft, experienceYears: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-cand-joining">Available Joining Date</Label>
                <Input
                  id="add-cand-joining"
                  type="date"
                  value={draft.availableJoiningDate}
                  onChange={(e) => setDraft({ ...draft, availableJoiningDate: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-cand-company">Current Company</Label>
                <Input
                  id="add-cand-company"
                  value={draft.currentCompany}
                  onChange={(e) => setDraft({ ...draft, currentCompany: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-cand-ctc">Expected CTC</Label>
                <Input
                  id="add-cand-ctc"
                  value={draft.expectedCtc}
                  onChange={(e) => setDraft({ ...draft, expectedCtc: e.target.value })}
                  placeholder="e.g. 10 LPA"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="add-cand-skills">Skills (comma-separated)</Label>
                <Input
                  id="add-cand-skills"
                  value={draft.skills}
                  onChange={(e) => setDraft({ ...draft, skills: e.target.value })}
                  placeholder="Python, Prompt Engineering, Data QA"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="add-cand-notes">Initial Screening Notes</Label>
                <Textarea
                  id="add-cand-notes"
                  rows={2}
                  value={draft.notesSummary}
                  onChange={(e) => setDraft({ ...draft, notesSummary: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingCandidate}>
                {savingCandidate ? "Saving..." : "Create Candidate"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bulk Stage / HR Update Confirmation */}
      <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Update {selectedIds.size} Selected Candidate(s)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkStage
                ? `Moves eligible candidates to "${CANDIDATE_STATUS_LABELS[bulkStage as CandidateStatus] ?? bulkStage}". `
                : ""}
              {bulkHrId
                ? bulkHrId === "unassign"
                  ? "Unassigns the HR representative. "
                  : "Updates the assigned HR representative. "
                : ""}
              Candidates whose current stage does not permit this transition will be safely skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkBusy}
              onClick={() => {
                setBulkConfirmOpen(false);
                void runBulkStageOrHrUpdate();
              }}
            >
              Confirm Bulk Update
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Candidate Import Confirmation */}
      <AlertDialog open={importConfirmOpen} onOpenChange={setImportConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Import {previewSummary?.importable ?? 0} Candidate(s) into Pipeline?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Imports valid and warning rows from <strong>{importFileName}</strong> into the Applied
              stage while skipping {previewSummary?.duplicate ?? 0} duplicate(s) and{" "}
              {previewSummary?.invalid ?? 0} invalid row(s). No auth accounts or onboarding
              invitations are created during candidate import.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={importBusy}
              onClick={() => {
                setImportConfirmOpen(false);
                void handleCommitImport();
              }}
            >
              Confirm Import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Email Modal */}
      <Dialog open={bulkEmailOpen} onOpenChange={setBulkEmailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Bulk Recruitment Email</DialogTitle>
            <DialogDescription>
              Send a personalized HR email template to {selectedIds.size} selected candidate(s)
              with automatic duplicate protection.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {!data?.emailProvider.configured && (
              <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-xs text-warning">
                Live sending is disabled until Hostinger SMTP environment variables (
                <code className="font-mono">SMTP_HOST</code>,{" "}
                <code className="font-mono">SMTP_USER</code>,{" "}
                <code className="font-mono">SMTP_PASS</code>,{" "}
                <code className="font-mono">EMAIL_FROM</code>) are configured.
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="bulk-email-tpl">Template</Label>
              <select
                id="bulk-email-tpl"
                value={bulkTemplateSlug}
                onChange={(e) => setBulkTemplateSlug(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {DEFAULT_EMAIL_TEMPLATES.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkEmailOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={bulkBusy || !data?.emailProvider.configured}
              onClick={runBulkEmailSend}
            >
              {bulkBusy ? "Sending..." : `Send to ${selectedIds.size} Candidate(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

