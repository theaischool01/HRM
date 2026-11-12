import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AccessDenied, errorToAccessScreen } from "@/components/access-denied";
import { actorQueryOptions, useActor } from "@/hooks/use-actor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { downloadCsv, toCsv } from "@/lib/csv";
import { downloadXlsx, reportFileName } from "@/lib/xlsx-export";
import { ATTENDANCE_WORK_MODE_LABELS } from "@/lib/enums";
import { canExportReports } from "@/lib/permissions";
import { buildAttendanceReport, getReportFilterOptions } from "@/lib/reports.functions";
import { startOfMonthIso, todayIso } from "@/lib/timezone";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "Attendance Reports | The AI School HRM" },
      {
        name: "description",
        content:
          "Employee-wise and project-wise attendance exports with productive hours, targets and geofence status.",
      },
      { property: "og:title", content: "Attendance Reports | The AI School HRM" },
      {
        property: "og:description",
        content: "Filtered CSV and Excel attendance exports built from live daily-cycle metrics.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(actorQueryOptions),
  component: ReportsPage,
  errorComponent: ({ error }) => errorToAccessScreen(error),
});

const ALL = "__all__";
const PAGE_SIZE = 50;
const CATEGORIES = [
  ["full_time", "Full time"],
  ["intern", "Intern"],
  ["freelancer", "Freelancer"],
  ["trainer", "Trainer"],
] as const;

