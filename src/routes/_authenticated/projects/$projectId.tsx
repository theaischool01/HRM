import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Pencil, UserPlus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { actorQueryOptions, useActor } from "@/hooks/use-actor";
import { errorToAccessScreen } from "@/components/access-denied";
import { PROJECT_SHIFT_LABELS, optionsOf } from "@/lib/enums";
import { getProject, updateProject } from "@/lib/projects.functions";
import { createAllocation, endAllocation, getAllocationLoad } from "@/lib/allocations.functions";
import { getOrgReference } from "@/lib/workforce.functions";
import {
  projectUsesProductionTargets,
  WORK_TYPE_LABELS,
  WORK_TYPES,
  workTypeLabel,
} from "@/lib/work-type";
import { todayIso } from "@/lib/timezone";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Project detail | The AI School HRM" },
      {
        name: "description",
        content:
          "Project terms, delivery targets, staffing and assignment acknowledgment status for a single AI School project.",
      },
      { property: "og:title", content: "Project detail | The AI School HRM" },
      {
        property: "og:description",
        content: "Project terms, targets, staffing and acknowledgment status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(actorQueryOptions),
  component: ProjectDetailPage,
  errorComponent: ({ error }) => errorToAccessScreen(error),
});

type OverAllocation = {
  usedPct: number;
  newPct: number;
  total: number;
  conflicts: string[];
};

function parseOverAllocation(error: unknown): OverAllocation | null {
  const message = error instanceof Error ? error.message : "";
  const marker = message.indexOf("OVER_ALLOCATION::");
  if (marker === -1) return null;
  try {
    return JSON.parse(message.slice(marker + "OVER_ALLOCATION::".length)) as OverAllocation;
  } catch {
    return null;
  }
}

