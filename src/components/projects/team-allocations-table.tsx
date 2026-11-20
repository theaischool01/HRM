import { useState, useMemo } from "react";
import {
  Search,
  Download,
  Filter,
  Users,
  CheckCircle2,
  Clock,
  Layers,
  Sparkles,
  Pencil,
  UserMinus,
  Briefcase,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { endAllocation, updateAllocation } from "@/lib/allocations.functions";
import { WORK_TYPE_LABELS, type WorkType } from "@/lib/work-type";

export type ProjectAllocationItem = {
  id: string;
  user_id: string;
  reporting_lead_id: string | null;
  role_in_project: string | null;
  start_date: string | null;
  end_date: string | null;
  hours_per_day: number | null;
  allocation_pct: number | null;
  daily_task_target: number | null;
  quality_target_pct: number | null;
  max_rejection_rate_pct: number | null;
  status: string;
  acknowledged_at: string | null;
  acknowledgment_note: string | null;
  created_at: string;
  person: {
    id: string;
    full_name: string;
    work_email: string;
    designation: string | null;
    employee_code?: string | null;
    department_name?: string | null;
    work_type?: string | null;
    category?: string | null;
  } | null;
  reportingLead: {
    id: string;
    full_name: string;
    work_email?: string;
    designation?: string | null;
  } | null;
};

interface TeamAllocationsTableProps {
  projectId: string;
  projectName: string;
  projectDepartmentId?: string | null;
  projectDepartmentName?: string | null;
  projectWorkType?: string | null;
  allocations: ProjectAllocationItem[];
  availableLeads: Array<{ id: string; fullName: string; designation: string | null }>;
  canManage: boolean;
  onRefresh: () => Promise<void>;
}

export function TeamAllocationsTable({
  projectId,
  projectName,
  projectDepartmentId,
  projectDepartmentName,
  projectWorkType,
  allocations,
  availableLeads,
  canManage,
  onRefresh,
}: TeamAllocationsTableProps) {
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [workTypeFilter, setWorkTypeFilter] = useState<string>("all");
  const [ackFilter, setAckFilter] = useState<string>("all");

  const [endTarget, setEndTarget] = useState<{ id: string; personName: string } | null>(null);
  const [editItem, setEditItem] = useState<ProjectAllocationItem | null>(null);
  const [editForm, setEditForm] = useState<{
    roleInProject: string;
    reportingLeadId: string;
    allocationPct: number;
    hoursPerDay: number;
    startDate: string;
    endDate: string;
    dailyTaskTarget: string;
    qualityTargetPct: string;
    maxRejectionRatePct: string;
  }>({
    roleInProject: "",
    reportingLeadId: "",
    allocationPct: 100,
    hoursPerDay: 8,
    startDate: "",
    endDate: "",
    dailyTaskTarget: "",
    qualityTargetPct: "",
    maxRejectionRatePct: "",
  });
  const [busy, setBusy] = useState(false);

  // Departments list for filtering
  const departments = useMemo(() => {
    const set = new Set<string>();
    allocations.forEach((a) => {
      if (a.person?.department_name) set.add(a.person.department_name);
    });
    return Array.from(set).sort();
  }, [allocations]);

  // Filtered allocations
  const filtered = useMemo(() => {
    return allocations.filter((a) => {
      const q = search.trim().toLowerCase();
      if (q) {
        const name = (a.person?.full_name ?? "").toLowerCase();
        const code = (a.person?.employee_code ?? "").toLowerCase();
        const email = (a.person?.work_email ?? "").toLowerCase();
        const role = (a.role_in_project ?? "").toLowerCase();
        const lead = (a.reportingLead?.full_name ?? "").toLowerCase();
        if (!name.includes(q) && !code.includes(q) && !email.includes(q) && !role.includes(q) && !lead.includes(q)) {
          return false;
        }
      }
      if (deptFilter !== "all" && a.person?.department_name !== deptFilter) {
        return false;
      }
      if (workTypeFilter !== "all" && a.person?.work_type !== workTypeFilter) {
        return false;
      }
      if (ackFilter === "acknowledged" && (!a.acknowledged_at || a.status === "ended")) {
        return false;
      }
      if (ackFilter === "pending" && (a.acknowledged_at || a.status === "ended")) {
        return false;
      }
      if (ackFilter === "ended" && a.status !== "ended") {
        return false;
      }
      return true;
    });
  }, [allocations, search, deptFilter, workTypeFilter, ackFilter]);

  // KPIs
  const stats = useMemo(() => {
    const activeAllocs = allocations.filter((a) => a.status !== "ended");
    const totalCount = activeAllocs.length;
    const crossDeptCount = activeAllocs.filter((a) => {
      if (!projectDepartmentName || !a.person?.department_name) return false;
      return a.person.department_name.toLowerCase() !== projectDepartmentName.toLowerCase();
    }).length;
    const totalHours = activeAllocs.reduce((s, a) => s + (Number(a.hours_per_day) || 8), 0);
    const totalFTE = (totalHours / 8).toFixed(1);
    const ackCount = activeAllocs.filter((a) => a.acknowledged_at).length;
    const ackPct = totalCount > 0 ? Math.round((ackCount / totalCount) * 100) : 0;

    return { totalCount, crossDeptCount, totalFTE, ackPct };
  }, [allocations, projectDepartmentName]);

  const handleOpenEdit = (item: ProjectAllocationItem) => {
    setEditItem(item);
    setEditForm({
      roleInProject: item.role_in_project ?? "",
      reportingLeadId: item.reporting_lead_id ?? "",
      allocationPct: Number(item.allocation_pct) || 100,
      hoursPerDay: Number(item.hours_per_day) || 8,
      startDate: item.start_date ?? "",
      endDate: item.end_date ?? "",
      dailyTaskTarget: item.daily_task_target != null ? String(item.daily_task_target) : "",
      qualityTargetPct: item.quality_target_pct != null ? String(item.quality_target_pct) : "",
      maxRejectionRatePct: item.max_rejection_rate_pct != null ? String(item.max_rejection_rate_pct) : "",
    });
  };

  const handleSaveEdit = async () => {
    if (!editItem) return;
    setBusy(true);
    try {
      await updateAllocation({
        data: {
          id: editItem.id,
          roleInProject: editForm.roleInProject.trim() || null,
          reportingLeadId: editForm.reportingLeadId || null,
          allocationPct: editForm.allocationPct,
          hoursPerDay: editForm.hoursPerDay,
          startDate: editForm.startDate || null,
          endDate: editForm.endDate || null,
          dailyTaskTarget: editForm.dailyTaskTarget ? Number(editForm.dailyTaskTarget) : null,
          qualityTargetPct: editForm.qualityTargetPct ? Number(editForm.qualityTargetPct) : null,
          maxRejectionRatePct: editForm.maxRejectionRatePct ? Number(editForm.maxRejectionRatePct) : null,
          overAllocationOverride: true,
        },
      });
      toast.success("Allocation updated successfully.");
      setEditItem(null);
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update allocation.");
    } finally {
      setBusy(false);
    }
  };

  const handleEndAllocation = async () => {
    if (!endTarget) return;
    setBusy(true);
    try {
      await endAllocation({ data: { id: endTarget.id } });
      toast.success(`Ended allocation for ${endTarget.personName}.`);
      setEndTarget(null);
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to end allocation.");
    } finally {
      setBusy(false);
    }
  };

  const handleExport = () => {
    try {
      const exportRows = filtered.map((a) => ({
        "Employee Name": a.person?.full_name ?? "Unknown",
        "Employee ID": a.person?.employee_code ?? "—",
        "Work Email": a.person?.work_email ?? "—",
        "Home Department": a.person?.department_name ?? "Unassigned",
        "Work Type": a.person?.work_type ? WORK_TYPE_LABELS[a.person.work_type as WorkType] ?? a.person.work_type : "Unclassified",
        "Project Role": a.role_in_project ?? "General Member",
        "Project Reporting Lead": a.reportingLead?.full_name ?? "—",
        "Allocation %": a.allocation_pct ?? 100,
        "Hours / Day": a.hours_per_day ?? 8,
        "Daily Target": a.daily_task_target ?? "—",
        "Start Date": a.start_date ?? "—",
        "End Date": a.end_date ?? "—",
        "Status": a.status === "ended" ? "Ended" : a.acknowledged_at ? "Acknowledged" : "Pending Acknowledgment",
        "Acknowledged At": a.acknowledged_at ? new Date(a.acknowledged_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—",
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportRows);
      XLSX.utils.book_append_sheet(wb, ws, "Team Allocations");
      const filename = `${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-team-allocations.xlsx`;
      XLSX.writeFile(wb, filename);
      toast.success(`Exported ${exportRows.length} team allocations.`);
    } catch {
      toast.error("Failed to generate export file.");
    }
  };

  const isAnnotationEditing = editItem?.person?.work_type === "annotation" && projectWorkType === "annotation";

  return (
    <div className="space-y-4">
      {/* KPI Overview */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-border/80">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Team Size</p>
                <p className="font-display text-xl font-bold">{stats.totalCount}</p>
              </div>
              <Users className="size-5 text-primary/70" />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Active team members</p>
          </CardContent>
        </Card>

        <Card className="border-border/80">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Cross-Dept Members</p>
                <p className="font-display text-xl font-bold text-primary">{stats.crossDeptCount}</p>
              </div>
              <Layers className="size-5 text-primary/70" />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">From outside {projectDepartmentName || "home dept"}</p>
          </CardContent>
        </Card>

        <Card className="border-border/80">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Staffing Capacity</p>
                <p className="font-display text-xl font-bold">{stats.totalFTE} <span className="text-xs font-normal text-muted-foreground">FTE</span></p>
              </div>
              <Briefcase className="size-5 text-primary/70" />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Total dedicated hours / 8</p>
          </CardContent>
        </Card>

        <Card className="border-border/80">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Acknowledgment</p>
                <p className="font-display text-xl font-bold">{stats.ackPct}%</p>
              </div>
              <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Confirmed assignments</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Table Card */}
      <Card className="border-border/80">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Team Allocations</CardTitle>
              <CardDescription>
                Cross-department members allocated to this project. Acknowledged per person with an IST timestamp.
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={handleExport} className="shrink-0 gap-1.5 self-start sm:self-auto">
              <Download className="size-3.5" />
              Export
            </Button>
          </div>

          {/* Filters Bar */}
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 md:grid-cols-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Search name, TAS ID, role, lead..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>

            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={workTypeFilter} onValueChange={setWorkTypeFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All Work Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Work Types</SelectItem>
                <SelectItem value="annotation">Annotation</SelectItem>
                <SelectItem value="engineering">Engineering</SelectItem>
                <SelectItem value="operations">Operations</SelectItem>
                <SelectItem value="hr">Human Resources</SelectItem>
                <SelectItem value="training">Training</SelectItem>
                <SelectItem value="other">Other / General</SelectItem>
              </SelectContent>
            </Select>

            <Select value={ackFilter} onValueChange={setAckFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                <SelectItem value="pending">Pending Acknowledgment</SelectItem>
                <SelectItem value="ended">Ended</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="px-0">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {allocations.length === 0
                ? "Nobody is allocated to this project yet. Use 'Add One Person' or 'Bulk Allocate' above."
                : "No allocations matched the selected search and filter criteria."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/60 hover:bg-transparent">
                    <TableHead className="w-[200px]">Employee</TableHead>
                    <TableHead className="w-[100px]">TAS ID</TableHead>
                    <TableHead>Home Dept</TableHead>
                    <TableHead>Work Type</TableHead>
                    <TableHead>Project Role</TableHead>
                    <TableHead>Project Lead</TableHead>
                    <TableHead className="text-right">Alloc %</TableHead>
                    <TableHead className="text-right">Hrs / Day</TableHead>
                    <TableHead>Acknowledgment</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a) => {
                    const isCrossDept =
                      projectDepartmentName &&
                      a.person?.department_name &&
                      a.person.department_name.toLowerCase() !== projectDepartmentName.toLowerCase();

                    return (
                      <TableRow key={a.id} className="hover:bg-muted/40">
                        <TableCell>
                          <div className="font-medium text-foreground">
                            {a.person?.full_name ?? "Unknown"}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {a.person?.work_email || a.person?.designation || "—"}
                          </div>
                        </TableCell>

                        <TableCell>
                          <span className="font-mono text-xs font-semibold text-primary">
                            {a.person?.employee_code || "—"}
                          </span>
                        </TableCell>

                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[11px] font-normal">
                              {a.person?.department_name || "Unassigned"}
                            </Badge>
                            {isCrossDept ? (
                              <span
                                title="Cross-department member"
                                className="inline-flex size-1.5 rounded-full bg-primary"
                              />
                            ) : null}
                          </div>
                        </TableCell>

                        <TableCell>
                          <Badge variant="neutral" className="text-[11px] font-normal capitalize">
                            {a.person?.work_type || "Unclassified"}
                          </Badge>
                        </TableCell>

                        <TableCell className="text-xs font-medium text-foreground">
                          {a.role_in_project || "General Member"}
                        </TableCell>

                        <TableCell className="text-xs text-muted-foreground">
                          {a.reportingLead?.full_name || "—"}
                        </TableCell>

                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {a.allocation_pct}%
                        </TableCell>

                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {a.hours_per_day ?? 8}h
                        </TableCell>

                        <TableCell>
                          {a.status === "ended" ? (
                            <Badge variant="neutral" className="text-[11px]">Ended</Badge>
                          ) : a.acknowledged_at ? (
                            <Badge variant="success" className="gap-1 text-[11px]">
                              <CheckCircle2 className="size-3" />
                              {new Date(a.acknowledged_at).toLocaleDateString("en-IN", {
                                timeZone: "Asia/Kolkata",
                                month: "short",
                                day: "numeric",
                              })}
                            </Badge>
                          ) : (
                            <Badge variant="warning" className="gap-1 text-[11px]">
                              <Clock className="size-3" />
                              Pending
                            </Badge>
                          )}
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canManage && a.status !== "ended" ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="size-7 p-0 text-muted-foreground hover:text-foreground"
                                  onClick={() => handleOpenEdit(a)}
                                  title="Edit allocation"
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="size-7 p-0 text-muted-foreground hover:text-destructive"
                                  onClick={() =>
                                    setEndTarget({
                                      id: a.id,
                                      personName: a.person?.full_name ?? "this team member",
                                    })
                                  }
                                  title="End allocation"
                                >
                                  <UserMinus className="size-3.5" />
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Allocation Dialog */}
      <Dialog open={Boolean(editItem)} onOpenChange={(open) => !open && setEditItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Team Allocation</DialogTitle>
            <DialogDescription>
              Update project role, reporting lead, capacity and dates for{" "}
              <span className="font-semibold text-foreground">{editItem?.person?.full_name}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3.5 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Employee ID</Label>
                <div className="font-mono text-xs font-semibold">{editItem?.person?.employee_code || "—"}</div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Home Department</Label>
                <div className="text-xs font-medium">{editItem?.person?.department_name || "Unassigned"}</div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Project Role</Label>
              <Input
                value={editForm.roleInProject}
                onChange={(e) => setEditForm({ ...editForm, roleInProject: e.target.value })}
                placeholder="e.g. Engineering Contributor, QA Reviewer"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Project Reporting Lead</Label>
              <Select
                value={editForm.reportingLeadId}
                onValueChange={(val) => setEditForm({ ...editForm, reportingLeadId: val })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select a project lead" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No dedicated lead (Default)</SelectItem>
                  {availableLeads.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.fullName} {l.designation ? `(${l.designation})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Allocation %</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={editForm.allocationPct}
                  onChange={(e) => setEditForm({ ...editForm, allocationPct: Number(e.target.value) || 100 })}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Hours / Day</Label>
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={editForm.hoursPerDay}
                  onChange={(e) => setEditForm({ ...editForm, hoursPerDay: Number(e.target.value) || 8 })}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Start Date</Label>
                <Input
                  type="date"
                  value={editForm.startDate}
                  onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">End Date (optional)</Label>
                <Input
                  type="date"
                  value={editForm.endDate}
                  onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {/* Conditional Annotation Targets */}
            {isAnnotationEditing ? (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2">
                <p className="text-xs font-semibold text-primary">Annotation Production Targets</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Daily Units</Label>
                    <Input
                      type="number"
                      placeholder="e.g. 50"
                      value={editForm.dailyTaskTarget}
                      onChange={(e) => setEditForm({ ...editForm, dailyTaskTarget: e.target.value })}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Quality %</Label>
                    <Input
                      type="number"
                      placeholder="95"
                      value={editForm.qualityTargetPct}
                      onChange={(e) => setEditForm({ ...editForm, qualityTargetPct: e.target.value })}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Max Reject %</Label>
                    <Input
                      type="number"
                      placeholder="5"
                      value={editForm.maxRejectionRatePct}
                      onChange={(e) => setEditForm({ ...editForm, maxRejectionRatePct: e.target.value })}
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setEditItem(null)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveEdit} disabled={busy}>
              {busy ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* End Allocation Confirmation Dialog */}
      <AlertDialog open={Boolean(endTarget)} onOpenChange={(o) => !o && setEndTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End project allocation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will end{" "}
              <span className="font-medium text-foreground">{endTarget?.personName}</span>&apos;s
              active allocation on <span className="font-medium text-foreground">{projectName}</span>.
              Historical task entries and records remain preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void handleEndAllocation();
              }}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {busy ? "Ending…" : "End Allocation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
