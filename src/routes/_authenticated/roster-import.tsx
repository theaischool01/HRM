import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AccessDenied, errorToAccessScreen } from "@/components/access-denied";
import { HubSubNav, ONBOARDING_HUB_TABS } from "@/components/hub-subnav";
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
import { runInvitationDispatch } from "@/lib/invitations.functions";
import {
  ROSTER_COLUMNS,
  TEMPLATE_SAMPLE_ROWS,
  gridToRosterRaw,
  type RosterRaw,
  type RosterRow,
} from "@/lib/roster-import";
import {
  commitRosterImport,
  validateRosterUpload,
  type RosterCommitResult,
} from "@/lib/roster-import.functions";
import { downloadXlsx } from "@/lib/xlsx-export";

export const Route = createFileRoute("/_authenticated/roster-import")({
  head: () => ({
    meta: [
      { title: "Roster Import | The AI School HRM" },
      {
        name: "description",
        content:
          "Bulk-invite employees from a CSV or Excel roster with row-level validation before anything is written.",
      },
      { property: "og:title", content: "Roster Import | The AI School HRM" },
      {
        property: "og:description",
        content: "Validate and bulk-invite an employee roster in one pass.",
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

const TEMPLATE_ROWS = TEMPLATE_SAMPLE_ROWS.map((row) =>
  Object.fromEntries(ROSTER_COLUMNS.map((col, i) => [col, row[i] ?? ""])),
);

function RosterImportPage() {
  useSuspenseQuery(actorQueryOptions);
  const actor = useActor();
  const [fileName, setFileName] = useState("");
  const [raw, setRaw] = useState<RosterRaw[]>([]);
  const [rows, setRows] = useState<RosterRow[] | null>(null);
  const [summary, setSummary] = useState<{
    total: number;
    valid: number;
    warning: number;
    error: number;
    importable: number;
  } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [confirmCommitOpen, setConfirmCommitOpen] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: number;
    skipped: number;
    failed: number;
    results: RosterCommitResult[];
  } | null>(null);

  const visible = useMemo(() => {
    if (!rows) return [];
    if (filter === "all") return rows;
    return rows.filter((r) => r.severity === filter);
  }, [rows, filter]);

  if (!actor.can("workforce:create:all") || !actor.can("invitations:create:all")) {
    return (
      <AccessDenied
        kind="forbidden"
        detail="Bulk employee imports are available to Super Admin, Admin and HR only."
      />
    );
  }

  function downloadTemplate(kind: "csv" | "xlsx") {
    if (kind === "csv") {
      downloadCsv(
        "employee_roster_template.csv",
        toCsv(
          TEMPLATE_ROWS,
          ROSTER_COLUMNS.map((c) => ({
            key: c,
            header: c,
            value: (r: Record<string, string>) => r[c],
          })),
        ),
      );
    } else {
      void downloadXlsx("employee_roster_template.xlsx", "Roster", TEMPLATE_ROWS);
    }
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const XLSX = await import("xlsx");
      const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
      // CSV cells must stay verbatim: SheetJS otherwise guesses dates and
      // rewrites "2026-09-01" as "9/1/26" before validation ever sees it.
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
          // Preserve calendar date in IST/local time rather than shifting -1 day via UTC toISOString()
          return new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Kolkata",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(cell);
        }),
      );
      const parsed = gridToRosterRaw(grid);

      if (parsed.length === 0) throw new Error("No data rows were found in that file.");
      setFileName(file.name);
      setRaw(parsed);
      const validated = await validateRosterUpload({
        data: { fileName: file.name, rows: parsed },
      });
      setRows(validated.rows as RosterRow[]);
      setSummary(validated.summary);
      setFilter("all");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!rows) return;
    setBusy(true);
    setConfirmCommitOpen(false);
    setProgress(`Queuing ${summary?.importable ?? 0} invitations…`);
    try {
      const outcome = await commitRosterImport({ data: { fileName, rows: raw } });
      setResult(outcome);
      setProgress(`Dispatching invitations…`);
      const dispatch = await runInvitationDispatch();
      toast.success(
        `${outcome.created} invited · ${outcome.skipped} skipped · ${outcome.failed} failed (${dispatch.sent} emails sent this pass).`,
      );
      setRows(null);
      setSummary(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The import could not be completed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <AppShell
      title="Bulk roster import"
      description="Upload a roster, review every row, then queue invitations through the throttled invite queue."
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1 · Upload the roster</CardTitle>
            <CardDescription>
              CSV or Excel with the template columns. Employee IDs (TAS-001, ...) are automatically
              assigned sequentially on account provisioning.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="roster">Roster file (.csv, .xlsx, .xls)</Label>
            <Input
              id="roster"
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={onFile}
              disabled={busy}
            />
            {fileName ? (
              <p className="break-words text-xs text-muted-foreground">Selected: {fileName}</p>
            ) : null}
          </CardContent>
        </Card>

        {rows && summary ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2 · Review {summary.total} rows</CardTitle>
              <CardDescription>
                {summary.valid} valid · {summary.warning} with warnings · {summary.error} with
                errors. Rows with errors are skipped automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    ["all", `All rows (${summary.total})`],
                    ["error", `Errors only (${summary.error})`],
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={summary.error === 0}
                  onClick={() =>
                    downloadCsv(
                      `roster_errors_${fileName.replace(/\.[^.]+$/, "")}.csv`,
                      toCsv(
                        rows.filter((r) => r.severity === "error"),
                        [
                          { key: "row", header: "Row", value: (r) => r.rowNumber },
                          ...ROSTER_COLUMNS.map((c) => ({
                            key: c,
                            header: c,
                            value: (r: RosterRow) => r.raw[c] ?? "",
                          })),
                          { key: "reason", header: "Reason", value: (r) => r.errors.join(" ") },
                        ],
                      ),
                    )
                  }
                >
                  <Download className="mr-1.5 size-4" aria-hidden="true" /> Export errors CSV
                </Button>
              </div>

              <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
                <table className="w-full min-w-[780px] text-sm">
                  <thead className="sticky top-0 z-10 border-b border-border bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-2.5 py-2">
                        #
                      </th>
                      <th scope="col" className="px-2.5 py-2">
                        State
                      </th>
                      <th scope="col" className="px-2.5 py-2">
                        Name
                      </th>
                      <th scope="col" className="px-2.5 py-2">
                        Email
                      </th>
                      <th scope="col" className="px-2.5 py-2">
                        Type
                      </th>
                      <th scope="col" className="px-2.5 py-2">
                        Designation
                      </th>
                      <th scope="col" className="px-2.5 py-2">
                        Department
                      </th>
                      <th scope="col" className="px-2.5 py-2">
                        Joining
                      </th>
                      <th scope="col" className="px-2.5 py-2">
                        Lead
                      </th>
                      <th scope="col" className="px-2.5 py-2">
                        Validation Notes
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {visible.map((row) => (
                      <tr
                        key={row.rowNumber}
                        className={
                          row.severity === "error"
                            ? "bg-destructive/8"
                            : row.severity === "warning"
                              ? "bg-amber-500/8"
                              : "bg-emerald-500/5"
                        }
                      >
                        <td className="px-2.5 py-2 font-mono text-xs">{row.rowNumber}</td>
                        <td className="px-2.5 py-2">
                          <Badge
                            variant={
                              row.severity === "error"
                                ? "destructive"
                                : row.severity === "warning"
                                  ? "warning"
                                  : "success"
                            }
                          >
                            {row.severity === "error"
                              ? "Error"
                              : row.severity === "warning"
                                ? "Warning"
                                : "Ready"}
                          </Badge>
                        </td>
                        <td className="px-2.5 py-2 font-medium">{row.fullName || "—"}</td>
                        <td className="px-2.5 py-2 text-xs">{row.raw["Work Email"] || "—"}</td>
                        <td className="px-2.5 py-2 text-xs">
                          {row.employmentType ?? row.raw["Employment Type"] ?? "—"}
                        </td>
                        <td className="px-2.5 py-2 text-xs">{row.designation || "—"}</td>
                        <td className="px-2.5 py-2 text-xs">{row.departmentName ?? "—"}</td>
                        <td className="px-2.5 py-2 font-mono text-xs">
                          {row.joiningDate ?? row.raw["Joining Date"] ?? "—"}
                        </td>
                        <td className="px-2.5 py-2 text-xs">{row.reportingLeadEmail ?? "—"}</td>
                        <td className="px-2.5 py-2 text-xs">
                          {[...row.errors, ...row.warnings].join(" ") || "Valid for import"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  onClick={() => setConfirmCommitOpen(true)}
                  disabled={busy || summary.importable === 0}
                >
                  <Upload className="mr-1.5 size-4" aria-hidden="true" /> Import{" "}
                  {summary.importable} valid row{summary.importable === 1 ? "" : "s"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setRows(null);
                    setSummary(null);
                    setRaw([]);
                  }}
                >
                  Cancel
                </Button>
                {progress ? (
                  <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
                    {progress}
                  </span>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {result ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Import summary</CardTitle>
              <CardDescription>
                Invited accounts land in Profile Pending once the person accepts their invite.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="success">{result.created} created</Badge>
                <Badge variant="secondary">{result.skipped} skipped</Badge>
                <Badge variant="destructive">{result.failed} failed</Badge>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadCsv(
                    "roster_import_result.csv",
                    toCsv(result.results, [
                      { key: "row", header: "Row", value: (r) => r.rowNumber },
                      { key: "name", header: "Full Name", value: (r) => r.fullName },
                      { key: "email", header: "Work Email", value: (r) => r.email },
                      { key: "outcome", header: "Outcome", value: (r) => r.outcome },
                      { key: "reason", header: "Reason", value: (r) => r.reason },
                    ]),
                  )
                }
              >
                <Download className="mr-1.5 size-4" aria-hidden="true" /> Download full result CSV
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <AlertDialog open={confirmCommitOpen} onOpenChange={setConfirmCommitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Queue and dispatch {summary?.importable ?? 0} employee invitations?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This creates invitation records for all {summary?.importable ?? 0} importable rows in{" "}
              <strong>{fileName}</strong> and immediately runs the throttled invitation dispatcher.
              {summary && summary.error > 0
                ? ` (${summary.error} row(s) with errors will be skipped.)`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void runImport();
              }}
            >
              {busy ? "Importing…" : "Confirm & import"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