function ReportsPage() {
  useSuspenseQuery(actorQueryOptions);
  const actor = useActor();
  const allowed = canExportReports(actor.roles, actor.permissions);

  const [type, setType] = useState<"employee" | "project">("employee");
  const [from, setFrom] = useState(() => startOfMonthIso());
  const [to, setTo] = useState(() => todayIso());
  const [projectId, setProjectId] = useState(ALL);
  const [departmentId, setDepartmentId] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [userId, setUserId] = useState(ALL);
  const [workMode, setWorkMode] = useState(ALL);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Record<string, string | number | null>[] | null>(null);
  const [page, setPage] = useState(0);

  const { data: options } = useQuery({
    queryKey: ["report-options"],
    queryFn: () => getReportFilterOptions(),
    enabled: allowed,
  });

  if (!allowed) {
    return (
      <AccessDenied
        kind="forbidden"
        detail="Attendance exports are available to Super Admin, Founder, HR, Admin and Manager only."
      />
    );
  }

  const hasOptionalFilters =
    projectId !== ALL ||
    departmentId !== ALL ||
    category !== ALL ||
    userId !== ALL ||
    workMode !== ALL;

  function resetPreview() {
    setPreview(null);
    setPage(0);
  }

  function resetOptionalFilters() {
    setProjectId(ALL);
    setDepartmentId(ALL);
    setCategory(ALL);
    setUserId(ALL);
    setWorkMode(ALL);
    resetPreview();
  }

  const filter = {
    from,
    to,
    projectIds: projectId === ALL ? null : [projectId],
    departmentIds: departmentId === ALL ? null : [departmentId],
    categories: category === ALL ? null : [category],
    userIds: userId === ALL ? null : [userId],
    workModes: workMode === ALL ? null : [workMode],
  };

  async function generate(): Promise<Record<string, string | number | null>[] | null> {
    setBusy(true);
    try {
      const result = await buildAttendanceReport({ data: { type, filter } });
      setPreview(result.rows);
      setPage(0);
      if (result.rows.length === 0) toast.info("No attendance rows matched those filters.");
      return result.rows;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The export could not be generated.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const prefix = type === "employee" ? "employee_attendance" : "project_attendance";

  async function exportCsv() {
    const rows = preview ?? (await generate());
    if (!rows?.length) return;
    const columns = Object.keys(rows[0]!).map((key) => ({
      key,
      header: key,
      value: (row: Record<string, string | number | null>) => row[key],
    }));
    downloadCsv(reportFileName(prefix, from, to, "csv"), toCsv(rows, columns));
  }

  async function exportXlsx() {
    const rows = preview ?? (await generate());
    if (!rows?.length) return;
    await downloadXlsx(
      reportFileName(prefix, from, to, "xlsx"),
      type === "employee" ? "Employee Attendance" : "Project Attendance",
      rows,
    );
  }

  const headers = preview?.[0] ? Object.keys(preview[0]) : [];
  const totalRows = preview?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pagedRows = preview ? preview.slice(pageStart, pageStart + PAGE_SIZE) : [];

  return (
    <AppShell
      title="Attendance reports"
      description="Employee-wise and project-wise exports built from the same metrics the dashboards use."
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Export options</CardTitle>
            <CardDescription>
              The date range is required; every other filter is optional.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="report-type">Export type</Label>
              <Select
                value={type}
                onValueChange={(v) => {
                  setType(v as typeof type);
                  resetPreview();
                }}
              >
                <SelectTrigger id="report-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee-wise attendance</SelectItem>
                  <SelectItem value="project">Project-wise attendance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="from">From</Label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  resetPreview();
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  resetPreview();
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-project">Project</Label>
              <Select
                value={projectId}
                onValueChange={(v) => {
                  setProjectId(v);
                  resetPreview();
                }}
              >
                <SelectTrigger id="report-project">
                  <SelectValue placeholder="All projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All projects</SelectItem>
                  {(options?.projects ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-department">Department</Label>
              <Select
                value={departmentId}
                onValueChange={(v) => {
                  setDepartmentId(v);
                  resetPreview();
                }}
              >
                <SelectTrigger id="report-department">
                  <SelectValue placeholder="All departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All departments</SelectItem>
                  {(options?.departments ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-category">Employment type</Label>
              <Select
                value={category}
                onValueChange={(v) => {
                  setCategory(v);
                  resetPreview();
                }}
              >
                <SelectTrigger id="report-category">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All types</SelectItem>
                  {CATEGORIES.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-employee">Employee</Label>
              <Select
                value={userId}
                onValueChange={(v) => {
                  setUserId(v);
                  resetPreview();
                }}
              >
                <SelectTrigger id="report-employee">
                  <SelectValue placeholder="Everyone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Everyone</SelectItem>
                  {(options?.people ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-workmode">Work mode</Label>
              <Select
                value={workMode}
                onValueChange={(v) => {
                  setWorkMode(v);
                  resetPreview();
                }}
              >
                <SelectTrigger id="report-workmode">
                  <SelectValue placeholder="All modes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All modes</SelectItem>
                  {Object.entries(ATTENDANCE_WORK_MODE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Button onClick={() => void generate()} disabled={busy || !from || !to}>
                {busy ? "Generating…" : "Generate preview"}
              </Button>
              {hasOptionalFilters ? (
                <Button variant="ghost" onClick={resetOptionalFilters} disabled={busy}>
                  Reset filters
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {preview ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base tabular-nums">
                {totalRows} {totalRows === 1 ? "row" : "rows"}
              </CardTitle>
              <CardDescription>
                {totalRows === 0
                  ? "No attendance rows matched the selected filters."
                  : `Showing rows ${pageStart + 1}–${Math.min(pageStart + PAGE_SIZE, totalRows)} of ${totalRows}; the downloaded export contains all ${totalRows} rows.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {totalRows > 0 ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void exportCsv()}
                        disabled={busy}
                      >
                        <Download className="mr-1.5 size-4" /> Download CSV
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void exportXlsx()}
                        disabled={busy}
                      >
                        <Download className="mr-1.5 size-4" /> Download Excel
                      </Button>
                    </div>
                    {totalPages > 1 ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={safePage === 0}
                          onClick={() => setPage((p) => Math.max(0, p - 1))}
                        >
                          Previous
                        </Button>
                        <span className="tabular-nums">
                          Page {safePage + 1} of {totalPages}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={safePage >= totalPages - 1}
                          onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                        >
                          Next
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="max-h-[28rem] overflow-auto rounded-md border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted text-left uppercase tracking-wide">
                        <tr>
                          {headers.map((h) => (
                            <th key={h} scope="col" className="whitespace-nowrap px-2.5 py-2">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pagedRows.map((row, i) => (
                          <tr key={pageStart + i} className={i % 2 ? "bg-muted/40" : undefined}>
                            {headers.map((h) => (
                              <td key={h} className="whitespace-nowrap px-2.5 py-1.5">
                                {row[h] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
                  Adjust the date range or optional filters above and generate again.
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
