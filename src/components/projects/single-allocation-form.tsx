import { useState, useMemo } from "react";
import {
  Search,
  AlertTriangle,
  UserCheck,
  Building,
  Briefcase,
  Layers,
  Sparkles,
  Info,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createAllocation, type AllocatableEmployee } from "@/lib/allocations.functions";
import { todayIso } from "@/lib/timezone";
import { WORK_TYPE_LABELS, type WorkType } from "@/lib/work-type";

interface SingleAllocationFormProps {
  projectId: string;
  projectName: string;
  projectWorkType?: string | null;
  employees: AllocatableEmployee[];
  availableLeads: Array<{ id: string; fullName: string; designation: string | null }>;
  departments?: Array<{ id: string; name: string }>;
  onSuccess: () => Promise<void>;
}

export function SingleAllocationForm({
  projectId,
  projectName,
  projectWorkType,
  employees,
  availableLeads,
  departments: passedDepartments,
  onSuccess,
}: SingleAllocationFormProps) {
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [workTypeFilter, setWorkTypeFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [capacityFilter, setCapacityFilter] = useState("all");
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const [roleInProject, setRoleInProject] = useState("General Project Member");
  const [reportingLeadId, setReportingLeadId] = useState("");
  const [allocationPct, setAllocationPct] = useState(100);
  const [hoursPerDay, setHoursPerDay] = useState(8);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState("");
  const [dailyTaskTarget, setDailyTaskTarget] = useState("");
  const [qualityTargetPct, setQualityTargetPct] = useState("95");
  const [maxRejectionRatePct, setMaxRejectionRatePct] = useState("5");

  const [warning, setWarning] = useState<{
    usedPct: number;
    newPct: number;
    total: number;
    conflicts: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Departments list for filter
  const departments = useMemo(() => {
    if (passedDepartments && passedDepartments.length > 0) {
      return passedDepartments.map((d) => d.name).sort();
    }
    const set = new Set<string>();
    employees.forEach((e) => {
      if (e.departmentName) set.add(e.departmentName);
    });
    return Array.from(set).sort();
  }, [passedDepartments, employees]);

  // Filtered employees pool
  const filteredEmployees = useMemo(() => {
    return employees.filter((e) => {
      const q = search.trim().toLowerCase();
      if (q) {
        const name = e.fullName.toLowerCase();
        const code = (e.employeeCode ?? "").toLowerCase();
        const email = e.workEmail.toLowerCase();
        if (!name.includes(q) && !code.includes(q) && !email.includes(q)) return false;
      }
      if (deptFilter !== "all" && e.departmentName !== deptFilter) return false;
      if (workTypeFilter !== "all" && e.workType !== workTypeFilter) return false;
      if (roleFilter !== "all" && !e.roles.includes(roleFilter)) return false;
      if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
      if (capacityFilter === "available" && e.usedPct >= 100) return false;
      if (capacityFilter === "unallocated" && e.usedPct > 0) return false;
      if (capacityFilter === "full" && e.usedPct < 100) return false;
      if (assignmentFilter === "unallocated" && e.isAllocatedToProject) return false;
      if (assignmentFilter === "allocated" && !e.isAllocatedToProject) return false;
      return true;
    });
  }, [employees, search, deptFilter, workTypeFilter, roleFilter, categoryFilter, capacityFilter, assignmentFilter]);

  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedEmployees = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredEmployees.slice(start, start + pageSize);
  }, [filteredEmployees, currentPage, pageSize]);

  const selectedEmployee = useMemo(() => {
    return employees.find((e) => e.id === selectedUserId) ?? null;
  }, [employees, selectedUserId]);

  const isSelectedAnnotationEligible =
    selectedEmployee?.workType === "annotation" && projectWorkType === "annotation";

  const handleSelectPerson = (userId: string) => {
    const emp = employees.find((e) => e.id === userId);
    if (!emp) return;

    if (emp.employmentStatus !== "active") {
      toast.error(`Cannot allocate: employee is currently ${emp.employmentStatus}.`);
      return;
    }
    if (emp.accountStatus === "profile_pending") {
      toast.error("Cannot allocate: employee profile onboarding is still pending.");
      return;
    }

    setSelectedUserId(userId);
    setWarning(null);

    // Suggest appropriate default role based on work type
    if (emp.workType === "annotation" && projectWorkType === "annotation") {
      setRoleInProject("Annotation Contributor");
    } else if (emp.workType === "engineering") {
      setRoleInProject("Engineering Contributor");
    } else if (emp.workType === "operations") {
      setRoleInProject("Operations Support");
    } else {
      setRoleInProject("General Project Member");
    }
    setHoursPerDay(emp.availableHoursPerDay || 8);
  };

  const handleSubmit = async (override = false) => {
    if (!selectedUserId) {
      toast.error("Please choose an employee to allocate.");
      return;
    }
    setBusy(true);
    try {
      const res = await createAllocation({
        data: {
          projectId,
          userId: selectedUserId,
          reportingLeadId: reportingLeadId || null,
          roleInProject: roleInProject.trim() || null,
          startDate: startDate || todayIso(),
          endDate: endDate || null,
          hoursPerDay,
          allocationPct,
          dailyTaskTarget: isSelectedAnnotationEligible && dailyTaskTarget ? Number(dailyTaskTarget) : null,
          qualityTargetPct: isSelectedAnnotationEligible && qualityTargetPct ? Number(qualityTargetPct) : null,
          maxRejectionRatePct: isSelectedAnnotationEligible && maxRejectionRatePct ? Number(maxRejectionRatePct) : null,
          overAllocationOverride: override,
        },
      });

      toast.success(
        res.overAllocated
          ? `Allocated at ${res.totalPct}% total capacity (over-allocated). Waiting for acknowledgment.`
          : "Employee successfully allocated! Waiting for their acknowledgment.",
      );

      setSelectedUserId("");
      setWarning(null);
      await onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create allocation.";
      if (msg.includes("OVER_ALLOCATION::")) {
        try {
          const parsed = JSON.parse(msg.slice(msg.indexOf("OVER_ALLOCATION::") + "OVER_ALLOCATION::".length));
          setWarning(parsed);
          return;
        } catch {
          // fallback
        }
      }
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const getEligibilityBadge = (emp: AllocatableEmployee) => {
    if (emp.isAllocatedToProject) {
      return (
        <Badge variant="neutral" className="text-[10px] py-0 h-4">
          Already on project
        </Badge>
      );
    }
    if (emp.employmentStatus !== "active") {
      return (
        <Badge variant="destructive" className="text-[10px] py-0 h-4">
          Inactive ({emp.employmentStatus})
        </Badge>
      );
    }
    if (emp.accountStatus === "profile_pending") {
      return (
        <Badge variant="warning" className="text-[10px] py-0 h-4">
          Profile Pending
        </Badge>
      );
    }
    if (emp.usedPct >= 100) {
      return (
        <Badge variant="warning" className="text-[10px] py-0 h-4 bg-amber-500/20 text-amber-800 dark:text-amber-200">
          Capacity Full ({emp.usedPct}%)
        </Badge>
      );
    }
    return (
      <Badge variant="success" className="text-[10px] py-0 h-4">
        Available ({100 - emp.usedPct}% free)
      </Badge>
    );
  };

  return (
    <div className="space-y-5">
      {/* Search & Filter Bar */}
      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <div className="relative lg:col-span-2">
          <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Search name, TAS ID, email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="h-8 pl-8 text-xs"
          />
        </div>

        <Select
          value={deptFilter}
          onValueChange={(v) => {
            setDeptFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Department" />
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

        <Select
          value={workTypeFilter}
          onValueChange={(v) => {
            setWorkTypeFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Work Type" />
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

        <Select
          value={capacityFilter}
          onValueChange={(v) => {
            setCapacityFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Capacity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Capacities</SelectItem>
            <SelectItem value="available">Has Free Capacity (&lt;100%)</SelectItem>
            <SelectItem value="unallocated">Unallocated (0%)</SelectItem>
            <SelectItem value="full">Capacity Full (100%+)</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={assignmentFilter}
          onValueChange={(v) => {
            setAssignmentFilter(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Project Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="unallocated">Not on this project</SelectItem>
            <SelectItem value="allocated">Already on this project</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Employee Selection List */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold text-foreground">
            Select Employee to Allocate{" "}
            <span className="text-[11px] font-normal text-muted-foreground">
              ({filteredEmployees.length} candidates found organization-wide)
            </span>
          </Label>
          {totalPages > 1 ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="size-6 p-0"
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="size-6 p-0"
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          ) : null}
        </div>

        <div className="max-h-60 overflow-y-auto rounded-md border border-border/80 bg-background divide-y divide-border/40">
          {filteredEmployees.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              No employees match your search or filters across the organization.
            </div>
          ) : (
            pagedEmployees.map((emp) => {
              const isSelected = selectedUserId === emp.id;
              const alreadyOnProject = emp.isAllocatedToProject;
              const isInactive = emp.employmentStatus !== "active" || emp.accountStatus === "profile_pending";

              return (
                <div
                  key={emp.id}
                  onClick={() => !alreadyOnProject && !isInactive && handleSelectPerson(emp.id)}
                  className={`flex items-center justify-between p-2.5 transition-colors ${
                    alreadyOnProject || isInactive
                      ? "opacity-60 bg-muted/20 cursor-not-allowed"
                      : isSelected
                      ? "bg-primary/10 border-l-2 border-primary cursor-pointer"
                      : "hover:bg-muted/40 cursor-pointer"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="size-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">
                      {emp.fullName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-foreground">{emp.fullName}</span>
                        {emp.employeeCode ? (
                          <span className="font-mono text-[11px] font-semibold text-primary">
                            {emp.employeeCode}
                          </span>
                        ) : null}
                        {getEligibilityBadge(emp)}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{emp.departmentName}</span>
                        <span>•</span>
                        <span className="capitalize">{emp.workType || "Unclassified"}</span>
                        <span>•</span>
                        <span>{emp.designation || "Team Member"}</span>
                        <span>•</span>
                        <span className="font-mono">{emp.workEmail}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-right">
                    <div className="text-[11px]">
                      <span className="text-muted-foreground">Load: </span>
                      <span className={`font-semibold ${emp.usedPct >= 100 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
                        {emp.usedPct}%
                      </span>
                    </div>
                    {isSelected ? (
                      <div className="size-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                        <Check className="size-3" />
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Selected Employee Preview & Allocation Inputs */}
      {selectedEmployee ? (
        <div className="rounded-lg border border-border/80 bg-muted/20 p-4 space-y-4 animate-in fade-in-50 duration-150">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-border/60 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{selectedEmployee.fullName}</span>
                {selectedEmployee.employeeCode ? (
                  <Badge variant="outline" className="font-mono text-xs">
                    {selectedEmployee.employeeCode}
                  </Badge>
                ) : null}
                <Badge variant="neutral" className="text-xs capitalize">
                  {selectedEmployee.workType || "General"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Home Dept: <strong>{selectedEmployee.departmentName}</strong> · Current Capacity:{" "}
                <strong>{selectedEmployee.usedPct}%</strong>
              </p>
            </div>

            {/* Cross-Department Notice */}
            {selectedEmployee.departmentName && selectedEmployee.departmentName !== projectName ? (
              <div className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                <Building className="size-3.5" />
                Cross-Department Assignment
              </div>
            ) : null}
          </div>

          {/* Allocation Config Grid */}
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Project Role</Label>
              <Input
                value={roleInProject}
                onChange={(e) => setRoleInProject(e.target.value)}
                placeholder="e.g. Annotation Contributor"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Project Reporting Lead</Label>
              <Select value={reportingLeadId} onValueChange={setReportingLeadId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Default Lead" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Default Lead</SelectItem>
                  {availableLeads.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.fullName} {l.designation ? `(${l.designation})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Allocation Percentage</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={allocationPct}
                onChange={(e) => setAllocationPct(Number(e.target.value) || 100)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Hours / Day</Label>
              <Input
                type="number"
                min={1}
                max={24}
                value={hoursPerDay}
                onChange={(e) => setHoursPerDay(Number(e.target.value) || 8)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">End Date (optional)</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            {/* Annotation Targets (Only shown if member & project are both annotation) */}
            {isSelectedAnnotationEligible ? (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Daily Unit Target</Label>
                  <Input
                    type="number"
                    value={dailyTaskTarget}
                    onChange={(e) => setDailyTaskTarget(e.target.value)}
                    placeholder="e.g. 100"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Quality Target %</Label>
                  <Input
                    type="number"
                    value={qualityTargetPct}
                    onChange={(e) => setQualityTargetPct(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </>
            ) : null}
          </div>

          {/* Specialized Work-Type Explanatory Badge */}
          {!isSelectedAnnotationEligible && projectWorkType === "annotation" ? (
            <div className="flex items-center gap-2 rounded-md bg-muted/60 p-2 text-xs text-muted-foreground border border-border/40">
              <Info className="size-4 shrink-0 text-primary" />
              <span>
                <strong>{selectedEmployee.fullName}</strong> is an {selectedEmployee.workType || "unclassified"} team member.
                They will contribute in their specialized project capacity without Annotation hourly production logging requirements.
              </span>
            </div>
          ) : null}

          {/* Over-allocation warning box */}
          {warning ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
                <AlertTriangle className="size-4" />
                Over-Allocation Warning
              </div>
              <p className="text-amber-800 dark:text-amber-300">
                This employee is currently at <strong>{warning.usedPct}%</strong> capacity across other projects.
                Adding <strong>{warning.newPct}%</strong> brings total utilization to <strong>{warning.total}%</strong>.
              </p>
              {warning.conflicts.length > 0 ? (
                <p className="text-muted-foreground">Current allocations: {warning.conflicts.join(", ")}</p>
              ) : null}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleSubmit(true)}
                  disabled={busy}
                  className="h-7 text-xs"
                >
                  Confirm &amp; Override Over-Allocation
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setWarning(null)}
                  className="h-7 text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedUserId("")}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => handleSubmit(false)}
                disabled={busy}
                className="gap-1.5"
              >
                <UserCheck className="size-3.5" />
                {busy ? "Allocating..." : "Allocate Person"}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
