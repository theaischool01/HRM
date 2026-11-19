import {
  PROJECT_SHIFT_LABELS,
  PROJECT_WORK_MODE_LABELS,
  TASK_UNIT_LABELS,
  optionsOf,
} from "@/lib/enums";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FolderKanban, Plus, Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { actorQueryOptions, useActor } from "@/hooks/use-actor";
import { errorToAccessScreen } from "@/components/access-denied";
import { createProject, listProjects } from "@/lib/projects.functions";
import { describeUnknownError } from "@/lib/describe-error";
import { getOrgReference } from "@/lib/workforce.functions";
import { projectUsesProductionTargets, WORK_TYPE_LABELS, WORK_TYPES } from "@/lib/work-type";
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

const PROJECT_WORK_MODES = optionsOf(PROJECT_WORK_MODE_LABELS);
const PROJECT_SHIFTS = optionsOf(PROJECT_SHIFT_LABELS);
const TASK_UNIT_OPTIONS = optionsOf(TASK_UNIT_LABELS);

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({
    meta: [
      { title: "Projects | The AI School HRM" },
      {
        name: "description",
        content:
          "Client projects, delivery targets and staffing for The AI School — headcount, allocation and acknowledgment at a glance.",
      },
      { property: "og:title", content: "Projects | The AI School HRM" },
      {
        property: "og:description",
        content: "Client projects, delivery targets and staffing for The AI School.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(actorQueryOptions),
  component: ProjectsPage,
  errorComponent: ({ error }) => errorToAccessScreen(error),
});

function projectStatusVariant(
  status: string,
): "success" | "warning" | "info" | "neutral" | "secondary" {
  if (status === "active") return "success";
  if (status === "on_hold") return "warning";
  if (status === "completed") return "info";
  if (status === "draft" || status === "archived") return "neutral";
  return "secondary";
}

function ProjectsPage() {
  const actor = useActor();
  const queryClient = useQueryClient();
  const canManage = actor.can("projects:manage:all") || actor.can("projects:manage:team");
  const { data: projects } = useSuspenseQuery({
    queryKey: ["projects"],
    queryFn: () => listProjects(),
  });
  const { data: reference } = useSuspenseQuery({
    queryKey: ["org-reference"],
    queryFn: () => getOrgReference(),
  });

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.client_name ?? "").toLowerCase().includes(q)
      );
    });
  }, [projects, search, statusFilter]);
  const [form, setForm] = useState(() => ({
    code: "",
    name: "",
    clientName: "",
    description: "",
    departmentId: "",
    projectManagerId:
      actor.can("projects:manage:team") && !actor.can("projects:manage:all")
        ? actor.userId
        : "",
    startDate: "",
    endDate: "",
    projectLeadId: "",
    workMode: "remote",
    shift: "",
    taskUnit: "task",
    hourlyTaskTarget: "",
    dailyTaskTarget: "",
    qualityTargetPct: "",
    maxRejectionRatePct: "",
    requiredHeadcount: "1",
    status: "active",
    workType: "",
  }));

  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      toast.error("The end date cannot be before the start date.");
      return;
    }
    if (!form.workType) {
      toast.error("Choose the project work type.");
      return;
    }
    const isAnnotation = projectUsesProductionTargets(form.workType);
    setBusy(true);
    try {
      await createProject({
        data: {
          code: form.code,
          name: form.name,
          clientName: form.clientName || null,
          description: form.description || null,
          departmentId: form.departmentId || null,
          projectManagerId: form.projectManagerId || null,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          projectLeadId: form.projectLeadId || null,
          workMode: form.workMode,
          shift: form.shift || null,
          taskUnit: form.taskUnit,
          hourlyTaskTarget: isAnnotation ? num(form.hourlyTaskTarget) : null,
          dailyTaskTarget: isAnnotation ? num(form.dailyTaskTarget) : null,
          qualityTargetPct: isAnnotation ? num(form.qualityTargetPct) : null,
          maxRejectionRatePct: isAnnotation ? num(form.maxRejectionRatePct) : null,
          requiredHeadcount: Number(form.requiredHeadcount || 0),
          status: form.status,
          workType: form.workType,
        },
      });
      toast.success("Project created.");
      setOpen(false);
      setForm({ ...form, code: "", name: "", clientName: "", description: "" });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch (error) {
      toast.error(describeUnknownError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Projects"
      description="Client delivery work, its targets and who is staffed on it."
      actions={
        canManage ? (
          <Button size="sm" onClick={() => setOpen((v) => !v)}>
            <Plus className="size-4" />
            {open ? "Close" : "New project"}
          </Button>
        ) : null
      }
    >
      {canManage && open ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">New project</CardTitle>
            <CardDescription>Targets set here become the default for everyone allocated to it.</CardDescription>
          </CardHeader>
          <CardContent>
            {!actor.can("projects:manage:all") && (
              <div className="mb-4 rounded-md border border-dashed p-2.5 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Project Management:</span> Create a project for any organization department and assign its responsible Manager and Lead.
              </div>
            )}
            <form onSubmit={submit} className="grid gap-4 md:grid-cols-3">
              <Field label="Project code" htmlFor="code">
                <Input id="code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </Field>
              <Field label="Project name" htmlFor="name">
                <Input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Client" htmlFor="clientName">
                <Input id="clientName" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
              </Field>
              <Field label="Work type" htmlFor="proj-worktype">
                <Select value={form.workType} onValueChange={(v) => setForm({ ...form, workType: v })}>
                  <SelectTrigger id="proj-worktype"><SelectValue placeholder="Select work type" /></SelectTrigger>
                  <SelectContent>
                    {WORK_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{WORK_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>              <div className="md:col-span-3">
                <Field label="Description" htmlFor="description">
                  <Textarea id="description" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </Field>
              </div>
              <Field label="Start date" htmlFor="startDate">
                <Input id="startDate" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </Field>
              <Field label="End date" htmlFor="endDate">
                <Input id="endDate" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </Field>
              <Field label="Department" htmlFor="proj-dept">
                <Select value={form.departmentId} onValueChange={(v) => setForm({ ...form, departmentId: v })}>
                  <SelectTrigger id="proj-dept"><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {reference.departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Project manager" htmlFor="proj-mgr">
                <Select value={form.projectManagerId} onValueChange={(v) => setForm({ ...form, projectManagerId: v })}>
                  <SelectTrigger id="proj-mgr"><SelectValue placeholder="Select manager" /></SelectTrigger>
                  <SelectContent>
                    {reference.people.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Project lead" htmlFor="proj-lead">
                <Select value={form.projectLeadId} onValueChange={(v) => setForm({ ...form, projectLeadId: v })}>
                  <SelectTrigger id="proj-lead"><SelectValue placeholder="Select a lead" /></SelectTrigger>
                  <SelectContent>
                    {reference.people.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Work mode" htmlFor="proj-workmode">
                <Select value={form.workMode} onValueChange={(v) => setForm({ ...form, workMode: v })}>
                  <SelectTrigger id="proj-workmode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROJECT_WORK_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Shift" htmlFor="shift">
                <Select value={form.shift} onValueChange={(v) => setForm({ ...form, shift: v })}>
                  <SelectTrigger id="shift"><SelectValue placeholder="Select shift" /></SelectTrigger>
                  <SelectContent>
                    {PROJECT_SHIFTS.map((sh) => (
                      <SelectItem key={sh.value} value={sh.value}>{sh.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Task unit" htmlFor="taskUnit">
                <Select value={form.taskUnit} onValueChange={(v) => setForm({ ...form, taskUnit: v })}>
                  <SelectTrigger id="taskUnit"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_UNIT_OPTIONS.map((u) => (
                      <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {projectUsesProductionTargets(form.workType) ? (
                <>
              <Field label="Hourly task target" htmlFor="hourlyTaskTarget">
                <Input id="hourlyTaskTarget" type="number" step="0.01" value={form.hourlyTaskTarget} onChange={(e) => setForm({ ...form, hourlyTaskTarget: e.target.value })} />
              </Field>
              <Field label="Daily task target" htmlFor="dailyTaskTarget">
                <Input id="dailyTaskTarget" type="number" step="0.01" value={form.dailyTaskTarget} onChange={(e) => setForm({ ...form, dailyTaskTarget: e.target.value })} />
              </Field>
              <Field label="Quality target %" htmlFor="qualityTargetPct">
                <Input id="qualityTargetPct" type="number" step="0.01" value={form.qualityTargetPct} onChange={(e) => setForm({ ...form, qualityTargetPct: e.target.value })} />
              </Field>
              <Field label="Max rejection rate %" htmlFor="maxRejectionRatePct">
                <Input id="maxRejectionRatePct" type="number" step="0.01" value={form.maxRejectionRatePct} onChange={(e) => setForm({ ...form, maxRejectionRatePct: e.target.value })} />
              </Field>
                </>
              ) : form.workType ? (
                <p className="md:col-span-3 rounded-md border border-dashed p-2.5 text-xs text-muted-foreground">
                  Hourly, daily, quality and rejection targets apply only to Annotation projects. This project is used for management and assignment.
                </p>
              ) : null}
              <Field label="Required headcount" htmlFor="requiredHeadcount">
                <Input id="requiredHeadcount" type="number" value={form.requiredHeadcount} onChange={(e) => setForm({ ...form, requiredHeadcount: e.target.value })} />
              </Field>
              <div className="md:col-span-3">
                <Button type="submit" disabled={busy}>Create project</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {/* Search & Status Filter */}
      {projects.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Project status filter">
            {(["all", "active", "on_hold", "draft", "completed", "archived"] as const).map((st) => (
              <Button
                key={st}
                type="button"
                size="sm"
                aria-pressed={statusFilter === st}
                variant={statusFilter === st ? "default" : "outline"}
                onClick={() => setStatusFilter(st)}
                className="capitalize"
              >
                {st === "all" ? `All (${projects.length})` : st.replace("_", " ")}
              </Button>
            ))}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="Search projects"
              placeholder="Search project, code, client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <FolderKanban className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {canManage ? "No projects yet. Create the first one." : "You are not on any project yet."}
            </p>
          </CardContent>
        </Card>
      ) : filteredProjects.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <FolderKanban className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No projects match your filter</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
              }}
            >
              Reset filters
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredProjects.map((project) => {
            const req = Math.max(project.required_headcount ?? 0, 1);
            const capacityPct = Math.min(100, Math.round((project.allocated_count / req) * 100));
            return (
              <Link
                key={project.id}
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="h-full transition-colors hover:border-primary/40">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">{project.name}</CardTitle>
                        <CardDescription className="truncate">
                          {project.code}
                          {project.client_name ? ` · ${project.client_name}` : ""}
                        </CardDescription>
                      </div>
                      <Badge variant={projectStatusVariant(project.status)} className="shrink-0 capitalize">
                        {project.status.replace("_", " ")}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span>Staffed</span>
                        <span className="font-medium text-foreground tabular-nums">
                          {project.allocated_count}/{project.required_headcount}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${capacityPct}%` }}
                        />
                      </div>
                    </div>
                    {project.daily_task_target ? (
                      <p className="text-xs">
                        Daily target{" "}
                        <span className="font-medium text-foreground tabular-nums">
                          {project.daily_task_target} {project.task_unit}
                        </span>
                      </p>
                    ) : null}
                    {project.pending_ack_count > 0 ? (
                      <p className="text-xs font-medium text-warning">
                        {project.pending_ack_count} awaiting acknowledgment
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
