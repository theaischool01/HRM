import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Lock,
  UserPlus,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AccessDenied, errorToAccessScreen } from "@/components/access-denied";
import { HubSubNav, ONBOARDING_HUB_TABS } from "@/components/hub-subnav";
import { OnboardedEmployeesPanel } from "@/components/onboarding/onboarded-employees-panel";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { actorQueryOptions, useActor } from "@/hooks/use-actor";
import { downloadCsv, toCsv } from "@/lib/csv";
import { downloadXlsx, type SheetRow } from "@/lib/xlsx-export";
import {
  ONBOARDING_TEMPLATE_HEADERS,
  ONBOARDING_TEMPLATE_SAMPLE_ROWS,
  gridToOnboardingRows,
  isCreatableRow,
  type OnboardingColumn,
  type OnboardingRawRow,
  type OnboardingSummary,
  type ValidatedOnboardingRow,
} from "@/lib/onboarding/employee-onboarding";
import {
  createOnboardedEmployees,
  validateOnboardingBatch,
  type CreateEmployeeResult,
} from "@/lib/onboarding.functions";

export const Route = createFileRoute("/_authenticated/roster-import")({
  head: () => ({
    meta: [
      { title: "Bulk Employee Onboarding | The AI School HRM" },
      {
        name: "description",
        content:
          "Upload CSV or Excel files with the 8 standard onboarding columns to validate and provision employee accounts in bulk.",
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
  loader: ({ context }) => context.queryClient.ensureQueryData(actorQueryOptions),
  component: RosterImportPage,
  errorComponent: ({ error }) => errorToAccessScreen(error),
});

type Filter = "all" | "error" | "warning";

function RosterImportPage() {
  useSuspenseQuery(actorQueryOptions);
  const actor = useActor();
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<OnboardingRawRow[]>([]);
  const [rows, setRows] = useState<ValidatedOnboardingRow[] | null>(null);
  const [summary, setSummary] = useState<OnboardingSummary | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [confirmCommitOpen, setConfirmCommitOpen] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<CreateEmployeeResult[] | null>(null);
  const [panelRefreshSignal, setPanelRefreshSignal] = useState(0);

  const errorCount = useMemo(() => {
    if (!summary) return 0;
    return summary.invalid + summary.duplicate + summary.unauthorized_role;
  }, [summary]);

  const visible = useMemo(() => {
    if (!rows) return [];
    if (filter === "all") return rows;
    if (filter === "warning") return rows.filter((r) => r.status === "warning");
    return rows.filter((r) => r.status !== "valid" && r.status !== "warning");
  }, [rows, filter]);

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
    setBusy(true);
    setLastResults(null);
    try {
      const XLSX = await import("xlsx");
      const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
      // CSV cells must stay verbatim string: SheetJS otherwise guesses dates and
      // rewrites "2001-05-14" as "5/14/01" before validation sees it.
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
          // Preserve calendar date in IST/local format rather than shifting -1 day via UTC
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

      setFileName(file.name);
      setRawRows(parsed.rows);

      const validation = await validateOnboardingBatch({
        data: { rows: parsed.rows },
      });

      setRows(validation.rows);
      setSummary(validation.summary);
      setFilter("all");
      toast.success(
        `Validated ${validation.summary.total} rows: ${validation.summary.creatable} ready to provision.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that file.");
      setRows(null);
      setSummary(null);
    } finally {
      setBusy(false);
    }
  }

  async function runProvisioning() {
    if (!rows) return;
    const creatableRowNumbers = new Set(
      rows.filter((r) => isCreatableRow(r)).map((r) => r.rowNumber),
    );
    const rowsToCreate = rawRows.filter((r) => creatableRowNumbers.has(r.rowNumber));

    if (rowsToCreate.length === 0) {
      toast.error("No valid rows available to provision.");
      return;
    }

    setBusy(true);
    setConfirmCommitOpen(false);
    setProgress(`Provisioning ${rowsToCreate.length} employee accounts in bounded batches…`);

    try {
      const outcome = await createOnboardedEmployees({
        data: {
          batchKey: crypto.randomUUID(),
          source: "bulk",
          rows: rowsToCreate,
        },
      });
      setLastResults(outcome.results);

      const created = outcome.results.filter((r) => r.outcome === "created");
      const failed = outcome.results.filter((r) => r.outcome !== "created");

      if (created.length > 0) {
        toast.success(
          `Successfully provisioned ${created.length} employee accounts! (Sequential TAS IDs assigned).`,
        );
      }
      if (failed.length > 0) {
        toast.error(`${failed.length} account(s) could not be provisioned.`);
      }

      // Clear the staged import state
      setRows(null);
      setSummary(null);
      setRawRows([]);
      // Refresh the onboarded employees panel below
      setPanelRefreshSignal((s) => s + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to provision accounts.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <AppShell
      title="Bulk Employee Onboarding"
      description="Upload a CSV or Excel roster with the 8 standard columns to validate and provision employee accounts in bulk. Setup emails can be sent afterwards."
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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="size-4 text-primary" />
              1 · Upload Employee Roster
            </CardTitle>
            <CardDescription>
              CSV or Excel spreadsheet matching the 8 standard fields: First Name, Last Name, Work Email,
              Date of Birth (YYYY-MM-DD), Work Type, Role, Employment Category, Designation.
              Employee IDs (e.g. TAS-022) are atomically claimed from the server sequence on provisioning.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="roster">Roster spreadsheet (.csv, .xlsx, .xls)</Label>
            <Input
              id="roster"
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={onFile}
              disabled={busy}
            />
            {fileName ? (
              <p className="break-words text-xs text-muted-foreground">Selected file: {fileName}</p>
            ) : null}
          </CardContent>
        </Card>

        {/* Step 2: Review Grid & Validation */}
        {rows && summary ? (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">2 · Review & Validate ({summary.total} rows)</CardTitle>
                  <CardDescription>
                    {summary.creatable} ready to provision · {summary.warning} with warnings · {errorCount} with errors.
                    Rows with blocking errors are skipped automatically.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 bg-emerald-500/5">
                    {summary.valid} Valid
                  </Badge>
                  {summary.warning > 0 && (
                    <Badge variant="outline" className="border-amber-500/30 text-amber-600 bg-amber-500/5">
                      {summary.warning} Warning
                    </Badge>
                  )}
                  {errorCount > 0 && (
                    <Badge variant="outline" className="border-destructive/30 text-destructive bg-destructive/5">
                      {errorCount} Error
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    ["all", `All rows (${summary.total})`],
                    ["error", `Errors only (${errorCount})`],
                    ["warning", `Warnings only (${summary.warning})`],
                  ] as [Filter, string][]
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    aria-pressed={filter === value}
                    variant={filter === value ? "default" : "outline"}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </Button>
                ))}
                {errorCount > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      downloadCsv(
                        `onboarding_errors_${fileName.replace(/\.[^.]+$/, "")}.csv`,
                        toCsv(
                          rows.filter((r) => !isCreatableRow(r)),
                          [
                            { key: "row", header: "Row", value: (r) => r.rowNumber },
                            { key: "first_name", header: "First Name", value: (r) => r.firstName },
                            { key: "last_name", header: "Last Name", value: (r) => r.lastName },
                            { key: "work_email", header: "Work Email", value: (r) => r.workEmail },
                            { key: "work_type", header: "Work Type", value: (r) => r.workType ?? "" },
                            { key: "role", header: "Role", value: (r) => r.role ?? "" },
                            { key: "employment_category", header: "Employment Category", value: (r) => r.category ?? "" },
                            { key: "designation", header: "Designation", value: (r) => r.designation },
                            { key: "errors", header: "Errors", value: (r) => r.errors.join("; ") },
                          ],
                        ),
                      )
                    }
                  >
                    <Download className="mr-1.5 size-4" aria-hidden="true" /> Export errors CSV
                  </Button>
                )}
              </div>

              <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
                <table className="w-full min-w-[840px] text-sm">
                  <thead className="sticky top-0 z-10 border-b border-border bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-2.5 py-2">#</th>
                      <th scope="col" className="px-2.5 py-2">Status</th>
                      <th scope="col" className="px-2.5 py-2">Full Name</th>
                      <th scope="col" className="px-2.5 py-2">Work Email</th>
                      <th scope="col" className="px-2.5 py-2">DOB Status</th>
                      <th scope="col" className="px-2.5 py-2">Work Type</th>
                      <th scope="col" className="px-2.5 py-2">Role</th>
                      <th scope="col" className="px-2.5 py-2">Category</th>
                      <th scope="col" className="px-2.5 py-2">Designation</th>
                      <th scope="col" className="px-2.5 py-2">Validation Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {visible.map((row) => (
                      <tr
                        key={row.rowNumber}
                        className={
                          !isCreatableRow(row)
                            ? "bg-destructive/8"
                            : row.status === "warning"
                              ? "bg-amber-500/8"
                              : "bg-emerald-500/5"
                        }
                      >
                        <td className="px-2.5 py-2 font-mono text-xs">{row.rowNumber}</td>
                        <td className="px-2.5 py-2">
                          <Badge
                            variant={
                              !isCreatableRow(row)
                                ? "destructive"
                                : row.status === "warning"
                                  ? "warning"
                                  : "success"
                            }
                          >
                            {!isCreatableRow(row)
                              ? "Error"
                              : row.status === "warning"
                                ? "Warning"
                                : "Ready"}
                          </Badge>
                        </td>
                        <td className="px-2.5 py-2 font-medium">
                          {row.fullName || "—"}
                        </td>
                        <td className="px-2.5 py-2 text-xs font-mono">{row.workEmail || "—"}</td>
                        <td className="px-2.5 py-2 text-xs">
                          {row.dobStatus === "valid" ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                              <Lock className="size-3" /> Valid (Confidential)
                            </span>
                          ) : (
                            <span className="text-destructive font-medium">
                              {row.dobStatus === "missing" ? "Missing" : "Invalid date"}
                            </span>
                          )}
                        </td>
                        <td className="px-2.5 py-2 text-xs capitalize">{row.workType ?? "—"}</td>
                        <td className="px-2.5 py-2 text-xs font-mono uppercase">{row.role ?? "—"}</td>
                        <td className="px-2.5 py-2 text-xs capitalize">
                          {row.category ? row.category.replace("_", " ") : "—"}
                        </td>
                        <td className="px-2.5 py-2 text-xs">{row.designation || "—"}</td>
                        <td className="px-2.5 py-2 text-xs">
                          {[...row.errors, ...row.warnings].join(" ") || "Valid for provisioning"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button
                  type="button"
                  onClick={() => setConfirmCommitOpen(true)}
                  disabled={busy || summary.creatable === 0}
                >
                  <UserPlus className="mr-1.5 size-4" aria-hidden="true" /> Provision{" "}
                  {summary.creatable} Employee Account{summary.creatable === 1 ? "" : "s"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setRows(null);
                    setSummary(null);
                    setRawRows([]);
                  }}
                >
                  Cancel
                </Button>
                {progress ? (
                  <span role="status" aria-live="polite" className="text-sm text-muted-foreground animate-pulse">
                    {progress}
                  </span>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Provisioning Outcome Banner if just executed */}
        {lastResults ? (
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-600" />
                Provisioning Batch Result
              </CardTitle>
              <CardDescription>
                Accounts have been created in Supabase Auth with server-claimed sequential employee IDs.
                Setup emails are NOT sent automatically — you can review and dispatch them below.
              </CardDescription>
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
              <div className="max-h-48 overflow-auto rounded-md border border-border text-xs">
                <table className="w-full text-left">
                  <thead className="border-b bg-muted px-2 py-1 text-muted-foreground">
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
                        <td className="px-2.5 py-1 font-mono font-medium">{c.employeeCode ?? "—"}</td>
                        <td className="px-2.5 py-1">{c.fullName}</td>
                        <td className="px-2.5 py-1 font-mono">{c.workEmail}</td>
                        <td className="px-2.5 py-1">
                          <Badge variant={c.outcome === "created" ? "success" : "secondary"}>
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

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmCommitOpen} onOpenChange={setConfirmCommitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Provision {summary?.creatable ?? 0} employee account{(summary?.creatable ?? 0) === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This will provision user accounts directly via Supabase Auth Admin API with sequential
                employee IDs atomically claimed from the server sequence.
              </p>
              <p className="font-semibold text-foreground">
                Account setup emails are NOT sent automatically during creation.
              </p>
              <p className="text-xs text-muted-foreground">
                You can review provisioned accounts and trigger time-limited, single-use account setup emails
                individually or in bulk via Hostinger SMTP at any time from the management table.
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
