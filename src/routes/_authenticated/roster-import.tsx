import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit2,
  FileSpreadsheet,
  Filter,
  Lock,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserCheck,
  UserMinus,
  UserPlus,
  UserX,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AccessDenied, errorToAccessScreen } from "@/components/access-denied";
import { HubSubNav, ONBOARDING_HUB_TABS } from "@/components/hub-subnav";
import { OnboardedEmployeesPanel } from "@/components/onboarding/onboarded-employees-panel";
import { EmployeeEditDrawer } from "@/components/onboarding/employee-edit-drawer";
import { BulkEditDialog } from "@/components/onboarding/bulk-edit-dialog";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { actorQueryOptions, useActor } from "@/hooks/use-actor";
import { downloadCsv, toCsv } from "@/lib/csv";
import { downloadXlsx, type SheetRow } from "@/lib/xlsx-export";
import {
  ONBOARDING_CATEGORIES,
  ONBOARDING_CATEGORY_LABELS,
  ONBOARDING_CREATE_CHUNK,
  ONBOARDING_MAX_ROWS,
  ONBOARDING_STATUS_LABELS,
  ONBOARDING_TEMPLATE_HEADERS,
  ONBOARDING_TEMPLATE_SAMPLE_ROWS,
  gridToOnboardingRows,
  isCreatableRow,
  type OnboardingCategory,
  type OnboardingRawRow,
  type OnboardingRole,
  type OnboardingRowStatus,
  type OnboardingSummary,
  type ValidatedOnboardingRow,
} from "@/lib/onboarding/employee-onboarding";
import {
  createOnboardedEmployees,
  getOnboardingContext,
  validateOnboardingBatch,
  type CreateEmployeeResult,
} from "@/lib/onboarding.functions";
import { WORK_TYPES, WORK_TYPE_LABELS, type WorkType } from "@/lib/work-type";
import { ROLE_LABELS, type AppRole } from "@/lib/permissions";

export const onboardingContextQueryOptions = {
  queryKey: ["onboardingContext"],
  queryFn: () => getOnboardingContext(),
  staleTime: 60_000,
};

