import { useState, useMemo } from "react";
import {
  Upload,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Search,
  Sparkles,
  Users,
  FileSpreadsheet,
  Trash2,
  ArrowRight,
  UserCheck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import * as XLSX from "xlsx";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { bulkCreateAllocations, type AllocatableEmployee } from "@/lib/allocations.functions";
import { todayIso } from "@/lib/timezone";

export type BulkValidationStatus =
  | "ready"
  | "needs_review"
  | "duplicate"
  | "invalid"
  | "already_allocated"
  | "capacity_conflict";

export type AllocationRowDraft = {
  id: string; // temporary row key
  userId: string;
  employeeCode: string;
  fullName: string;
  workEmail: string;
  departmentName: string;
  workType: string | null;
  roleInProject: string;
  reportingLeadId: string;
  reportingLeadName?: string | undefined;
  allocationPct: number;
  hoursPerDay: number;
  startDate: string;
  endDate: string;
  dailyTaskTarget: string;
  usedPct: number;
  status: BulkValidationStatus;
  statusMessage?: string | undefined;
};

interface BulkAllocationPanelProps {
  projectId: string;
  projectName: string;
  projectWorkType?: string | null;
  employees: AllocatableEmployee[];
  availableLeads: Array<{ id: string; fullName: string; designation: string | null }>;
  departments?: Array<{ id: string; name: string }>;
  onSuccess: () => Promise<void>;
}

export function BulkAllocationPanel({
  projectId,
  projectName,
  projectWorkType,
  employees,
  availableLeads,
  departments: passedDepartments,
  onSuccess,
}: BulkAllocationPanelProps) {
  const [method, setMethod] = useState<"select" | "upload">("select");

  // Method A (Interactive selection)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchSelect, setSearchSelect] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [workTypeFilter, setWorkTypeFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [capacityFilter, setCapacityFilter] = useState("all");
  const [assignmentFilter, setAssignmentFilter] = useState<"unallocated_to_project" | "all">(
    "unallocated_to_project",
  );
  const [page, setPage] = useState(1);
  const pageSize = 15;

  // Common settings bar for selected
  const [commonRole, setCommonRole] = useState("General Project Member");
  const [commonLeadId, setCommonLeadId] = useState("");
  const [commonPct, setCommonPct] = useState(100);
  const [commonHours, setCommonHours] = useState(8);
  const [commonStartDate, setCommonStartDate] = useState(todayIso());
  const [commonEndDate, setCommonEndDate] = useState("");
  const [commonDailyTarget, setCommonDailyTarget] = useState("");

  // Method B (File upload) & Validation Preview Rows
  const [stagedRows, setStagedRows] = useState<AllocationRowDraft[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Departments for filtering
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

  // Method A filtered table
  const selectFilteredEmployees = useMemo(() => {
    return employees.filter((e) => {
      const q = searchSelect.trim().toLowerCase();
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
      if (capacityFilter === "full" && e.usedPct < 100) return false;
      if (assignmentFilter === "unallocated_to_project" && e.isAllocatedToProject) return false;
      return true;
    });
  }, [employees, searchSelect, deptFilter, workTypeFilter, roleFilter, categoryFilter, capacityFilter, assignmentFilter]);

  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(selectFilteredEmployees.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedEmployees = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return selectFilteredEmployees.slice(start, start + pageSize);
  }, [selectFilteredEmployees, currentPage, pageSize]);

  // Lead lookup helper
  const leadMap = useMemo(() => {
    return new Map(availableLeads.map((l) => [l.id, l.fullName]));
  }, [availableLeads]);

  // Validate a row draft against business rules
  const validateRow = (
    row: AllocationRowDraft,
    allRows: AllocationRowDraft[],
  ): { status: BulkValidationStatus; message: string } => {
    if (!row.userId) {
      return { status: "invalid", message: "Employee not found in organization." };
    }
    const duplicates = allRows.filter((r) => r.userId === row.userId);
    if (duplicates.length > 1) {
      return { status: "duplicate", message: "Duplicate employee row in batch." };
    }
    const emp = employees.find((e) => e.id === row.userId);
    if (!emp) {
      return { status: "invalid", message: "Employee record missing." };
    }
    if (emp.isAllocatedToProject) {
      return { status: "already_allocated", message: "Already allocated to this project." };
    }
    if (emp.employmentStatus !== "active") {
      return { status: "invalid", message: `Account is ${emp.employmentStatus}.` };
    }
    if (emp.accountStatus === "profile_pending") {
      return { status: "invalid", message: "Profile onboarding incomplete." };
    }
    if (row.allocationPct <= 0 || row.allocationPct > 100) {
      return { status: "invalid", message: "Allocation % must be between 1 and 100." };
    }
    if (row.hoursPerDay <= 0 || row.hoursPerDay > 24) {
      return { status: "invalid", message: "Hours per day must be between 1 and 24." };
    }
    if (row.startDate && row.endDate && row.endDate < row.startDate) {
      return { status: "invalid", message: "End date cannot be earlier than start date." };
    }
    if (emp.usedPct + row.allocationPct > 100) {
      return {
        status: "capacity_conflict",
        message: `Currently at ${emp.usedPct}%. Adding ${row.allocationPct}% puts them at ${emp.usedPct + row.allocationPct}%.`,
      };
    }
    if (!row.roleInProject.trim()) {
      return { status: "needs_review", message: "Project role is recommended." };
    }
    return { status: "ready", message: "Ready for allocation." };
  };

  // Convert selected employees from Method A into Staged Rows
  const handleStageSelected = () => {
    if (selectedIds.size === 0) {
      toast.error("Please select at least one employee using the checkboxes.");
      return;
    }

    const selectedEmployees = employees.filter((e) => selectedIds.has(e.id));
    const newRows: AllocationRowDraft[] = selectedEmployees.map((emp) => {
      const isAnnotationMember = emp.workType === "annotation" && projectWorkType === "annotation";
      const draft: AllocationRowDraft = {
        id: `sel-${emp.id}-${Date.now()}`,
        userId: emp.id,
        employeeCode: emp.employeeCode || "—",
        fullName: emp.fullName,
        workEmail: emp.workEmail,
        departmentName: emp.departmentName,
        workType: emp.workType,
        roleInProject:
          commonRole ||
          (isAnnotationMember
            ? "Annotation Contributor"
            : emp.workType === "engineering"
            ? "Engineering Contributor"
            : "General Project Member"),
        reportingLeadId: commonLeadId || "",
        reportingLeadName: commonLeadId ? leadMap.get(commonLeadId) : "Default",
        allocationPct: commonPct,
        hoursPerDay: commonHours,
        startDate: commonStartDate || todayIso(),
        endDate: commonEndDate || "",
        dailyTaskTarget: isAnnotationMember ? commonDailyTarget : "",
        usedPct: emp.usedPct,
        status: "ready",
      };
      return draft;
    });

    // Run validation on all new rows
    const validated = newRows.map((r) => {
      const v = validateRow(r, newRows);
      return { ...r, status: v.status, statusMessage: v.message };
    });

    setStagedRows(validated);
    toast.success(`Prepared ${validated.length} employees for preview and validation.`);
  };

  // Method B: Download Template
  const handleDownloadTemplate = (format: "csv" | "xlsx") => {
    const sampleLead = availableLeads[0]?.fullName ? "lead@theaischool.co.in" : "";
    const headers = [
      {
        employee_id: "TAS-001",
        work_email: "employee@theaischool.co.in",
        project_role: projectWorkType === "annotation" ? "Annotation Contributor" : "Engineering Contributor",
        reporting_lead_email: sampleLead,
        allocation_percentage: 100,
        hours_per_day: 8,
        start_date: todayIso(),
        end_date: "",
        daily_target: projectWorkType === "annotation" ? 100 : "",
      },
    ];

    const ws = XLSX.utils.json_to_sheet(headers);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Allocations");

    if (format === "csv") {
      XLSX.writeFile(wb, `${projectName.replace(/\s+/g, "_")}_Bulk_Allocation_Template.csv`, {
        bookType: "csv",
      });
    } else {
      XLSX.writeFile(wb, `${projectName.replace(/\s+/g, "_")}_Bulk_Allocation_Template.xlsx`, {
        bookType: "xlsx",
      });
    }
    toast.success(`Downloaded ${format.toUpperCase()} template.`);
  };

  // Method B: File Upload Parser
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: "binary" });
        const wsname = wb.SheetNames[0];
        if (!wsname) {
          toast.error("Workbook has no sheets.");
          return;
        }
        const ws = wb.Sheets[wsname];
        if (!ws) {
          toast.error("Could not read sheet from workbook.");
          return;
        }
        const data = XLSX.utils.sheet_to_json<Record<string, any>>(ws);

        if (!data || data.length === 0) {
          toast.error("Uploaded file has no data rows.");
          return;
        }

        // Map and lookup users
        const emailMap = new Map(employees.map((emp) => [emp.workEmail.toLowerCase().trim(), emp]));
        const codeMap = new Map(
          employees
            .filter((emp) => emp.employeeCode)
            .map((emp) => [emp.employeeCode!.toLowerCase().trim(), emp]),
        );

        const parsedRows: AllocationRowDraft[] = data.map((row, idx) => {
          const rawId = String(row["employee_id"] || row["employeeId"] || "").trim();
          const rawEmail = String(row["work_email"] || row["email"] || "").toLowerCase().trim();

          // Match by code or email
          const matched = (rawId ? codeMap.get(rawId.toLowerCase()) : null) || (rawEmail ? emailMap.get(rawEmail) : null);

          // Lead lookup if lead email provided
          const rawLeadEmail = String(row["reporting_lead_email"] || "").toLowerCase().trim();
          const matchedLead = rawLeadEmail ? emailMap.get(rawLeadEmail) : null;

          const isAnnotationMember = matched?.workType === "annotation" && projectWorkType === "annotation";

          return {
            id: `up-${idx}-${Date.now()}`,
            userId: matched?.id || "",
            employeeCode: matched?.employeeCode || rawId || "—",
            fullName: matched?.fullName || rawEmail || `Row #${idx + 1}`,
            workEmail: matched?.workEmail || rawEmail || "—",
            departmentName: matched?.departmentName || "Unassigned",
            workType: matched?.workType || null,
            roleInProject: String(row["project_role"] || "General Project Member").trim(),
            reportingLeadId: matchedLead?.id || "",
            reportingLeadName: matchedLead?.fullName || "Default",
            allocationPct: Number(row["allocation_percentage"]) || 100,
            hoursPerDay: Number(row["hours_per_day"]) || 8,
            startDate: String(row["start_date"] || todayIso()).trim(),
            endDate: String(row["end_date"] || "").trim(),
            dailyTaskTarget: isAnnotationMember && row["daily_target"] ? String(row["daily_target"]) : "",
            usedPct: matched?.usedPct ?? 0,
            status: "ready",
          };
        });

        const validated = parsedRows.map((r) => {
          const v = validateRow(r, parsedRows);
          return { ...r, status: v.status, statusMessage: v.message };
        });

        setStagedRows(validated);
        toast.success(`Parsed and validated ${validated.length} employee rows from file.`);
      } catch (err) {
        toast.error(`Error reading file: ${err instanceof Error ? err.message : "Invalid format"}`);
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  };

  // Update a single staged row's property inline
  const updateStagedRow = (id: string, updates: Partial<AllocationRowDraft>) => {
    setStagedRows((prev) => {
      const updated = prev.map((r) => (r.id === id ? { ...r, ...updates } : r));
      return updated.map((r) => {
        const v = validateRow(r, updated);
        return { ...r, status: v.status, statusMessage: v.message };
      });
    });
  };

  // Remove a staged row
  const removeStagedRow = (id: string) => {
    setStagedRows((prev) => {
      const updated = prev.filter((r) => r.id !== id);
      return updated.map((r) => {
        const v = validateRow(r, updated);
        return { ...r, status: v.status, statusMessage: v.message };
      });
    });
  };

  // Bulk Submit Handler
  const handleBulkSubmit = async () => {
    const validRows = stagedRows.filter(
      (r) => r.status === "ready" || r.status === "needs_review" || r.status === "capacity_conflict",
    );

    if (validRows.length === 0) {
      toast.error("There are no valid employee allocations to submit.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = validRows.map((r) => ({
        userId: r.userId,
        roleInProject: r.roleInProject || null,
        reportingLeadId: r.reportingLeadId || null,
        allocationPct: r.allocationPct,
        hoursPerDay: r.hoursPerDay,
        startDate: r.startDate || todayIso(),
        endDate: r.endDate || null,
        dailyTaskTarget: r.dailyTaskTarget ? Number(r.dailyTaskTarget) : null,
        overAllocationOverride: r.status === "capacity_conflict",
      }));

      const res = await bulkCreateAllocations({
        data: {
          projectId,
          allocations: payload,
        },
      });

      toast.success(
        `Successfully allocated ${res.createdCount} employees across departments to ${projectName}!`,
      );

      // Clean up staged rows that succeeded
      const successIds = new Set(res.results.filter((r) => r.status === "created").map((r) => r.userId));
      setStagedRows((prev) => prev.filter((r) => !successIds.has(r.userId)));
      setSelectedIds(new Set());

      await onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk allocation failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Preview filtering
  const previewFiltered = useMemo(() => {
    return stagedRows.filter((r) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "errors") return r.status === "invalid" || r.status === "duplicate" || r.status === "already_allocated";
      return r.status === statusFilter;
    });
  }, [stagedRows, statusFilter]);

  // Validation breakdown
  const counts = useMemo(() => {
    const ready = stagedRows.filter((r) => r.status === "ready").length;
    const review = stagedRows.filter((r) => r.status === "needs_review").length;
    const conflict = stagedRows.filter((r) => r.status === "capacity_conflict").length;
    const invalid = stagedRows.filter(
      (r) => r.status === "invalid" || r.status === "duplicate" || r.status === "already_allocated",
    ).length;
    const totalValid = ready + review + conflict;
    return { ready, review, conflict, invalid, totalValid, total: stagedRows.length };
  }, [stagedRows]);

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      const eligible = selectFilteredEmployees.filter(
        (e) => e.employmentStatus === "active" && e.accountStatus !== "profile_pending" && !e.isAllocatedToProject,
      );
      const newSet = new Set(selectedIds);
      eligible.forEach((e) => newSet.add(e.id));
      setSelectedIds(newSet);
    } else {
      const pageIds = new Set(pagedEmployees.map((e) => e.id));
      const next = new Set(selectedIds);
      pageIds.forEach((id) => next.delete(id));
      setSelectedIds(next);
    }
  };

  const toggleSelectOne = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
  };

  const getStatusBadge = (status: BulkValidationStatus, message?: string) => {
    switch (status) {
      case "ready":
        return <Badge variant="success" className="text-[10px] gap-1"><CheckCircle2 className="size-3" /> Ready</Badge>;
      case "needs_review":
        return <Badge variant="warning" className="text-[10px] gap-1"><HelpCircle className="size-3" /> Needs Review</Badge>;
      case "capacity_conflict":
        return <Badge variant="warning" className="text-[10px] gap-1 bg-amber-500/20 text-amber-800 dark:text-amber-200"><AlertTriangle className="size-3" /> Capacity Conflict</Badge>;
      case "already_allocated":
        return <Badge variant="neutral" className="text-[10px]">Already Allocated</Badge>;
      case "duplicate":
        return <Badge variant="destructive" className="text-[10px] gap-1"><XCircle className="size-3" /> Duplicate</Badge>;
      case "invalid":
      default:
        return <Badge variant="destructive" className="text-[10px] gap-1"><XCircle className="size-3" /> Invalid</Badge>;
    }
  };

  return (
    <div className="space-y-5">
      {/* Method Switcher Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-muted/40 p-1">
          <Button
            size="sm"
            variant={method === "select" ? "default" : "ghost"}
            onClick={() => setMethod("select")}
            className="h-7 text-xs font-medium gap-1.5"
          >
            <Users className="size-3.5" />
            Method A: Select Employees
          </Button>
          <Button
            size="sm"
            variant={method === "upload" ? "default" : "ghost"}
            onClick={() => setMethod("upload")}
            className="h-7 text-xs font-medium gap-1.5"
          >
            <Upload className="size-3.5" />
            Method B: Upload CSV / XLSX
          </Button>
        </div>

        {stagedRows.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Staged: <strong>{counts.totalValid}</strong> valid of {counts.total} rows
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStagedRows([])}
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
            >
              Clear Preview
            </Button>
          </div>
        ) : null}
      </div>

      {/* METHOD A: Multi-Select Table */}
      {method === "select" && stagedRows.length === 0 ? (
        <div className="space-y-4">
          {/* Common Settings Bar */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-primary flex items-center gap-1.5">
                <Sparkles className="size-3.5" />
                Default Settings (applied to selected employees)
              </span>
              <Button
                size="sm"
                onClick={handleStageSelected}
                disabled={selectedIds.size === 0}
                className="h-7 text-xs font-medium"
              >
                Review &amp; Stage Selected ({selectedIds.size})
                <ArrowRight className="size-3.5 ml-1.5" />
              </Button>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Project Role</Label>
                <Select value={commonRole} onValueChange={setCommonRole}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Annotation Contributor">Annotation Contributor</SelectItem>
                    <SelectItem value="Engineering Contributor">Engineering Contributor</SelectItem>
                    <SelectItem value="QA Reviewer">QA Reviewer</SelectItem>
                    <SelectItem value="Operations Support">Operations Support</SelectItem>
                    <SelectItem value="General Project Member">General Project Member</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Reporting Lead</Label>
                <Select value={commonLeadId} onValueChange={setCommonLeadId}>
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Default Lead" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Default Lead</SelectItem>
                    {availableLeads.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Allocation %</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={commonPct}
                  onChange={(e) => setCommonPct(Number(e.target.value) || 100)}
                  className="h-7 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Hours / Day</Label>
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={commonHours}
                  onChange={(e) => setCommonHours(Number(e.target.value) || 8)}
                  className="h-7 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Search name, TAS ID, email..."
                value={searchSelect}
                onChange={(e) => {
                  setSearchSelect(e.target.value);
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
                <SelectItem value="full">Capacity Full (100%+)</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={assignmentFilter}
              onValueChange={(v: "unallocated_to_project" | "all") => {
                setAssignmentFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unallocated_to_project">Not on this project</SelectItem>
                <SelectItem value="all">All Organization Accounts</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table Header with Counts and Pagination */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div>
              Showing <strong>{pagedEmployees.length}</strong> of <strong>{selectFilteredEmployees.length}</strong> eligible candidates across the organization.
              {selectedIds.size > 0 ? (
                <span className="ml-2 font-medium text-primary">
                  ({selectedIds.size} selected across pages)
                </span>
              ) : null}
            </div>
            {totalPages > 1 ? (
              <div className="flex items-center gap-1.5">
                <span>Page {currentPage} of {totalPages}</span>
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

          {/* Table with Checkboxes */}
          <div className="rounded-md border border-border/80 overflow-x-auto max-h-80">
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={
                        pagedEmployees.length > 0 &&
                        pagedEmployees.every((e) => selectedIds.has(e.id))
                      }
                      onCheckedChange={(c) => toggleSelectAll(Boolean(c))}
                    />
                  </TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>TAS ID</TableHead>
                  <TableHead>Home Dept</TableHead>
                  <TableHead>Work Type</TableHead>
                  <TableHead>Primary Role</TableHead>
                  <TableHead className="text-right">Current Load</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectFilteredEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-xs text-muted-foreground">
                      No employees match the filters across the organization.
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedEmployees.map((emp) => {
                    const isChecked = selectedIds.has(emp.id);
                    const isAlreadyAllocated = emp.isAllocatedToProject;
                    const isInactive = emp.employmentStatus !== "active" || emp.accountStatus === "profile_pending";
                    const isSelectable = !isAlreadyAllocated && !isInactive;

                    return (
                      <TableRow
                        key={emp.id}
                        className={`hover:bg-muted/40 cursor-pointer ${
                          isChecked ? "bg-primary/5" : ""
                        } ${!isSelectable ? "opacity-60 bg-muted/20" : ""}`}
                        onClick={() => isSelectable && toggleSelectOne(emp.id, !isChecked)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={isChecked}
                            disabled={!isSelectable}
                            onCheckedChange={(c) => toggleSelectOne(emp.id, Boolean(c))}
                            title={
                              isAlreadyAllocated
                                ? "Already allocated to this project"
                                : isInactive
                                ? `Account is ${emp.employmentStatus}`
                                : "Select for project allocation"
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-xs text-foreground">{emp.fullName}</div>
                          <div className="text-[11px] text-muted-foreground">{emp.workEmail}</div>
                        </TableCell>
                        <TableCell className="font-mono text-xs font-semibold text-primary">
                          {emp.employeeCode || "—"}
                        </TableCell>
                        <TableCell className="text-xs">{emp.departmentName}</TableCell>
                        <TableCell>
                          <Badge variant="neutral" className="text-[10px] capitalize font-normal">
                            {emp.workType || "Unclassified"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs capitalize text-muted-foreground">
                          {emp.primaryRole}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          <span className={emp.usedPct >= 100 ? "text-amber-600 dark:text-amber-400 font-semibold" : ""}>
                            {emp.usedPct}%
                          </span>
                        </TableCell>
                        <TableCell>
                          {isAlreadyAllocated ? (
                            <Badge variant="neutral" className="text-[10px]">On Project</Badge>
                          ) : isInactive ? (
                            <Badge variant="destructive" className="text-[10px]">Inactive</Badge>
                          ) : emp.usedPct >= 100 ? (
                            <Badge variant="warning" className="text-[10px] bg-amber-500/20 text-amber-800 dark:text-amber-200">
                              Full
                            </Badge>
                          ) : (
                            <Badge variant="success" className="text-[10px]">Available</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      {/* METHOD B: CSV / XLSX Upload */}
      {method === "upload" && stagedRows.length === 0 ? (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-border/80 bg-muted/20 p-4">
            <div>
              <h4 className="text-sm font-semibold">Download Project Allocation Template</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Use employee IDs or work emails to match existing organization accounts across all departments.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => handleDownloadTemplate("xlsx")} className="h-8 text-xs gap-1.5">
                <Download className="size-3.5" />
                Template (XLSX)
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleDownloadTemplate("csv")} className="h-8 text-xs gap-1.5">
                <Download className="size-3.5" />
                Template (CSV)
              </Button>
            </div>
          </div>

          <label className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border/80 p-8 text-center cursor-pointer hover:bg-muted/40 transition-colors">
            <Upload className="size-8 text-muted-foreground mb-2" />
            <span className="text-sm font-medium text-foreground">Click to upload or drag &amp; drop</span>
            <span className="text-xs text-muted-foreground mt-1">Supports CSV, XLSX spreadsheets (up to 500 rows)</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>
      ) : null}

      {/* STAGED ROWS & VALIDATION PREVIEW TABLE */}
      {stagedRows.length > 0 ? (
        <div className="space-y-4 animate-in fade-in-50 duration-200">
          {/* Validation Status Summary Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-muted/30 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={statusFilter === "all" ? "default" : "outline"}
                onClick={() => setStatusFilter("all")}
                className="h-7 text-xs font-normal"
              >
                All ({counts.total})
              </Button>
              <Button
                size="sm"
                variant={statusFilter === "ready" ? "default" : "outline"}
                onClick={() => setStatusFilter("ready")}
                className="h-7 text-xs font-normal gap-1"
              >
                <CheckCircle2 className="size-3 text-emerald-600" />
                Ready ({counts.ready})
              </Button>
              {counts.conflict > 0 ? (
                <Button
                  size="sm"
                  variant={statusFilter === "capacity_conflict" ? "default" : "outline"}
                  onClick={() => setStatusFilter("capacity_conflict")}
                  className="h-7 text-xs font-normal gap-1"
                >
                  <AlertTriangle className="size-3 text-amber-600" />
                  Capacity Conflicts ({counts.conflict})
                </Button>
              ) : null}
              {counts.review > 0 ? (
                <Button
                  size="sm"
                  variant={statusFilter === "needs_review" ? "default" : "outline"}
                  onClick={() => setStatusFilter("needs_review")}
                  className="h-7 text-xs font-normal gap-1"
                >
                  <HelpCircle className="size-3 text-amber-500" />
                  Needs Review ({counts.review})
                </Button>
              ) : null}
              {counts.invalid > 0 ? (
                <Button
                  size="sm"
                  variant={statusFilter === "errors" ? "default" : "outline"}
                  onClick={() => setStatusFilter("errors")}
                  className="h-7 text-xs font-normal gap-1 text-destructive hover:text-destructive"
                >
                  <XCircle className="size-3" />
                  Errors ({counts.invalid})
                </Button>
              ) : null}
            </div>

            <Button
              size="sm"
              onClick={handleBulkSubmit}
              disabled={isSubmitting || counts.totalValid === 0}
              className="h-8 gap-1.5 font-medium"
            >
              <UserCheck className="size-3.5" />
              {isSubmitting ? "Allocating..." : `Confirm & Allocate ${counts.totalValid} Members`}
            </Button>
          </div>

          {/* Staged Preview Table */}
          <div className="rounded-md border border-border/80 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/60 hover:bg-transparent">
                  <TableHead>Status</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>TAS ID</TableHead>
                  <TableHead>Home Dept</TableHead>
                  <TableHead>Project Role</TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead className="w-[80px]">Alloc %</TableHead>
                  <TableHead className="w-[70px]">Hrs/Day</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewFiltered.map((row) => (
                  <TableRow key={row.id} className="hover:bg-muted/40">
                    <TableCell>
                      <div className="space-y-0.5">
                        {getStatusBadge(row.status)}
                        {row.statusMessage ? (
                          <div className="text-[10px] text-muted-foreground leading-tight max-w-[180px]">
                            {row.statusMessage}
                          </div>
                        ) : null}
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="font-medium text-xs text-foreground">{row.fullName}</div>
                      <div className="text-[11px] text-muted-foreground">{row.workEmail}</div>
                    </TableCell>

                    <TableCell className="font-mono text-xs font-semibold text-primary">
                      {row.employeeCode}
                    </TableCell>

                    <TableCell className="text-xs">
                      {row.departmentName}
                    </TableCell>

                    <TableCell>
                      <Input
                        value={row.roleInProject}
                        onChange={(e) => updateStagedRow(row.id, { roleInProject: e.target.value })}
                        className="h-7 text-xs w-36"
                      />
                    </TableCell>

                    <TableCell>
                      <Select
                        value={row.reportingLeadId}
                        onValueChange={(v) =>
                          updateStagedRow(row.id, {
                            reportingLeadId: v,
                            reportingLeadName: leadMap.get(v) || "Default",
                          })
                        }
                      >
                        <SelectTrigger className="h-7 text-xs w-32">
                          <SelectValue placeholder="Default Lead" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Default Lead</SelectItem>
                          {availableLeads.map((l) => (
                            <SelectItem key={l.id} value={l.id}>
                              {l.fullName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>

                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={row.allocationPct}
                        onChange={(e) =>
                          updateStagedRow(row.id, { allocationPct: Number(e.target.value) || 100 })
                        }
                        className="h-7 text-xs font-mono"
                      />
                    </TableCell>

                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        max={24}
                        value={row.hoursPerDay}
                        onChange={(e) =>
                          updateStagedRow(row.id, { hoursPerDay: Number(e.target.value) || 8 })
                        }
                        className="h-7 text-xs font-mono"
                      />
                    </TableCell>

                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeStagedRow(row.id)}
                        className="size-7 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