function ProjectDetailPage() {
  const { projectId } = Route.useParams();
  const actor = useActor();
  const queryClient = useQueryClient();

  const { data } = useSuspenseQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject({ data: { id: projectId } }),
  });
  const { data: reference } = useSuspenseQuery({
    queryKey: ["org-reference"],
    queryFn: () => getOrgReference(),
  });

  const isScopedManager =
    data.project.project_manager_id === actor.userId ||
    Boolean(
      data.project.department_id &&
        reference.departmentManagers.some(
          (dm) => dm.department_id === data.project.department_id && dm.manager_id === actor.userId,
        ),
    );

  const canManageAllocations =
    actor.can("allocations:manage:all") ||
    (actor.can("allocations:manage:team") && isScopedManager);
  const canManageProject =
    actor.can("projects:manage:all") ||
    (actor.can("projects:manage:team") && isScopedManager);

  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<OverAllocation | null>(null);
  const [load, setLoad] = useState<{ usedPct: number } | null>(null);
  const [endTarget, setEndTarget] = useState<{ id: string; personName: string } | null>(null);
  const [editForm, setEditForm] = useState(() => ({
    name: data.project.name,
    clientName: data.project.client_name ?? "",
    description: data.project.description ?? "",
    startDate: data.project.start_date ?? "",
    endDate: data.project.end_date ?? "",
    departmentId: data.project.department_id ?? "",
    projectManagerId: data.project.project_manager_id ?? "",
    status: data.project.status,
    workMode: data.project.work_mode,
    shift: data.project.shift ?? "",
    taskUnit: data.project.task_unit,
    hourlyTaskTarget: data.project.hourly_task_target?.toString() ?? "",
    dailyTaskTarget: data.project.daily_task_target?.toString() ?? "",
    qualityTargetPct: data.project.quality_target_pct?.toString() ?? "",
    maxRejectionRatePct: data.project.max_rejection_rate_pct?.toString() ?? "",
    requiredHeadcount: data.project.required_headcount?.toString() ?? "1",
    projectLeadId: data.project.project_lead_id ?? "",
    teamLeadIds: data.teamLeads.map((l) => l.id),
    workType: (data.project.work_type as string | null) ?? "",
  }));

  useEffect(() => {
    setEditForm({
      name: data.project.name,
      clientName: data.project.client_name ?? "",
      description: data.project.description ?? "",
      startDate: data.project.start_date ?? "",
      endDate: data.project.end_date ?? "",
      departmentId: data.project.department_id ?? "",
      projectManagerId: data.project.project_manager_id ?? "",
      status: data.project.status,
      workMode: data.project.work_mode,
      shift: data.project.shift ?? "",
      taskUnit: data.project.task_unit,
      hourlyTaskTarget: data.project.hourly_task_target?.toString() ?? "",
      dailyTaskTarget: data.project.daily_task_target?.toString() ?? "",
      qualityTargetPct: data.project.quality_target_pct?.toString() ?? "",
      maxRejectionRatePct: data.project.max_rejection_rate_pct?.toString() ?? "",
      requiredHeadcount: data.project.required_headcount?.toString() ?? "1",
      projectLeadId: data.project.project_lead_id ?? "",
      teamLeadIds: data.teamLeads.map((l) => l.id),
      workType: (data.project.work_type as string | null) ?? "",
    });
  }, [data.project, data.teamLeads]);
  const [form, setForm] = useState(() => ({
    userId: "",
    reportingLeadId: "",
    roleInProject: "",
    startDate: todayIso(),
    endDate: "",
    hoursPerDay: "8",
    allocationPct: "100",
    dailyTaskTarget: "",
    qualityTargetPct: "",
    maxRejectionRatePct: "",
  }));

  const project = data.project;
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  async function pickPerson(userId: string) {
    setForm((f) => ({ ...f, userId }));
    setWarning(null);
    try {
      const result = await getAllocationLoad({ data: { userId } });
      setLoad({ usedPct: result.usedPct });
    } catch {
      setLoad(null);
    }
  }

  async function submit(override: boolean) {
    setBusy(true);
    try {
      const result = await createAllocation({
        data: {
          projectId,
          userId: form.userId,
          reportingLeadId: form.reportingLeadId || null,
          roleInProject: form.roleInProject || null,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          hoursPerDay: Number(form.hoursPerDay || 8),
          allocationPct: Number(form.allocationPct || 100),
          dailyTaskTarget: num(form.dailyTaskTarget),
          qualityTargetPct: num(form.qualityTargetPct),
          maxRejectionRatePct: num(form.maxRejectionRatePct),
          overAllocationOverride: override,
        },
      });
      toast.success(
        result.overAllocated
          ? `Allocated at ${result.totalPct}% total — this person is over-allocated.`
          : "Allocated. Waiting on their acknowledgment.",
      );
      setWarning(null);
      setOpen(false);
      setForm((f) => ({ ...f, userId: "", roleInProject: "" }));
      setLoad(null);
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch (error) {
      const over = parseOverAllocation(error);
      if (over) {
        setWarning(over);
      } else {
        toast.error(error instanceof Error ? error.message : "Could not allocate.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function end(id: string) {
    setBusy(true);
    try {
      await endAllocation({ data: { id } });
      toast.success("Allocation ended.");
      setEndTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not end the allocation.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProjectEdits() {
    const editTargets = !editForm.workType || projectUsesProductionTargets(editForm.workType);
    setBusy(true);
    try {
      await updateProject({
        data: {
          id: projectId,
          name: editForm.name,
          clientName: editForm.clientName || null,
          description: editForm.description || null,
          startDate: editForm.startDate || null,
          endDate: editForm.endDate || null,
          departmentId: editForm.departmentId || null,
          projectManagerId: editForm.projectManagerId || null,
          status: editForm.status,
          workMode: editForm.workMode,
          shift: editForm.shift || null,
          taskUnit: editForm.taskUnit,
          hourlyTaskTarget: editTargets ? num(editForm.hourlyTaskTarget) : null,
          dailyTaskTarget: editTargets ? num(editForm.dailyTaskTarget) : null,
          qualityTargetPct: editTargets ? num(editForm.qualityTargetPct) : null,
          maxRejectionRatePct: editTargets ? num(editForm.maxRejectionRatePct) : null,
          requiredHeadcount: Number(editForm.requiredHeadcount || 1),
          projectLeadId: editForm.projectLeadId || null,
          teamLeadIds: editForm.teamLeadIds,
          workType: editForm.workType || null,
        },
      });
      toast.success("Project terms and leads updated.");
      setEditOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update project.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title={project.name}
      description={`${project.code}${project.client_name ? ` · ${project.client_name}` : ""}`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link to="/projects">
              <ArrowLeft className="mr-1.5 size-4" />
              Projects
            </Link>
          </Button>
          {canManageProject ? (
            <Button size="sm" variant="outline" onClick={() => setEditOpen((v) => !v)}>
              <Pencil className="mr-1.5 size-3.5" />
              {editOpen ? "Close edit" : "Edit project"}
            </Button>
          ) : null}
          {canManageAllocations ? (
            <Button size="sm" onClick={() => setOpen((v) => !v)}>
              <UserPlus className="size-4" />
              {open ? "Close" : "Allocate someone"}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Terms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {project.description ? (
              <p className="rounded-md bg-muted/40 p-2.5 text-xs text-muted-foreground">
                {project.description}
              </p>
            ) : null}
            <Row label="Status" value={project.status.replace("_", " ")} />
            <Row label="Work mode" value={project.work_mode} />
            <Row label="Shift" value={project.shift ?? "—"} />
            <Row label="Work type" value={workTypeLabel(project.work_type as string | null)} />
            <Row label="Task unit" value={project.task_unit} />
            {!project.work_type || projectUsesProductionTargets(project.work_type as string) ? (
              <>
                <Row label="Hourly target" value={project.hourly_task_target ?? "—"} />
                <Row label="Daily target" value={project.daily_task_target ?? "—"} />
                <Row label="Quality target" value={project.quality_target_pct ? `${project.quality_target_pct}%` : "—"} />
                <Row label="Max rejection" value={project.max_rejection_rate_pct ? `${project.max_rejection_rate_pct}%` : "—"} />
              </>
            ) : null}
            <Row label="Headcount" value={`${data.allocations.filter((a) => a.status !== "ended").length}/${project.required_headcount}`} />
            <Row label="Dates" value={`${project.start_date ?? "—"} → ${project.end_date ?? "open"}`} />
            <Row
              label="Department"
              value={
                reference.departments.find((d) => d.id === project.department_id)?.name ?? "—"
              }
            />
            <Row label="Project manager" value={data.projectManager?.full_name ?? "—"} />
            <Row label="Project lead" value={data.projectLead?.full_name ?? "—"} />
            <Row
              label="Team leads"
              value={data.teamLeads.length ? data.teamLeads.map((l) => l.full_name).join(", ") : "—"}
            />
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {canManageProject && editOpen ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Edit project &amp; leads</CardTitle>
                <CardDescription>
                  Update project targets, work mode, primary project lead and assigned team leads.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <LabelledInput
                    label="Project name"
                    value={editForm.name}
                    onChange={(v) => setEditForm({ ...editForm, name: v })}
                  />
                  <LabelledInput
                    label="Client name"
                    value={editForm.clientName}
                    onChange={(v) => setEditForm({ ...editForm, clientName: v })}
                  />
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="edit-proj-desc" className="text-xs text-muted-foreground">
                      Description
                    </Label>
                    <Textarea
                      id="edit-proj-desc"
                      rows={2}
                      value={editForm.description}
                      onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    />
                  </div>
                  <LabelledInput
                    label="Start date"
                    type="date"
                    value={editForm.startDate}
                    onChange={(v) => setEditForm({ ...editForm, startDate: v })}
                  />
                  <LabelledInput
                    label="End date"
                    type="date"
                    value={editForm.endDate}
                    onChange={(v) => setEditForm({ ...editForm, endDate: v })}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-proj-worktype" className="text-xs text-muted-foreground">
                      Work type
                    </Label>
                    <select
                      id="edit-proj-worktype"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={editForm.workType}
                      onChange={(e) => setEditForm({ ...editForm, workType: e.target.value })}
                    >
                      <option value="" disabled={Boolean(project.work_type)}>
                        Unclassified
                      </option>
                      {WORK_TYPES.map((wt) => (
                        <option key={wt} value={wt}>
                          {WORK_TYPE_LABELS[wt]}
                        </option>
                      ))}
                    </select>
                  </div>                  <div className="space-y-1.5">
                    <Label htmlFor="edit-proj-status" className="text-xs text-muted-foreground">
                      Status
                    </Label>
                    <select
                      id="edit-proj-status"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={editForm.status}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          status: e.target.value as
                            | "draft"
                            | "active"
                            | "on_hold"
                            | "completed"
                            | "archived",
                        })
                      }
                    >
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="on_hold">On hold</option>
                      <option value="completed">Completed</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-proj-workmode" className="text-xs text-muted-foreground">
                      Work mode
                    </Label>
                    <select
                      id="edit-proj-workmode"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={editForm.workMode}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          workMode: e.target.value as "onsite" | "remote" | "hybrid",
                        })
                      }
                    >
                      <option value="onsite">Onsite</option>
                      <option value="remote">Remote</option>
                      <option value="hybrid">Hybrid</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-proj-shift" className="text-xs text-muted-foreground">
                      Shift
                    </Label>
                    <select
                      id="edit-proj-shift"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={editForm.shift}
                      onChange={(e) => setEditForm({ ...editForm, shift: e.target.value })}
                    >
                      <option value="">No fixed shift</option>
                      {optionsOf(PROJECT_SHIFT_LABELS).map((sh) => (
                        <option key={sh.value} value={sh.value}>
                          {sh.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <LabelledInput
                    label="Task unit"
                    value={editForm.taskUnit}
                    onChange={(v) => setEditForm({ ...editForm, taskUnit: v })}
                  />
                  <LabelledInput
                    label="Required headcount"
                    type="number"
                    value={editForm.requiredHeadcount}
                    onChange={(v) => setEditForm({ ...editForm, requiredHeadcount: v })}
                  />
                  {!editForm.workType || projectUsesProductionTargets(editForm.workType) ? (
                    <>
                  <LabelledInput
                    label="Hourly target"
                    type="number"
                    value={editForm.hourlyTaskTarget}
                    onChange={(v) => setEditForm({ ...editForm, hourlyTaskTarget: v })}
                  />
                  <LabelledInput
                    label="Daily target"
                    type="number"
                    value={editForm.dailyTaskTarget}
                    onChange={(v) => setEditForm({ ...editForm, dailyTaskTarget: v })}
                  />
                  <LabelledInput
                    label="Quality target %"
                    type="number"
                    value={editForm.qualityTargetPct}
                    onChange={(v) => setEditForm({ ...editForm, qualityTargetPct: v })}
                  />
                  <LabelledInput
                    label="Max rejection %"
                    type="number"
                    value={editForm.maxRejectionRatePct}
                    onChange={(v) => setEditForm({ ...editForm, maxRejectionRatePct: v })}
                  />
                    </>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-proj-department" className="text-xs text-muted-foreground">
                      Department
                    </Label>
                    <select
                      id="edit-proj-department"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={editForm.departmentId}
                      onChange={(e) => setEditForm({ ...editForm, departmentId: e.target.value })}
                    >
                      <option value="">No department</option>
                      {reference.departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-proj-manager" className="text-xs text-muted-foreground">
                      Project manager
                    </Label>
                    <select
                      id="edit-proj-manager"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={editForm.projectManagerId}
                      onChange={(e) =>
                        setEditForm({ ...editForm, projectManagerId: e.target.value })
                      }
                    >
                      <option value="">No project manager</option>
                      {reference.people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name}
                          {p.designation ? ` — ${p.designation}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="edit-proj-lead" className="text-xs text-muted-foreground">
                      Project lead
                    </Label>
                    <select
                      id="edit-proj-lead"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={editForm.projectLeadId}
                      onChange={(e) => setEditForm({ ...editForm, projectLeadId: e.target.value })}
                    >
                      <option value="">No project lead</option>
                      {reference.people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name}
                          {p.designation ? ` — ${p.designation}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <span className="block text-xs font-medium text-muted-foreground">
                      Team leads on this project
                    </span>
                    <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-md border p-2.5">
                      {reference.people.map((p) => {
                        const checked = editForm.teamLeadIds.includes(p.id);
                        return (
                          <label
                            key={p.id}
                            className="flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-xs hover:bg-muted/40"
                          >
                            <input
                              type="checkbox"
                              className="accent-primary"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...editForm.teamLeadIds, p.id]
                                  : editForm.teamLeadIds.filter((id) => id !== p.id);
                                setEditForm({ ...editForm, teamLeadIds: next });
                              }}
                            />
                            <span>{p.full_name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <Button onClick={saveProjectEdits} disabled={busy || !editForm.name.trim()}>
                  Save project changes
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {canManageAllocations && open ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Allocate someone</CardTitle>
                <CardDescription>
                  They must acknowledge the assignment before they can log any work against it.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="alloc-person" className="text-xs text-muted-foreground">
                      Person
                    </Label>
                    <Select value={form.userId} onValueChange={pickPerson}>
                      <SelectTrigger id="alloc-person">
                        <SelectValue placeholder="Select a person" />
                      </SelectTrigger>
                      <SelectContent>
                        {reference.people
                          .filter((p) => project.work_type !== "annotation" || p.work_type === "annotation")
                          .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.full_name}
                            {p.designation ? ` — ${p.designation}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {project.work_type === "annotation" ? (
                      <p className="text-xs text-muted-foreground">
                        Annotation project — only employees with the Annotation work type are listed.
                      </p>
                    ) : null}
                    {load ? (
                      <p className="text-xs text-muted-foreground">
                        Currently allocated {load.usedPct}% across live projects.
                      </p>
                    ) : null}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="alloc-reporting-lead" className="text-xs text-muted-foreground">
                      Reporting lead on this project
                    </Label>
                    <Select
                      value={form.reportingLeadId}
                      onValueChange={(v) => setForm({ ...form, reportingLeadId: v })}
                    >
                      <SelectTrigger id="alloc-reporting-lead">
                        <SelectValue placeholder="Select a lead" />
                      </SelectTrigger>
                      <SelectContent>
                        {reference.people.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <LabelledInput label="Role in project" value={form.roleInProject} onChange={(v) => setForm({ ...form, roleInProject: v })} />
                  <LabelledInput label="Allocation %" type="number" value={form.allocationPct} onChange={(v) => setForm({ ...form, allocationPct: v })} />
                  <LabelledInput label="Hours / day" type="number" value={form.hoursPerDay} onChange={(v) => setForm({ ...form, hoursPerDay: v })} />
                  <LabelledInput label="Start date" type="date" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} />
                  <LabelledInput label="End date" type="date" value={form.endDate} onChange={(v) => setForm({ ...form, endDate: v })} />
                  <LabelledInput label="Daily task target" type="number" value={form.dailyTaskTarget} onChange={(v) => setForm({ ...form, dailyTaskTarget: v })} />
                  <LabelledInput label="Quality target %" type="number" value={form.qualityTargetPct} onChange={(v) => setForm({ ...form, qualityTargetPct: v })} />
                  <LabelledInput label="Max rejection %" type="number" value={form.maxRejectionRatePct} onChange={(v) => setForm({ ...form, maxRejectionRatePct: v })} />
                </div>

                {warning ? (
                  <div
                    role="alert"
                    data-testid="over-allocation-warning"
                    className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200"
                  >
                    <p className="flex items-center gap-2 font-semibold">
                      <AlertTriangle className="size-4 shrink-0" />
                      Over-allocation: this would put them at {warning.total}%
                    </p>
                    <p className="mt-1">
                      Already allocated {warning.usedPct}% ({warning.conflicts.join(", ")}); adding{" "}
                      {warning.newPct}% exceeds 100% of their capacity.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setWarning(null)} disabled={busy}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => submit(true)} disabled={busy}>
                        Allocate anyway
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button onClick={() => submit(false)} disabled={busy || !form.userId}>
                    Allocate
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Team</CardTitle>
              <CardDescription>Acknowledgment is recorded per person with an IST timestamp.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {data.allocations.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                  Nobody is allocated to this project yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Person</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead className="text-right">Alloc</TableHead>
                        <TableHead>Acknowledged</TableHead>
                        <TableHead>
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.allocations.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>
                            <div className="font-medium">{a.person?.full_name ?? "Unknown"}</div>
                            <div className="text-xs text-muted-foreground">
                              Lead: {a.reportingLead?.full_name ?? "—"}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {a.role_in_project ?? "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{a.allocation_pct}%</TableCell>
                          <TableCell>
                            {a.status === "ended" ? (
                              <Badge variant="neutral">Ended</Badge>
                            ) : a.acknowledged_at ? (
                              <Badge variant="success">
                                {new Date(a.acknowledged_at).toLocaleString("en-IN", {
                                  timeZone: "Asia/Kolkata",
                                  dateStyle: "medium",
                                  timeStyle: "short",
                                })}{" "}
                                IST
                              </Badge>
                            ) : (
                              <Badge variant="warning">Pending</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {canManageAllocations && a.status !== "ended" ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() =>
                                  setEndTarget({
                                    id: a.id,
                                    personName: a.person?.full_name ?? "this team member",
                                  })
                                }
                              >
                                End
                              </Button>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={Boolean(endTarget)} onOpenChange={(o) => !o && setEndTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End project allocation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will end{" "}
              <span className="font-medium text-foreground">{endTarget?.personName}</span>&apos;s
              active allocation on <span className="font-medium text-foreground">{project.name}</span>.
              Historical task entries remain preserved, and they will no longer be able to log new
              hours against this assignment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (endTarget) void end(endTarget.id);
              }}
            >
              {busy ? "Ending…" : "End allocation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right font-medium capitalize">{value}</span>
    </div>
  );
}

function LabelledInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