export const Route = createFileRoute("/_authenticated/roster-import")({
  head: () => ({
    meta: [
      { title: "Bulk Employee Onboarding | The AI School HRM" },
      {
        name: "description",
        content:
          "Upload CSV or Excel files with up to 500 employee records, inspect and edit in-memory with real-time validation, and provision accounts in bounded batches.",
      },
      { property: "og:title", content: "Bulk Employee Onboarding | The AI School HRM" },
      {
        property: "og:description",
        content: "Validate and provision employee accounts in bulk with explicit setup email dispatch.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(actorQueryOptions),
      context.queryClient.ensureQueryData(onboardingContextQueryOptions),
    ]);
  },
  component: RosterImportPage,
  errorComponent: ({ error }) => errorToAccessScreen(error),
});

type FilterTab = "all" | "ready" | "needs_info" | "warning" | "error" | "duplicate" | "excluded";

function RosterImportPage() {
  useSuspenseQuery(actorQueryOptions);
  const actor = useActor();
  const { data: onboardingContext } = useQuery(onboardingContextQueryOptions);

  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<OnboardingRawRow[]>([]);
  const [rows, setRows] = useState<ValidatedOnboardingRow[] | null>(null);
  const [summary, setSummary] = useState<OnboardingSummary | null>(null);

  // Filters & Search
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterWorkType, setFilterWorkType] = useState<string>("all");
  const [filterRole, setFilterRole] = useState<string>("all");

  // Selection
  const [selectedRowNumbers, setSelectedRowNumbers] = useState<Set<number>>(new Set());

  // Pagination
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Edit Drawer & Bulk Edit Dialog State
  const [editingRowNumber, setEditingRowNumber] = useState<number | null>(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  // Provisioning state
  const [busy, setBusy] = useState(false);
  const [isRevalidating, startRevalidation] = useTransition();
  const [confirmCommitOpen, setConfirmCommitOpen] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [lastResults, setLastResults] = useState<CreateEmployeeResult[] | null>(null);
  const [lastBatchKey, setLastBatchKey] = useState<string | null>(null);
  const [panelRefreshSignal, setPanelRefreshSignal] = useState(0);

  const departments = onboardingContext?.departments ?? [];
  const leads = onboardingContext?.leads ?? [];
  const assignableRoles = (onboardingContext?.assignableRoles ?? []) as AppRole[];

  const rawRowsByNumber = useMemo(() => {
    const map = new Map<number, OnboardingRawRow>();
    for (const r of rawRows) {
      map.set(r.rowNumber, r);
    }
    return map;
  }, [rawRows]);

  const validationRowsByNumber = useMemo(() => {
    const map = new Map<number, ValidatedOnboardingRow>();
    if (rows) {
      for (const r of rows) {
        map.set(r.rowNumber, r);
      }
    }
    return map;
  }, [rows]);

  const totalErrorsCount = useMemo(() => {
    if (!summary) return 0;
    return summary.invalid + summary.unauthorized_role;
  }, [summary]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    if (!rows) return [];
    return rows.filter((r) => {
      // 1. Tab filter
      if (activeTab === "ready" && !isCreatableRow(r)) return false;
      if (activeTab === "needs_info" && r.status !== "needs_information") return false;
      if (activeTab === "warning" && r.status !== "warning") return false;
      if (
        activeTab === "error" &&
        r.status !== "invalid" &&
        r.status !== "unauthorized_role"
      ) {
        return false;
      }
      if (activeTab === "duplicate" && r.status !== "duplicate") return false;
      if (activeTab === "excluded" && r.status !== "excluded") return false;

      // 2. Work type filter
      if (filterWorkType !== "all" && r.workType !== filterWorkType) return false;

      // 3. Role filter
      if (filterRole !== "all" && r.role !== filterRole) return false;

      // 4. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesName = r.fullName.toLowerCase().includes(q);
        const matchesEmail = r.workEmail.toLowerCase().includes(q);
        const matchesDesignation = r.designation.toLowerCase().includes(q);
        const matchesRow = String(r.rowNumber).includes(q);
        if (!matchesName && !matchesEmail && !matchesDesignation && !matchesRow) return false;
      }

      return true;
    });
  }, [rows, activeTab, filterWorkType, filterRole, searchQuery]);

  // Paginated slice
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const validCurrentPage = Math.min(currentPage, totalPages);
  const pagedRows = useMemo(() => {
    const start = (validCurrentPage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, validCurrentPage, pageSize]);

  // Selection helpers
  const allFilteredSelected = useMemo(() => {
    if (filteredRows.length === 0) return false;
    return filteredRows.every((r) => selectedRowNumbers.has(r.rowNumber));
  }, [filteredRows, selectedRowNumbers]);

  function toggleSelectAllFiltered() {
    if (allFilteredSelected) {
      setSelectedRowNumbers((prev) => {
        const next = new Set(prev);
        for (const r of filteredRows) {
          next.delete(r.rowNumber);
        }
        return next;
      });
    } else {
      setSelectedRowNumbers((prev) => {
        const next = new Set(prev);
        for (const r of filteredRows) {
          next.add(r.rowNumber);
        }
        return next;
      });
    }
  }

  function toggleRowSelected(rowNumber: number) {
    setSelectedRowNumbers((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  }

  // Revalidation trigger
  async function revalidate(rawList: OnboardingRawRow[]) {
    try {
      const validation = await validateOnboardingBatch({
        data: { rows: rawList },
      });
      setRows(validation.rows);
      setSummary(validation.summary);
    } catch (err) {
      console.error("Batch validation error:", err);
      toast.error(err instanceof Error ? err.message : "Validation error.");
    }
  }

  // Row update handlers
  function updateSingleRow(rowNumber: number, patch: Partial<OnboardingRawRow>) {
    const updated = rawRows.map((r) => (r.rowNumber === rowNumber ? { ...r, ...patch } : r));
    setRawRows(updated);
    startRevalidation(() => {
      void revalidate(updated);
    });
  }

  function applyBulkPatch(patch: Partial<OnboardingRawRow>) {
    const updated = rawRows.map((r) => {
      if (selectedRowNumbers.has(r.rowNumber)) {
        return { ...r, ...patch };
      }
      return r;
    });
    setRawRows(updated);
    startRevalidation(() => {
      void revalidate(updated);
    });
    toast.success(`Updated ${selectedRowNumbers.size} selected row(s).`);
  }

  function toggleExcludeRow(rowNumber: number) {
    const current = rawRowsByNumber.get(rowNumber);
    if (!current) return;
    const isExcluded = current.exclude_from_import === "true";
    updateSingleRow(rowNumber, { exclude_from_import: isExcluded ? "" : "true" });
  }

  function bulkSetExcluded(exclude: boolean) {
    const updated = rawRows.map((r) => {
      if (selectedRowNumbers.has(r.rowNumber)) {
        return { ...r, exclude_from_import: exclude ? "true" : "" };
      }
      return r;
    });
    setRawRows(updated);
    startRevalidation(() => {
      void revalidate(updated);
    });
    toast.success(
      exclude
        ? `Excluded ${selectedRowNumbers.size} row(s) from import.`
        : `Included ${selectedRowNumbers.size} row(s) for import.`,
    );
  }

  function keepDuplicateOnly(targetRowNumber: number, email: string) {
    const cleanEmail = email.trim().toLowerCase();
    const updated = rawRows.map((r) => {
      if (String(r.work_email ?? "").trim().toLowerCase() === cleanEmail) {
        if (r.rowNumber === targetRowNumber) {
          return { ...r, exclude_from_import: "" };
        } else {
          return { ...r, exclude_from_import: "true" };
        }
      }
      return r;
    });
    setRawRows(updated);
    startRevalidation(() => {
      void revalidate(updated);
    });
    toast.success(`Kept row #${targetRowNumber} and excluded other file duplicates for ${email}.`);
  }

  if (!actor.can("workforce:create:all") && !actor.can("invitations:create:all")) {
    return (
      <AccessDenied
        kind="forbidden"
        detail="Bulk employee onboarding is restricted to authorized HR and Administrator accounts."
      />
    );
  }

  function downloadTemplate(kind: "csv" | "xlsx") {
    if (kind === "csv") {
      downloadCsv(
        "employee_onboarding_template.csv",
        toCsv(
          ONBOARDING_TEMPLATE_SAMPLE_ROWS as unknown as Record<string, string>[],
          ONBOARDING_TEMPLATE_HEADERS.map((c) => ({
            key: c,
            header: c,
            value: (r: Record<string, string>) => r[c] ?? "",
          })),
        ),
      );
    } else {
      void downloadXlsx(
        "employee_onboarding_template.xlsx",
        "Onboarding",
        ONBOARDING_TEMPLATE_SAMPLE_ROWS as unknown as SheetRow[],
      );
    }
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error("File exceeds maximum allowed size of 10 MB.");
      return;
    }

    setBusy(true);
    setLastResults(null);
    setSelectedRowNumbers(new Set());
    try {
      const XLSX = await import("xlsx");
      const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
      const workbook = isCsv
        ? XLSX.read(await file.text(), { type: "string", raw: true })
        : XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const sheetName = workbook.SheetNames[0]!;
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

      const parsed = gridToOnboardingRows(grid);
      if (parsed.rows.length === 0) {
        throw new Error(
          parsed.fileErrors.join(" ") || "No employee data rows were found in that file. Please check column headers.",
        );
      }

      if (parsed.rows.length > ONBOARDING_MAX_ROWS) {
        throw new Error(
          `File contains ${parsed.rows.length} rows. Maximum allowed per upload is ${ONBOARDING_MAX_ROWS}.`,
        );
      }

      setFileName(file.name);
      setRawRows(parsed.rows);

      const validation = await validateOnboardingBatch({
        data: { rows: parsed.rows },
      });

      setRows(validation.rows);
      setSummary(validation.summary);
      setActiveTab("all");
      setCurrentPage(1);

      toast.success(
        `Loaded ${validation.summary.total} rows: ${validation.summary.creatable} ready to provision.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that file.");
      setRows(null);
      setSummary(null);
      setRawRows([]);
    } finally {
      setBusy(false);
    }
  }

  // Bounded chunked provisioning engine
  async function runProvisioning(rowsOverride?: OnboardingRawRow[]) {
    if (!rows) return;

    let targetRows: OnboardingRawRow[];
    if (rowsOverride && rowsOverride.length > 0) {
      targetRows = rowsOverride;
    } else {
      const creatableRowNumbers = new Set(
        rows.filter((r) => isCreatableRow(r)).map((r) => r.rowNumber),
      );
      targetRows = rawRows.filter((r) => creatableRowNumbers.has(r.rowNumber));
    }

    if (targetRows.length === 0) {
      toast.error("No ready employee rows available to provision.");
      return;
    }

    setBusy(true);
    setConfirmCommitOpen(false);

    const batchKey = crypto.randomUUID();
    setLastBatchKey(batchKey);
    const chunkSize = ONBOARDING_CREATE_CHUNK;
    const totalChunks = Math.ceil(targetRows.length / chunkSize);
    let allResults: CreateEmployeeResult[] = [];

    try {
      for (let i = 0; i < targetRows.length; i += chunkSize) {
        const chunkIndex = Math.floor(i / chunkSize) + 1;
        const chunk = targetRows.slice(i, i + chunkSize);
        const startNum = i + 1;
        const endNum = Math.min(i + chunkSize, targetRows.length);

        setProgressText(
          `Provisioning batch ${chunkIndex} of ${totalChunks} (employees ${startNum}–${endNum} of ${targetRows.length})…`,
        );
        setProgressPercent(Math.round((i / targetRows.length) * 100));

        const outcome = await createOnboardedEmployees({
          data: {
            batchKey,
            source: "bulk",
            rows: chunk,
          },
        });

        allResults = [...allResults, ...outcome.results];
      }

      setProgressPercent(100);
      setLastResults(allResults);

      const created = allResults.filter((r) => r.outcome === "created");
      const failed = allResults.filter((r) => r.outcome !== "created");

      if (created.length > 0) {
        toast.success(
          `Successfully provisioned ${created.length} employee accounts with server-claimed sequential TAS IDs!`,
        );
      }
      if (failed.length > 0) {
        toast.error(`${failed.length} account(s) encountered issues or were skipped.`);
      }

      // If all created successfully, clean preview state
      if (failed.length === 0) {
        setRows(null);
        setSummary(null);
        setRawRows([]);
        setSelectedRowNumbers(new Set());
      } else {
        // Revalidate remaining or update state
        const failedRowNums = new Set(failed.map((f) => f.rowNumber));
        const remainingRaw = rawRows.filter((r) => failedRowNums.has(r.rowNumber));
        setRawRows(remainingRaw);
        void revalidate(remainingRaw);
      }

      // Refresh management panel below
      setPanelRefreshSignal((s) => s + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed during batch provisioning.");
    } finally {
      setBusy(false);
      setProgressText(null);
      setProgressPercent(0);
    }
  }

  function retryFailedRows() {
    if (!lastResults) return;
    const failedNums = new Set(
      lastResults.filter((r) => r.outcome !== "created").map((r) => r.rowNumber),
    );
    const toRetry = rawRows.filter((r) => failedNums.has(r.rowNumber));
    if (toRetry.length === 0) {
      toast.error("No failed rows found to retry.");
      return;
    }
    void runProvisioning(toRetry);
  }

  function exportErrorReportCsv() {
    if (!rows) return;
    const errorRows = rows.filter((r) => !isCreatableRow(r));
    downloadCsv(
      `onboarding_errors_${fileName ? fileName.replace(/\.[^.]+$/, "") : "batch"}.csv`,
      toCsv(
        errorRows,
        [
          { key: "row", header: "Row", value: (r) => r.rowNumber },
          { key: "status", header: "Status", value: (r) => r.status },
          { key: "first_name", header: "First Name", value: (r) => r.firstName },
          { key: "last_name", header: "Last Name", value: (r) => r.lastName },
          { key: "work_email", header: "Work Email", value: (r) => r.workEmail },
          { key: "work_type", header: "Work Type", value: (r) => r.workType ?? "" },
          { key: "role", header: "Role", value: (r) => r.role ?? "" },
          { key: "employment_category", header: "Employment Category", value: (r) => r.category ?? "" },
          { key: "designation", header: "Designation", value: (r) => r.designation },
          { key: "errors", header: "Issues & Notes", value: (r) => [...r.errors, ...r.warnings].join("; ") },
        ],
      ),
    );
  }

  // Row currently loaded in full edit drawer
  const drawerRawRow = editingRowNumber !== null ? rawRowsByNumber.get(editingRowNumber) ?? null : null;
  const drawerValidationRow = editingRowNumber !== null ? validationRowsByNumber.get(editingRowNumber) ?? null : null;

  return (
    <AppShell
      title="Bulk Employee Onboarding"
      description="Upload CSV or Excel files with up to 500 employee records, edit and resolve missing data inline, and provision in bounded batches with sequential TAS IDs."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => downloadTemplate("csv")}>
            <Download className="mr-1.5 size-4" aria-hidden="true" /> Template (CSV)
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => downloadTemplate("xlsx")}>
            <Download className="mr-1.5 size-4" aria-hidden="true" /> Template (Excel)
          </Button>
        </div>
      }
    >
      <HubSubNav tabs={ONBOARDING_HUB_TABS} />

      <div className="space-y-6">
        {/* Step 1: Upload Card */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="size-4 text-primary" />
              1 · Upload Employee Roster (Supports up to 500 rows)
            </CardTitle>
            <CardDescription>
              CSV or Excel spreadsheet matching the 8 standard fields: First Name, Last Name, Work Email,
              Date of Birth (YYYY-MM-DD), Work Type, Role, Employment Category, Designation.
              Sequential Employee IDs (e.g. TAS-001) are atomically claimed from the server sequence during provisioning.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="roster" className="text-xs font-medium">
                  Roster spreadsheet (.csv, .xlsx, .xls)
                </Label>
                <Input
                  id="roster"
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={onFile}
                  disabled={busy}
                  className="cursor-pointer file:cursor-pointer"
                />
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs text-muted-foreground flex flex-col justify-center">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <UserPlus className="size-3.5 text-primary" /> Next ID in sequence:{" "}
                  <span className="font-mono text-primary font-bold">
                    {onboardingContext?.nextEmployeeIdPreview ?? "Loading…"}
                  </span>
                </p>
                <p className="text-[11px] mt-0.5">
                  Pre-assigned IDs in files are strictly disallowed to prevent sequence corruption.
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs text-muted-foreground flex flex-col justify-center">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <Lock className="size-3.5 text-emerald-600" /> Date of Birth Privacy
                </p>
                <p className="text-[11px] mt-0.5">
                  DOB is validated securely in memory for age compliance (&ge;16) and never echoed in previews.
                </p>
              </div>
            </div>
            {fileName ? (
              <p className="break-words text-xs text-muted-foreground">
                Loaded file: <span className="font-medium text-foreground">{fileName}</span>
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* Step 2: Review Grid, In-Memory Editing, Validation & Batch Provisioning */}
        {rows && summary ? (
          <Card className="border-border">
            <CardHeader className="space-y-4 pb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <span>2 · Review, Edit & Validate ({summary.total} rows)</span>
                    {isRevalidating && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground animate-pulse">
                        <RefreshCw className="size-3 animate-spin text-primary" /> Revalidating…
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Inline cell editing and full-row drawer enabled. Fix missing data or exclusions before provisioning.
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {summary.invalid + summary.unauthorized_role + summary.duplicate + summary.needs_information > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={exportErrorReportCsv}
                      className="text-xs"
                    >
                      <Download className="mr-1.5 size-3.5" aria-hidden="true" />
                      Export Issues CSV
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    onClick={() => setConfirmCommitOpen(true)}
                    disabled={busy || summary.creatable === 0}
                    className="font-medium"
                  >
                    <UserPlus className="mr-1.5 size-4" aria-hidden="true" />
                    Provision {summary.creatable} Ready Account{summary.creatable === 1 ? "" : "s"}
                  </Button>
                </div>
              </div>

              {/* KPI Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveTab("all")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveTab("all");
                    }
                  }}
                  className={`cursor-pointer rounded-lg border p-2.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                    activeTab === "all" ? "border-primary bg-primary/5" : "border-border/60 bg-card hover:bg-muted/40"
                  }`}
                >
                  <div className="text-[11px] font-medium text-muted-foreground">Total Rows</div>
                  <div className="mt-1 text-lg font-bold">{summary.total}</div>
                </div>

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveTab("ready")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveTab("ready");
                    }
                  }}
                  className={`cursor-pointer rounded-lg border p-2.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                    activeTab === "ready"
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-border/60 bg-card hover:bg-muted/40"
                  }`}
                >
                  <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Ready</div>
                  <div className="mt-1 text-lg font-bold text-emerald-600 dark:text-emerald-400">
                    {summary.creatable}
                  </div>
                </div>

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveTab("needs_info")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveTab("needs_info");
                    }
                  }}
                  className={`cursor-pointer rounded-lg border p-2.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                    activeTab === "needs_info"
                      ? "border-amber-500 bg-amber-500/10"
                      : "border-border/60 bg-card hover:bg-muted/40"
                  }`}
                >
                  <div className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Needs Info</div>
                  <div className="mt-1 text-lg font-bold text-amber-600 dark:text-amber-400">
                    {summary.needs_information}
                  </div>
                </div>

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveTab("warning")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveTab("warning");
                    }
                  }}
                  className={`cursor-pointer rounded-lg border p-2.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                    activeTab === "warning"
                      ? "border-yellow-500 bg-yellow-500/10"
                      : "border-border/60 bg-card hover:bg-muted/40"
                  }`}
                >
                  <div className="text-[11px] font-medium text-yellow-600 dark:text-yellow-400">Warnings</div>
                  <div className="mt-1 text-lg font-bold text-yellow-600 dark:text-yellow-400">
                    {summary.warning}
                  </div>
                </div>

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveTab("error")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveTab("error");
                    }
                  }}
                  className={`cursor-pointer rounded-lg border p-2.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                    activeTab === "error"
                      ? "border-destructive bg-destructive/10"
                      : "border-border/60 bg-card hover:bg-muted/40"
                  }`}
                >
                  <div className="text-[11px] font-medium text-destructive">Errors</div>
                  <div className="mt-1 text-lg font-bold text-destructive">{totalErrorsCount}</div>
                </div>

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveTab("duplicate")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveTab("duplicate");
                    }
                  }}
                  className={`cursor-pointer rounded-lg border p-2.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                    activeTab === "duplicate"
                      ? "border-purple-500 bg-purple-500/10"
                      : "border-border/60 bg-card hover:bg-muted/40"
                  }`}
                >
                  <div className="text-[11px] font-medium text-purple-600 dark:text-purple-400">Duplicates</div>
                  <div className="mt-1 text-lg font-bold text-purple-600 dark:text-purple-400">
                    {summary.duplicate}
                  </div>
                </div>

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveTab("excluded")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActiveTab("excluded");
                    }
                  }}
                  className={`cursor-pointer rounded-lg border p-2.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                    activeTab === "excluded"
                      ? "border-slate-500 bg-slate-500/10"
                      : "border-border/60 bg-card hover:bg-muted/40"
                  }`}
                >
                  <div className="text-[11px] font-medium text-muted-foreground">Excluded</div>
                  <div className="mt-1 text-lg font-bold text-muted-foreground">{summary.excluded}</div>
                </div>
              </div>

              {/* Search, Filter Bar and Bulk Actions */}
              <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-64">
                    <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search name, email, row…"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setCurrentPage(1);
                      }}
                      className="h-8 pl-8 text-xs"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Filter by Work Type */}
                  <Select
                    value={filterWorkType}
                    onValueChange={(val) => {
                      setFilterWorkType(val);
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="h-8 w-36 text-xs">
                      <SelectValue placeholder="Work Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Work Types</SelectItem>
                      {WORK_TYPES.map((wt) => (
                        <SelectItem key={wt} value={wt}>
                          {WORK_TYPE_LABELS[wt]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Filter by Role */}
                  <Select
                    value={filterRole}
                    onValueChange={(val) => {
                      setFilterRole(val);
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="h-8 w-36 text-xs">
                      <SelectValue placeholder="Role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      {assignableRoles.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Page Size Selector */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Show</span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(val) => {
                      setPageSize(Number(val));
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="h-8 w-20 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                  <span>rows</span>
                </div>
              </div>

              {/* Floating / Sticky Bulk Action Bar */}
              {selectedRowNumbers.size > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="font-mono">
                      {selectedRowNumbers.size}
                    </Badge>
                    <span className="font-medium text-foreground">
                      row{selectedRowNumbers.size === 1 ? "" : "s"} selected
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setBulkEditOpen(true)}
                      className="h-7 text-xs bg-background"
                    >
                      <SlidersHorizontal className="mr-1.5 size-3.5" />
                      Bulk Edit Selected
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => bulkSetExcluded(true)}
                      className="h-7 text-xs bg-background"
                    >
                      <UserMinus className="mr-1.5 size-3.5" />
                      Exclude Selected
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => bulkSetExcluded(false)}
                      className="h-7 text-xs bg-background"
                    >
                      <UserCheck className="mr-1.5 size-3.5" />
                      Include Selected
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedRowNumbers(new Set())}
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              )}
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Main Interactive Table */}
              <div className="max-h-[32rem] overflow-auto rounded-md border border-border">
                <table className="w-full min-w-[1000px] text-xs">
                  <thead className="sticky top-0 z-10 border-b border-border bg-muted/90 backdrop-blur-sm text-left uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="w-10 px-3 py-2 text-center">
                        <Checkbox
                          checked={allFilteredSelected}
                          onCheckedChange={toggleSelectAllFiltered}
                          aria-label="Select all filtered rows"
                        />
                      </th>
                      <th scope="col" className="w-12 px-2 py-2 font-mono">#</th>
                      <th scope="col" className="w-24 px-2 py-2">Status</th>
                      <th scope="col" className="px-2 py-2">Full Name</th>
                      <th scope="col" className="px-2 py-2">Work Email</th>
                      <th scope="col" className="w-28 px-2 py-2">DOB</th>
                      <th scope="col" className="w-36 px-2 py-2">Work Type</th>
                      <th scope="col" className="w-36 px-2 py-2">Role</th>
                      <th scope="col" className="w-32 px-2 py-2">Category</th>
                      <th scope="col" className="px-2 py-2">Designation</th>
                      <th scope="col" className="px-2 py-2">Issues & Diagnostics</th>
                      <th scope="col" className="w-20 px-2 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {pagedRows.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">
                          No employee records match the active filter or search criteria.
                        </td>
                      </tr>
                    ) : (
                      pagedRows.map((row) => {
                        const raw = rawRowsByNumber.get(row.rowNumber);
                        const isSelected = selectedRowNumbers.has(row.rowNumber);
                        const isExcluded = row.status === "excluded";

                        let rowBg = "hover:bg-muted/30";
                        if (isExcluded) rowBg = "opacity-50 bg-muted/20 hover:opacity-80";
                        else if (row.status === "needs_information") rowBg = "bg-amber-500/5 hover:bg-amber-500/10";
                        else if (row.status === "duplicate") rowBg = "bg-purple-500/5 hover:bg-purple-500/10";
                        else if (!isCreatableRow(row)) rowBg = "bg-destructive/5 hover:bg-destructive/10";
                        else if (row.status === "warning") rowBg = "bg-yellow-500/5 hover:bg-yellow-500/10";
                        else rowBg = "bg-emerald-500/5 hover:bg-emerald-500/10";

                        return (
                          <tr key={row.rowNumber} className={`transition-colors ${rowBg}`}>
                            <td className="px-3 py-1.5 text-center">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleRowSelected(row.rowNumber)}
                                aria-label={`Select row ${row.rowNumber}`}
                              />
                            </td>
                            <td className="px-2 py-1.5 font-mono text-muted-foreground">{row.rowNumber}</td>
                            <td className="px-2 py-1.5">
                              <Badge
                                variant={
                                  row.status === "valid"
                                    ? "success"
                                    : row.status === "needs_information"
                                      ? "warning"
                                      : row.status === "warning"
                                        ? "secondary"
                                        : row.status === "excluded"
                                          ? "outline"
                                          : "destructive"
                                }
                                className="text-[10px] font-medium"
                              >
                                {ONBOARDING_STATUS_LABELS[row.status] ?? row.status}
                              </Badge>
                            </td>

                            {/* Full Name (Inline Editable) */}
                            <td className="px-2 py-1.5">
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  defaultValue={raw?.first_name ?? ""}
                                  placeholder="First"
                                  onBlur={(e) => {
                                    if (e.target.value !== (raw?.first_name ?? "")) {
                                      updateSingleRow(row.rowNumber, { first_name: e.target.value });
                                    }
                                  }}
                                  className="w-20 rounded border border-transparent bg-transparent px-1 py-0.5 font-medium hover:border-border focus:border-primary focus:bg-background focus:outline-none"
                                />
                                <input
                                  type="text"
                                  defaultValue={raw?.last_name ?? ""}
                                  placeholder="Last"
                                  onBlur={(e) => {
                                    if (e.target.value !== (raw?.last_name ?? "")) {
                                      updateSingleRow(row.rowNumber, { last_name: e.target.value });
                                    }
                                  }}
                                  className="w-20 rounded border border-transparent bg-transparent px-1 py-0.5 font-medium hover:border-border focus:border-primary focus:bg-background focus:outline-none"
                                />
                              </div>
                            </td>

                            {/* Work Email (Inline Editable with blur revalidation) */}
                            <td className="px-2 py-1.5">
                              <input
                                type="email"
                                defaultValue={raw?.work_email ?? ""}
                                placeholder="name@theaischool.co"
                                onBlur={(e) => {
                                  if (e.target.value !== (raw?.work_email ?? "")) {
                                    updateSingleRow(row.rowNumber, { work_email: e.target.value });
                                  }
                                }}
                                className="w-44 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[11px] hover:border-border focus:border-primary focus:bg-background focus:outline-none"
                              />
                            </td>

                            {/* DOB Status */}
                            <td className="px-2 py-1.5">
                              {row.dobStatus === "valid" ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                                  <Lock className="size-3" /> Valid (Secret)
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setEditingRowNumber(row.rowNumber)}
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive underline hover:text-destructive/80"
                                >
                                  <AlertCircle className="size-3" />
                                  {row.dobStatus === "missing" ? "Missing DOB" : "Invalid DOB"}
                                </button>
                              )}
                            </td>

                            {/* Work Type (Inline Select) */}
                            <td className="px-2 py-1.5">
                              <Select
                                value={raw?.work_type ?? ""}
                                onValueChange={(val) => updateSingleRow(row.rowNumber, { work_type: val })}
                              >
                                <SelectTrigger className="h-7 w-32 text-[11px]">
                                  <SelectValue placeholder="+ Set Work Type" />
                                </SelectTrigger>
                                <SelectContent>
                                  {WORK_TYPES.map((wt) => (
                                    <SelectItem key={wt} value={wt} className="text-xs">
                                      {WORK_TYPE_LABELS[wt]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>

                            {/* Role (Inline Select) */}
                            <td className="px-2 py-1.5">
                              <Select
                                value={raw?.role ?? ""}
                                onValueChange={(val) => updateSingleRow(row.rowNumber, { role: val })}
                              >
                                <SelectTrigger className="h-7 w-32 text-[11px]">
                                  <SelectValue placeholder="+ Set Role" />
                                </SelectTrigger>
                                <SelectContent>
                                  {assignableRoles.map((r) => (
                                    <SelectItem key={r} value={r} className="text-xs">
                                      {ROLE_LABELS[r]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>

                            {/* Category (Inline Select) */}
                            <td className="px-2 py-1.5">
                              <Select
                                value={raw?.employment_category ?? ""}
                                onValueChange={(val) =>
                                  updateSingleRow(row.rowNumber, { employment_category: val })
                                }
                              >
                                <SelectTrigger className="h-7 w-28 text-[11px]">
                                  <SelectValue placeholder="+ Set Cat." />
                                </SelectTrigger>
                                <SelectContent>
                                  {ONBOARDING_CATEGORIES.map((c) => (
                                    <SelectItem key={c} value={c} className="text-xs">
                                      {ONBOARDING_CATEGORY_LABELS[c]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>

                            {/* Designation (Inline Editable) */}
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                defaultValue={raw?.designation ?? ""}
                                placeholder="Designation"
                                onBlur={(e) => {
                                  if (e.target.value !== (raw?.designation ?? "")) {
                                    updateSingleRow(row.rowNumber, { designation: e.target.value });
                                  }
                                }}
                                className="w-28 rounded border border-transparent bg-transparent px-1 py-0.5 text-[11px] hover:border-border focus:border-primary focus:bg-background focus:outline-none"
                              />
                            </td>

                            {/* Issues & Diagnostics */}
                            <td className="px-2 py-1.5">
                              {row.status === "duplicate" ? (
                                <div className="space-y-1">
                                  <span className="text-[11px] font-medium text-purple-600 dark:text-purple-400">
                                    {row.duplicateSource === "file"
                                      ? "Duplicate email in uploaded file"
                                      : "Already registered in HRM database"}
                                  </span>
                                  {row.duplicateSource === "file" && (
                                    <button
                                      type="button"
                                      onClick={() => keepDuplicateOnly(row.rowNumber, row.workEmail)}
                                      className="block text-[10px] text-primary underline hover:text-primary/80"
                                    >
                                      Keep this & exclude others
                                    </button>
                                  )}
                                </div>
                              ) : row.errors.length > 0 ? (
                                <span className="text-[11px] text-destructive">
                                  {row.errors.join("; ")}
                                </span>
                              ) : row.warnings.length > 0 ? (
                                <span className="text-[11px] text-yellow-600 dark:text-yellow-400">
                                  {row.warnings.join("; ")}
                                </span>
                              ) : isExcluded ? (
                                <span className="text-[11px] text-muted-foreground italic">
                                  Manually excluded from import
                                </span>
                              ) : (
                                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                                  Ready to provision
                                </span>
                              )}
                            </td>

                            {/* Action Buttons */}
                            <td className="px-2 py-1.5 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-6 text-muted-foreground hover:text-foreground"
                                  onClick={() => setEditingRowNumber(row.rowNumber)}
                                  title="Edit full row details in drawer"
                                >
                                  <Edit2 className="size-3" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className={`size-6 ${
                                    isExcluded
                                      ? "text-emerald-600 hover:text-emerald-700"
                                      : "text-muted-foreground hover:text-destructive"
                                  }`}
                                  onClick={() => toggleExcludeRow(row.rowNumber)}
                                  title={isExcluded ? "Include back into import" : "Exclude row from import"}
                                >
                                  {isExcluded ? <UserCheck className="size-3" /> : <UserMinus className="size-3" />}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Table Footer with Pagination Controls */}
              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground">
                <div>
                  Showing rows{" "}
                  <span className="font-semibold text-foreground">
                    {filteredRows.length === 0 ? 0 : (validCurrentPage - 1) * pageSize + 1}
                  </span>
                  –
                  <span className="font-semibold text-foreground">
                    {Math.min(validCurrentPage * pageSize, filteredRows.length)}
                  </span>{" "}
                  of <span className="font-semibold text-foreground">{filteredRows.length}</span> filtered (
                  {summary.total} total)
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    disabled={validCurrentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="mr-1 size-3.5" /> Previous
                  </Button>
                  <span className="px-2 text-xs font-medium text-foreground">
                    Page {validCurrentPage} of {totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    disabled={validCurrentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next <ChevronRight className="ml-1 size-3.5" />
                  </Button>
                </div>
              </div>

              {/* Action Bar at Bottom of Table */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => setConfirmCommitOpen(true)}
                    disabled={busy || summary.creatable === 0}
                  >
                    <UserPlus className="mr-1.5 size-4" aria-hidden="true" />
                    Provision {summary.creatable} Employee Account{summary.creatable === 1 ? "" : "s"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setRows(null);
                      setSummary(null);
                      setRawRows([]);
                      setSelectedRowNumbers(new Set());
                      setFileName("");
                    }}
                  >
                    Discard Batch
                  </Button>
                </div>

                {/* Progress Indicator */}
                {progressText ? (
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <div className="w-48">
                      <Progress value={progressPercent} className="h-2" />
                    </div>
                    <span
                      role="status"
                      aria-live="polite"
                      className="text-xs font-medium text-muted-foreground animate-pulse"
                    >
                      {progressText} ({progressPercent}%)
                    </span>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Provisioning Outcome Banner if just executed */}
        {lastResults ? (
          <Card className="border-border">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600" />
                    Batch Provisioning Result
                  </CardTitle>
                  <CardDescription>
                    Accounts created directly via Supabase Auth Admin API with sequential TAS employee IDs.
                    Account setup emails are held in reserve and can be sent with explicit approval below.
                  </CardDescription>
                </div>
                {lastResults.some((r) => r.outcome !== "created") && (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={retryFailedRows}
                    disabled={busy}
                  >
                    <RefreshCw className="mr-1.5 size-3.5" />
                    Retry Failed Rows
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="success">
                  {lastResults.filter((r) => r.outcome === "created").length} accounts provisioned
                </Badge>
                {lastResults.filter((r) => r.outcome !== "created").length > 0 && (
                  <Badge variant="destructive">
                    {lastResults.filter((r) => r.outcome !== "created").length} skipped / failed
                  </Badge>
                )}
              </div>
              <div className="max-h-56 overflow-auto rounded-md border border-border text-xs">
                <table className="w-full text-left">
                  <thead className="sticky top-0 border-b bg-muted px-2 py-1 text-muted-foreground uppercase text-[10px]">
                    <tr>
                      <th className="px-2.5 py-1.5">Row</th>
                      <th className="px-2.5 py-1.5">Employee ID</th>
                      <th className="px-2.5 py-1.5">Name</th>
                      <th className="px-2.5 py-1.5">Email</th>
                      <th className="px-2.5 py-1.5">Outcome</th>
                      <th className="px-2.5 py-1.5">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lastResults.map((c) => (
                      <tr key={c.rowNumber}>
                        <td className="px-2.5 py-1 font-mono">{c.rowNumber}</td>
                        <td className="px-2.5 py-1 font-mono font-medium text-primary">
                          {c.employeeCode ?? "—"}
                        </td>
                        <td className="px-2.5 py-1">{c.fullName}</td>
                        <td className="px-2.5 py-1 font-mono text-[11px]">{c.workEmail}</td>
                        <td className="px-2.5 py-1">
                          <Badge variant={c.outcome === "created" ? "success" : "destructive"}>
                            {c.outcome}
                          </Badge>
                        </td>
                        <td className="px-2.5 py-1 text-muted-foreground">{c.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Live Onboarded Employees Panel: Review, Track Status & Send Setup Emails via Hostinger */}
        <OnboardedEmployeesPanel key={panelRefreshSignal} />
      </div>

      {/* Slide-over Full-Row Edit Drawer */}
      <EmployeeEditDrawer
        open={editingRowNumber !== null}
        onOpenChange={(open) => {
          if (!open) setEditingRowNumber(null);
        }}
        rawRow={drawerRawRow}
        validationRow={drawerValidationRow}
        departments={departments}
        leads={leads}
        assignableRoles={assignableRoles}
        onSave={(updated) => {
          if (editingRowNumber !== null) {
            updateSingleRow(editingRowNumber, updated);
          }
          setEditingRowNumber(null);
        }}
      />

      {/* Modal Dialog for Bulk Editing Selected Rows */}
      <BulkEditDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        selectedCount={selectedRowNumbers.size}
        departments={departments}
        leads={leads}
        assignableRoles={assignableRoles}
        onApply={(patch) => {
          applyBulkPatch(patch);
          setBulkEditOpen(false);
        }}
      />

      {/* Confirmation Dialog before Provisioning */}
      <AlertDialog open={confirmCommitOpen} onOpenChange={setConfirmCommitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Provision {summary?.creatable ?? 0} employee account{(summary?.creatable ?? 0) === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This will provision user accounts directly via Supabase Auth Admin API with sequential
                employee IDs atomically claimed from the server sequence in bounded chunks of {ONBOARDING_CREATE_CHUNK}.
              </p>
              <p className="font-semibold text-foreground">
                Account setup emails are NOT sent automatically during creation.
              </p>
              <p className="text-xs text-muted-foreground">
                You can review provisioned accounts and trigger time-limited, single-use account setup emails
                individually or in bulk via Hostinger SMTP (hr@theaischool.co) from the management panel below.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void runProvisioning();
              }}
            >
              {busy ? "Provisioning…" : "Confirm & Provision"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
