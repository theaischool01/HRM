import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Building2, CalendarDays, Download, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { HubSubNav, ORG_HUB_TABS } from "@/components/hub-subnav";
import { errorToAccessScreen } from "@/components/access-denied";
import { actorQueryOptions, useActor } from "@/hooks/use-actor";
import { OVERSIGHT_CSV_COLUMNS, OversightTable } from "@/components/oversight-table";
import {
  deleteCalendarDay,
  getOversight,
  listAnnouncements,
  listAuditLog,
  listCalendarDays,
  listTeamEods,
  publishAnnouncement,
  upsertCalendarDay,
} from "@/lib/oversight.functions";
import { getPermissionMatrix, setRolePermission } from "@/lib/rbac.functions";
import { downloadCsv, toCsv } from "@/lib/csv";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/daily.server";
import {
  getOrgReference,
  listWorkforce,
  setDepartmentManagers,
  upsertDepartment,
} from "@/lib/workforce.functions";
import { daysAgoIso, todayIso } from "@/lib/timezone";
import { APP_ROLES, ROLE_LABELS, type AppRole } from "@/lib/permissions";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/org")({
  head: () => ({
    meta: [
      { title: "Organisation console | The AI School HRM" },
      {
        name: "description",
        content:
          "Organisation-wide attendance, productivity trends, consolidated EOD reports, announcements and the audit trail.",
      },
      { property: "og:title", content: "Organisation console | The AI School HRM" },
      {
        property: "og:description",
        content: "Org metrics, consolidated EODs, announcements and audit history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(actorQueryOptions),
  component: OrgPage,
  errorComponent: ({ error }) => errorToAccessScreen(error),
});

function OrgPage() {
  const actor = useActor();
  const queryClient = useQueryClient();
  const [range, setRange] = useState(() => ({
    from: daysAgoIso(13),
    to: todayIso(),
  }));

  const { data } = useSuspenseQuery({
    queryKey: ["oversight", "org", range.from, range.to],
    queryFn: () => getOversight({ data: range }),
  });
  const { data: eods } = useQuery({
    queryKey: ["org-eods", range.from, range.to],
    queryFn: () => listTeamEods({ data: range }),
  });
  const { data: announcements = [] } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => listAnnouncements(),
  });
  const { data: workforce = [] } = useQuery({
    queryKey: ["workforce"],
    queryFn: () => listWorkforce(),
  });
  const unassigned = workforce.filter((p) => p.missingReportingLead);

  const canAudit = actor.can("audit:read:all");
  const canManageOrg = actor.can("org:manage:all");
  const canAssignDeptManagers = canManageOrg || actor.can("workforce:update:all");
  const canManageRbac = actor.can("rbac:manage:all");
  const isSuperAdmin = actor.roles.includes("super_admin");

  const { data: audit = [] } = useQuery({
    queryKey: ["audit-log"],
    queryFn: () => listAuditLog(),
    enabled: canAudit,
  });

  const { data: orgRef } = useQuery({
    queryKey: ["org-reference"],
    queryFn: () => getOrgReference(),
  });

  const { data: calendarDays = [] } = useQuery({
    queryKey: ["calendar-days"],
    queryFn: () => listCalendarDays(),
  });

  const { data: rbacMatrix } = useQuery({
    queryKey: ["rbac-matrix"],
    queryFn: () => getPermissionMatrix(),
    enabled: canAudit || canManageRbac,
  });

  const canAnnounce = actor.can("announcements:manage:all");
  const [draft, setDraft] = useState({ title: "", body: "" });
  const [deptDraft, setDeptDraft] = useState({ name: "", code: "", leadUserId: "" });
  const [calDraft, setCalDraft] = useState({
    workDate: "",
    kind: "holiday" as "holiday" | "weekly_off",
    label: "",
  });
  const [rbacQuery, setRbacQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmDeleteCal, setConfirmDeleteCal] = useState<{
    id: string;
    date: string;
    label: string;
  } | null>(null);
  const [confirmPermToggle, setConfirmPermToggle] = useState<{
    role: AppRole;
    permissionKey: string;
    enabled: boolean;
  } | null>(null);

  async function publish() {
    setBusy(true);
    try {
      await publishAnnouncement({ data: draft });
      setDraft({ title: "", body: "" });
      setConfirmPublish(false);
      await queryClient.invalidateQueries({ queryKey: ["announcements"] });
      toast.success("Announcement published.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDepartment(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const autoCode =
        deptDraft.code.trim() ||
        deptDraft.name
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_")
          .slice(0, 12);
      const result = await upsertDepartment({
        data: {
          name: deptDraft.name.trim(),
          code: autoCode,
        },
      });
      if (deptDraft.leadUserId && result.department?.id) {
        await setDepartmentManagers({
          data: { departmentId: result.department.id, managerIds: [deptDraft.leadUserId] },
        });
      }
      setDeptDraft({ name: "", code: "", leadUserId: "" });
      await queryClient.invalidateQueries({ queryKey: ["org-reference"] });
      toast.success("Department saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save department.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCalendarEntry(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await upsertCalendarDay({
        data: {
          calendarDate: calDraft.workDate,
          kind: calDraft.kind,
          label: calDraft.label.trim() || null,
        },
      });
      setCalDraft({ workDate: "", kind: "holiday", label: "" });
      await queryClient.invalidateQueries({ queryKey: ["calendar-days"] });
      toast.success("Calendar date saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save calendar date.");
    } finally {
      setBusy(false);
    }
  }

  async function removeCalendarEntry(id: string) {
    setBusy(true);
    try {
      await deleteCalendarDay({ data: { id } });
      setConfirmDeleteCal(null);
      await queryClient.invalidateQueries({ queryKey: ["calendar-days"] });
      toast.success("Calendar date removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove calendar date.");
    } finally {
      setBusy(false);
    }
  }

  async function togglePermission(role: AppRole, permissionKey: string, enabled: boolean) {
    setBusy(true);
    try {
      await setRolePermission({ data: { role, permissionKey, enabled } });
      setConfirmPermToggle(null);
      await queryClient.invalidateQueries({ queryKey: ["rbac-matrix"] });
      await queryClient.invalidateQueries({ queryKey: ["audit-log"] });
      toast.success(
        `${enabled ? "Granted" : "Revoked"} ${permissionKey} for ${ROLE_LABELS[role] ?? role}.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update permission.");
    } finally {
      setBusy(false);
    }
  }

  const showGovernanceTab = Boolean(rbacMatrix || canAudit);
  const filteredPermissions = (rbacMatrix?.permissions ?? []).filter((perm) => {
    const q = rbacQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      perm.key.toLowerCase().includes(q) ||
      (perm.description ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <AppShell
      title="Organisation console"
      description={`${data.summary.people} people · ${data.summary.days} attendance days · ${range.from} → ${range.to}`}
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            downloadCsv(
              `org-attendance-${range.from}-to-${range.to}.csv`,
              toCsv(data.rows, OVERSIGHT_CSV_COLUMNS),
            )
          }
        >
          <Download className="mr-1.5 size-4" /> Export CSV
        </Button>
      }
    >
      <HubSubNav tabs={ORG_HUB_TABS} />
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview & Attendance</TabsTrigger>
          <TabsTrigger value="structure">
            Departments & Calendar ({(orgRef?.departments ?? []).length})
          </TabsTrigger>
          <TabsTrigger value="announcements">
            Announcements ({announcements.length})
          </TabsTrigger>
          {showGovernanceTab ? (
            <TabsTrigger value="governance">RBAC & Audit</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="org-from" className="text-xs text-muted-foreground">
                From date
              </Label>
              <Input
                id="org-from"
                type="date"
                className="h-9 w-40"
                value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="org-to" className="text-xs text-muted-foreground">
                To date
              </Label>
              <Input
                id="org-to"
                type="date"
                className="h-9 w-40"
                value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="People with activity" value={data.summary.people} />
            <Stat label="Worked hours" value={`${data.summary.workedHours}h`} />
            <Stat label="Units completed" value={data.summary.unitsCompleted} />
            <Stat
              label="Avg target achievement"
              value={
                data.summary.avgAchievementPct != null ? `${data.summary.avgAchievementPct}%` : "—"
              }
            />
            <Stat label="Days needing attention" value={data.summary.problemDays} />
          </div>

          {unassigned.length > 0 ? (
            <Card className="border-amber-500/40 bg-amber-500/10">
              <CardHeader>
                <CardTitle className="text-base text-amber-900 dark:text-amber-200">
                  {unassigned.length} {unassigned.length === 1 ? "person has" : "people have"} no
                  reporting lead
                </CardTitle>
                <CardDescription className="text-amber-900/80 dark:text-amber-200/80">
                  Their leave / WFH requests are blocked until a lead is assigned — select a person
                  below to assign one on their profile.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 text-sm">
                {unassigned.map((p) => (
                  <Link
                    key={p.id}
                    to="/workforce/$personId"
                    params={{ personId: p.id }}
                    className="rounded-md border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted"
                  >
                    {p.full_name}
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Attendance status mix</CardTitle>
              <CardDescription>Derived statuses, never manually set.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3 text-sm">
              {Object.entries(data.summary.byStatus).length === 0 ? (
                <p className="text-muted-foreground">No attendance records in this date range.</p>
              ) : null}
              {Object.entries(data.summary.byStatus).map(([status, count]) => (
                <div key={status} className="rounded-md border px-3 py-2">
                  <p className="text-lg font-semibold tabular-nums">{count}</p>
                  <p className="text-xs text-muted-foreground">
                    {ATTENDANCE_STATUS_LABELS[status] ?? status}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Attendance & productivity</CardTitle>
              <CardDescription>
                Org-level drill-down. People management lives on{" "}
                <Link to="/workforce" className="underline underline-offset-2">
                  Workforce
                </Link>{" "}
                — accounts are deactivated, never deleted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OversightTable rows={data.rows} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Consolidated EOD reports</CardTitle>
              <CardDescription>Most recent EOD submissions in the selected range.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(eods?.reports ?? []).length === 0 ? (
                <p className="text-muted-foreground">No EOD reports in this range.</p>
              ) : null}
              {(eods?.reports ?? []).slice(0, 30).map((report) => {
                const s: string = report.status;
                const variant =
                  s === "reviewed" || s === "approved" || s === "approved_with_comment"
                    ? "success"
                    : s === "revision_required" || s === "revision_requested"
                      ? "warning"
                      : s === "escalated" || s === "performance_concern"
                        ? "destructive"
                        : s === "submitted"
                          ? "info"
                          : "neutral";
                return (
                  <div key={report.id} className="space-y-1 rounded-md border p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        {(report.profiles as { full_name?: string } | null)?.full_name ?? "Employee"} ·{" "}
                        <span className="tabular-nums">{report.work_date}</span>
                      </p>
                      <Badge variant={variant} className="capitalize">
                        {report.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{report.highlights}</p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="structure" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="size-4 text-primary" /> Departments
                </CardTitle>
                <CardDescription>
                  Organisation departments and assigned department managers.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {canManageOrg ? (
                  <form
                    onSubmit={saveDepartment}
                    className="grid gap-2.5 rounded-md border p-3 sm:grid-cols-3"
                  >
                    <div className="space-y-1">
                      <Label htmlFor="dept-name" className="text-xs text-muted-foreground">
                        Department name
                      </Label>
                      <Input
                        id="dept-name"
                        placeholder="Engineering"
                        required
                        value={deptDraft.name}
                        onChange={(e) => setDeptDraft({ ...deptDraft, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="dept-code" className="text-xs text-muted-foreground">
                        Code
                      </Label>
                      <Input
                        id="dept-code"
                        placeholder="ENG"
                        value={deptDraft.code}
                        onChange={(e) => setDeptDraft({ ...deptDraft, code: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="dept-lead" className="text-xs text-muted-foreground">
                        Initial manager (optional)
                      </Label>
                      <div className="flex gap-2">
                        <select
                          id="dept-lead"
                          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                          value={deptDraft.leadUserId}
                          onChange={(e) => setDeptDraft({ ...deptDraft, leadUserId: e.target.value })}
                        >
                          <option value="">None</option>
                          {(orgRef?.people ?? []).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.full_name}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" size="sm" disabled={busy || !deptDraft.name.trim()}>
                          Add
                        </Button>
                      </div>
                    </div>
                  </form>
                ) : null}
                <div className="space-y-1.5">
                  {(orgRef?.departments ?? []).length === 0 ? (
                    <p className="text-muted-foreground">No departments configured.</p>
                  ) : null}
                  {(orgRef?.departments ?? []).map((d) => {
                    const assignedIds = (orgRef?.departmentManagers ?? [])
                      .filter((dm) => dm.department_id === d.id)
                      .map((dm) => dm.manager_id);
                    const assignedNames = assignedIds
                      .map((id) => orgRef?.people.find((p) => p.id === id)?.full_name)
                      .filter(Boolean);
                    const managerCandidates = workforce.filter((p) =>
                      p.roles.includes("manager"),
                    );
                    return (
                      <div
                        key={d.id}
                        className="space-y-2 rounded-md border px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{d.name}</span>
                          {d.code ? <Badge variant="outline">{d.code}</Badge> : null}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            Managers:{" "}
                            {assignedNames.length > 0 ? assignedNames.join(", ") : "None assigned"}
                          </span>
                          {canAssignDeptManagers && managerCandidates.length > 0 ? (
                            <select
                              aria-label={`Assign manager for ${d.name}`}
                              className="h-8 rounded border border-input bg-background px-2 text-xs text-foreground"
                              value=""
                              disabled={busy}
                              onChange={async (e) => {
                                const picked = e.target.value;
                                if (!picked) return;
                                const nextIds = assignedIds.includes(picked)
                                  ? assignedIds.filter((id) => id !== picked)
                                  : [...assignedIds, picked];
                                setBusy(true);
                                try {
                                  await setDepartmentManagers({
                                    data: { departmentId: d.id, managerIds: nextIds },
                                  });
                                  await queryClient.invalidateQueries({ queryKey: ["org-reference"] });
                                  toast.success("Department managers updated.");
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error ? err.message : "Could not update managers.",
                                  );
                                } finally {
                                  setBusy(false);
                                }
                              }}
                            >
                              <option value="">+ / − Manager…</option>
                              {managerCandidates.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {assignedIds.includes(m.id)
                                    ? `✓ ${m.full_name} (remove)`
                                    : m.full_name}
                                </option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarDays className="size-4 text-primary" /> Company Calendar
                </CardTitle>
                <CardDescription>
                  Declared holidays and weekly offs excluded from automated no-check-in flags.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {canManageOrg ? (
                  <form
                    onSubmit={saveCalendarEntry}
                    className="grid gap-2.5 rounded-md border p-3 sm:grid-cols-3"
                  >
                    <div className="space-y-1">
                      <Label htmlFor="cal-date" className="text-xs text-muted-foreground">
                        Date
                      </Label>
                      <Input
                        id="cal-date"
                        type="date"
                        required
                        value={calDraft.workDate}
                        onChange={(e) => setCalDraft({ ...calDraft, workDate: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="cal-kind" className="text-xs text-muted-foreground">
                        Type
                      </Label>
                      <select
                        id="cal-kind"
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                        value={calDraft.kind}
                        onChange={(e) =>
                          setCalDraft({
                            ...calDraft,
                            kind: e.target.value as "holiday" | "weekly_off",
                          })
                        }
                      >
                        <option value="holiday">Holiday</option>
                        <option value="weekly_off">Weekly off</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="cal-label" className="text-xs text-muted-foreground">
                        Label
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="cal-label"
                          placeholder="Diwali"
                          value={calDraft.label}
                          onChange={(e) => setCalDraft({ ...calDraft, label: e.target.value })}
                        />
                        <Button type="submit" size="sm" disabled={busy || !calDraft.workDate}>
                          Add
                        </Button>
                      </div>
                    </div>
                  </form>
                ) : null}
                <div className="max-h-72 space-y-1.5 overflow-y-auto">
                  {calendarDays.length === 0 ? (
                    <p className="text-muted-foreground">No holidays or weekly offs recorded.</p>
                  ) : null}
                  {calendarDays.map((day) => {
                    const displayLabel = day.label || day.kind.replace(/_/g, " ");
                    return (
                      <div
                        key={day.id}
                        className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
                      >
                        <div>
                          <span className="font-mono text-xs font-medium">{day.calendar_date}</span> ·{" "}
                          <span className="capitalize">{displayLabel}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={day.kind === "holiday" ? "info" : "neutral"}
                            className="text-[11px] capitalize"
                          >
                            {day.kind.replace(/_/g, " ")}
                          </Badge>
                          {canManageOrg ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              aria-label={`Remove ${day.calendar_date} (${displayLabel})`}
                              disabled={busy}
                              onClick={() =>
                                setConfirmDeleteCal({
                                  id: day.id,
                                  date: day.calendar_date,
                                  label: displayLabel,
                                })
                              }
                            >
                              <Trash2 className="size-3.5 text-muted-foreground" />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="announcements" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Announcements</CardTitle>
              <CardDescription>Org-wide notices visible across dashboards.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {canAnnounce ? (
                <div className="space-y-3 rounded-md border p-3">
                  <div className="space-y-1">
                    <Label htmlFor="ann-title" className="text-xs text-muted-foreground">
                      Announcement title
                    </Label>
                    <Input
                      id="ann-title"
                      placeholder="Title"
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ann-body" className="text-xs text-muted-foreground">
                      Message body
                    </Label>
                    <Textarea
                      id="ann-body"
                      rows={3}
                      placeholder="What do you want everyone in the organisation to know?"
                      value={draft.body}
                      onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={busy || !draft.title.trim() || !draft.body.trim()}
                    onClick={() => setConfirmPublish(true)}
                  >
                    Publish announcement
                  </Button>
                </div>
              ) : null}
              {announcements.length === 0 ? (
                <p className="text-muted-foreground">No announcements yet.</p>
              ) : null}
              {announcements.map((a) => (
                <div key={a.id} className="space-y-1 rounded-md border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">{a.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(a.published_at).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}{" "}
                      IST
                    </p>
                  </div>
                  <p className="whitespace-pre-line text-muted-foreground">{a.body}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {showGovernanceTab ? (
          <TabsContent value="governance" className="space-y-6">
            {rbacMatrix ? (
              <Card>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ShieldCheck className="size-4 text-primary" /> RBAC Permission Matrix
                    </CardTitle>
                    <CardDescription>
                      {isSuperAdmin
                        ? "Super Admin authority: toggle role permissions across the 7-tier hierarchy."
                        : "Read-only view of the active 7-tier role permission matrix. Only Super Admin can modify root permissions."}
                    </CardDescription>
                  </div>
                  <div className="w-full sm:w-64">
                    <Label htmlFor="rbac-search" className="sr-only">
                      Filter permissions
                    </Label>
                    <Input
                      id="rbac-search"
                      placeholder="Filter permissions…"
                      value={rbacQuery}
                      onChange={(e) => setRbacQuery(e.target.value)}
                    />
                  </div>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-xs">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left">
                        <th scope="col" className="sticky left-0 z-10 bg-muted/95 p-2 font-semibold">
                          Permission
                        </th>
                        {APP_ROLES.map((role) => (
                          <th key={role} scope="col" className="p-2 text-center font-semibold">
                            {ROLE_LABELS[role]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredPermissions.map((perm) => {
                        const grantedRoles = new Set(
                          rbacMatrix.rolePermissions
                            .filter((rp) => rp.permission_key === perm.key)
                            .map((rp) => rp.role),
                        );
                        return (
                          <tr key={perm.key} className="hover:bg-muted/20">
                            <th
                              scope="row"
                              className="sticky left-0 z-10 bg-card p-2 text-left font-normal"
                            >
                              <div className="font-mono font-medium text-foreground">
                                {perm.key}
                              </div>
                              {perm.description ? (
                                <div className="text-[11px] text-muted-foreground">
                                  {perm.description}
                                </div>
                              ) : null}
                            </th>
                            {APP_ROLES.map((role) => {
                              const has = role === "super_admin" || grantedRoles.has(role);
                              const editable = isSuperAdmin && role !== "super_admin";
                              return (
                                <td key={role} className="p-2 text-center">
                                  <input
                                    type="checkbox"
                                    className="size-4 accent-primary"
                                    aria-label={`${perm.key} for ${ROLE_LABELS[role] ?? role}`}
                                    checked={has}
                                    disabled={!editable || busy}
                                    onChange={(e) =>
                                      setConfirmPermToggle({
                                        role,
                                        permissionKey: perm.key,
                                        enabled: e.target.checked,
                                      })
                                    }
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            ) : null}

            {canAudit ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Audit trail</CardTitle>
                  <CardDescription>Latest 100 recorded security & operational actions (IST).</CardDescription>
                </CardHeader>
                <CardContent className="max-h-96 space-y-1.5 overflow-y-auto text-xs">
                  {audit.length === 0 ? (
                    <p className="text-muted-foreground">No audit entries recorded yet.</p>
                  ) : null}
                  {audit.map((entry) => (
                    <p key={entry.id} className="rounded border bg-muted/20 px-2.5 py-1.5 text-muted-foreground">
                      <span className="font-mono">
                        {new Date(entry.created_at).toLocaleString("en-IN", {
                          timeZone: "Asia/Kolkata",
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}{" "}
                        IST
                      </span>{" "}
                      · <span className="font-medium text-foreground">{entry.action}</span> ·{" "}
                      {entry.entity_type} · {entry.actor_email ?? "system"}
                    </p>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>
        ) : null}
      </Tabs>

      <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish organisation-wide announcement?</AlertDialogTitle>
            <AlertDialogDescription>
              “<span className="font-medium text-foreground">{draft.title}</span>” will immediately
              appear across employee and leadership dashboards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void publish();
              }}
            >
              {busy ? "Publishing…" : "Publish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(confirmDeleteCal)}
        onOpenChange={(o) => !o && setConfirmDeleteCal(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove calendar entry?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove <span className="font-medium text-foreground">{confirmDeleteCal?.label}</span>{" "}
              (<span className="font-mono">{confirmDeleteCal?.date}</span>) from the company
              calendar? Automated attendance rules will treat that date as a normal working day.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (confirmDeleteCal) void removeCalendarEntry(confirmDeleteCal.id);
              }}
            >
              {busy ? "Removing…" : "Remove date"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(confirmPermToggle)}
        onOpenChange={(o) => !o && setConfirmPermToggle(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmPermToggle?.enabled ? "Grant" : "Revoke"} role permission?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You are about to{" "}
              <span className="font-medium text-foreground">
                {confirmPermToggle?.enabled ? "grant" : "revoke"}
              </span>{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                {confirmPermToggle?.permissionKey}
              </code>{" "}
              for all users holding the{" "}
              <span className="font-medium text-foreground">
                {confirmPermToggle ? ROLE_LABELS[confirmPermToggle.role] : ""}
              </span>{" "}
              role. This takes effect immediately across UI, server functions, and RLS checks and is
              logged in the security audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (confirmPermToggle) {
                  void togglePermission(
                    confirmPermToggle.role,
                    confirmPermToggle.permissionKey,
                    confirmPermToggle.enabled,
                  );
                }
              }}
            >
              {busy ? "Updating…" : "Confirm permission change"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
