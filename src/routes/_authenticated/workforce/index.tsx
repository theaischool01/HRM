import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { actorQueryOptions, useActor } from "@/hooks/use-actor";
import { downloadCsv, toCsv } from "@/lib/csv";
import {
  CATEGORY_LABELS,
  ROLE_LABELS,
  type AppRole,
  type UserCategory,
} from "@/lib/permissions";
import { WORK_TYPE_LABELS, type WorkType } from "@/lib/work-type";
import {
  getOrgReference,
  listWorkforce,
  reactivateEmployee,
} from "@/lib/workforce.functions";
import { sendAccountSetupEmails } from "@/lib/onboarding.functions";
import {
  WorkforceHeader,
  type WorkforceViewMode,
} from "@/components/workforce/workforce-header";
import {
  WorkforceKpis,
  type ActiveFilterShortcut,
  type WorkforceKpiStats,
} from "@/components/workforce/workforce-kpis";
import {
  DEFAULT_WORKFORCE_FILTERS,
  WorkforceFilters,
  type WorkforceFilterValues,
} from "@/components/workforce/workforce-filters";
import { WorkforceTable } from "@/components/workforce/workforce-table";
import { WorkforceOrgChart } from "@/components/workforce/workforce-org-chart";
import { EmployeeDetailDrawer } from "@/components/workforce/employee-detail-drawer";
import {
  DeactivateEmployeeDialog,
  type DeactivateEmployeeTarget,
} from "@/components/workforce/deactivate-employee-dialog";
import {
  DeleteEmployeeDialog,
  type DeleteEmployeeTarget,
} from "@/components/workforce/delete-employee-dialog";

export const Route = createFileRoute("/_authenticated/workforce/")({
  head: () => ({
    meta: [
      { title: "Workforce | The AI School HRM" },
      {
        name: "description",
        content: "Manage employees, reporting relationships, onboarding and verification.",
      },
      { property: "og:title", content: "Workforce | The AI School HRM" },
      { property: "og:description", content: "People management hub with table and organization chart." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(actorQueryOptions),
  component: WorkforcePage,
});

function WorkforcePage() {
  const actor = useActor();
  const queryClient = useQueryClient();

  const { data: people, refetch, isFetching } = useSuspenseQuery({
    queryKey: ["workforce"],
    queryFn: () => listWorkforce(),
  });

  const { data: orgRef } = useQuery({
    queryKey: ["org-reference"],
    queryFn: () => getOrgReference(),
  });

  // State
  const [viewMode, setViewMode] = useState<WorkforceViewMode>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tas_workforce_view_mode");
      if (saved === "chart" || saved === "table") return saved;
    }
    return "table";
  });

  const [filters, setFilters] = useState<WorkforceFilterValues>(DEFAULT_WORKFORCE_FILTERS);
  const [activeShortcut, setActiveShortcut] = useState<ActiveFilterShortcut>(null);

  // Drawer & Dialog state
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<DeactivateEmployeeTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteEmployeeTarget>(null);

  function handleViewModeChange(mode: WorkforceViewMode) {
    setViewMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem("tas_workforce_view_mode", mode);
    }
  }

  // Filter shortcut handler from KPI cards
  function handleSelectShortcut(shortcut: ActiveFilterShortcut) {
    setActiveShortcut(shortcut);
    if (!shortcut) {
      setFilters(DEFAULT_WORKFORCE_FILTERS);
      return;
    }

    if (shortcut === "active_only") {
      setFilters({ ...DEFAULT_WORKFORCE_FILTERS, employmentStatus: "active" });
    } else if (shortcut === "onboarding_pending") {
      setFilters({ ...DEFAULT_WORKFORCE_FILTERS, accountStatus: "all", employmentStatus: "active", needsHrAttention: false });
    } else if (shortcut === "profiles_awaiting_review") {
      setFilters({ ...DEFAULT_WORKFORCE_FILTERS, accountStatus: "under_verification" });
    } else if (shortcut === "kyc_pending") {
      setFilters({ ...DEFAULT_WORKFORCE_FILTERS, kycStatus: "under_review" });
    } else if (shortcut === "kyc_corrections") {
      setFilters({ ...DEFAULT_WORKFORCE_FILTERS, kycStatus: "correction_required" });
    } else if (shortcut === "open_requests") {
      setFilters({ ...DEFAULT_WORKFORCE_FILTERS, hasPendingRequests: true });
    }
  }

  // Permissions
  const canCreateEmployee = actor.can("workforce:create:all");
  const canImport = actor.can("import:manage:all");
  const canManageWorkforce = actor.can("workforce:update:all") || actor.can("workforce:deactivate:all");
  const canExport = actor.can("reports:export:scoped") || actor.can("workforce:read:all");
  const isSuperAdmin = actor.roles.includes("super_admin");
  const isHr = actor.roles.includes("hr");

  // Real KPI calculations from people
  const stats: WorkforceKpiStats = {
    totalActive: people.filter((p) => p.employment_status === "active").length,
    onboardingPending: people.filter(
      (p) => p.account_status !== "active" && p.employment_status === "active",
    ).length,
    profilesAwaitingReview: people.filter((p) => p.account_status === "under_verification").length,
    kycVerificationPending: people.filter(
      (p) => p.kyc_pending_count > 0 || p.kyc_status === "under_review",
    ).length,
    kycCorrectionsRequired: people.filter(
      (p) => p.kyc_rejected_count > 0 || p.kyc_status === "correction_required",
    ).length,
    openRequests: people.reduce((acc, p) => acc + (p.pending_requests_count || 0), 0),
  };

  const attentionTotal = people.filter((p) => p.needs_hr_attention).length;

  // Filter people
  const term = filters.search.trim().toLowerCase();
  const filteredPeople = people.filter((p) => {
    // KPI shortcut: Onboarding pending
    if (activeShortcut === "onboarding_pending") {
      if (p.account_status === "active" || p.employment_status !== "active") return false;
    }

    if (filters.departmentId !== "all" && p.department_id !== filters.departmentId) return false;
    if (filters.workType !== "all" && p.work_type !== filters.workType) return false;
    if (filters.role !== "all" && !p.roles.includes(filters.role)) return false;
    if (filters.category !== "all" && p.category !== filters.category) return false;
    if (filters.accountStatus !== "all" && p.account_status !== filters.accountStatus) return false;
    if (filters.employmentStatus !== "all" && p.employment_status !== filters.employmentStatus) return false;
    if (filters.kycStatus !== "all" && p.kyc_status !== filters.kycStatus) return false;
    if (filters.reportingLeadId !== "all" && p.reporting_lead_id !== filters.reportingLeadId) return false;

    if (filters.needsHrAttention && !p.needs_hr_attention) return false;
    if (filters.missingReportingLead && !p.missingReportingLead) return false;
    if (filters.hasPendingRequests && (p.pending_requests_count ?? 0) === 0) return false;

    if (!term) return true;
    return [
      p.full_name,
      p.employee_code,
      p.work_email,
      p.designation,
      p.department_name,
      p.reporting_lead_name,
    ].some((v) => (v ?? "").toLowerCase().includes(term));
  });

  // Export CSV handler
  function handleExportCsv() {
    if (!canExport) return;
    const columns = [
      { key: "full_name", header: "Full Name", value: (p: typeof people[0]) => p.full_name },
      { key: "employee_code", header: "Employee ID", value: (p: typeof people[0]) => p.employee_code ?? "" },
      { key: "work_email", header: "Work Email", value: (p: typeof people[0]) => p.work_email },
      { key: "designation", header: "Designation", value: (p: typeof people[0]) => p.designation ?? "" },
      { key: "department", header: "Department", value: (p: typeof people[0]) => p.department_name ?? "" },
      { key: "work_type", header: "Work Type", value: (p: typeof people[0]) => p.work_type ? WORK_TYPE_LABELS[p.work_type as WorkType] ?? p.work_type : "" },
      { key: "role", header: "Role", value: (p: typeof people[0]) => p.roles.map((r) => ROLE_LABELS[r as AppRole] ?? r).join(", ") },
      { key: "category", header: "Category", value: (p: typeof people[0]) => p.category ? CATEGORY_LABELS[p.category as UserCategory] ?? p.category : "" },
      { key: "onboarding", header: "Onboarding Lifecycle", value: (p: typeof people[0]) => p.onboarding_lifecycle_status },
      { key: "kyc_status", header: "KYC Status", value: (p: typeof people[0]) => p.kyc_status },
      { key: "kyc_verified", header: "Verified Documents", value: (p: typeof people[0]) => `${p.kyc_verified_count}/5` },
      { key: "reporting_lead", header: "Reporting Lead", value: (p: typeof people[0]) => p.reporting_lead_name ?? "" },
      { key: "joining_date", header: "Joining Date", value: (p: typeof people[0]) => p.joining_date ?? "" },
      { key: "employment_status", header: "Employment Status", value: (p: typeof people[0]) => p.employment_status },
    ];

    const csvContent = toCsv(filteredPeople, columns);
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadCsv(`the-ai-school-workforce-${dateStr}.csv`, csvContent);
    toast.success(`Exported ${filteredPeople.length} employee records to CSV.`);
  }

  // Reactivate employee handler
  async function handleReactivate(userId: string) {
    try {
      await reactivateEmployee({ data: { userId } });
      toast.success("Employee account reactivated.");
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to reactivate employee.");
    }
  }

  // Send setup email handler
  async function handleSendSetupEmail(userId: string, email: string) {
    try {
      const res = await sendAccountSetupEmails({
        data: { userIds: [userId], confirmed: true, resend: true },
      });
      if (res.results[0]?.outcome === "smtp_accepted") {
        toast.success(`Account setup email dispatched to ${email}.`);
        refetch();
      } else {
        toast.error(res.results[0]?.reason ?? "Failed to send setup email.");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Error sending setup email.");
    }
  }

  const deptList = (orgRef?.departments ?? []).map((d) => ({ id: d.id, name: d.name }));
  const leadList = (orgRef?.people ?? []).map((p) => ({ id: p.id, name: p.full_name }));

  return (
    <AppShell title="Workforce" description="People management hub">
      <div className="space-y-4">
        {/* Header */}
        <WorkforceHeader
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          canCreateEmployee={canCreateEmployee}
          canImport={canImport}
          canExport={canExport}
          onExport={handleExportCsv}
          onRefresh={() => refetch()}
          isRefreshing={isFetching}
          attentionCount={attentionTotal}
          isAttentionFilterActive={filters.needsHrAttention}
          onToggleAttentionFilter={() =>
            setFilters((f) => ({ ...f, needsHrAttention: !f.needsHrAttention }))
          }
        />

        {/* Workforce KPI Summary Cards */}
        <WorkforceKpis
          stats={stats}
          activeShortcut={activeShortcut}
          onSelectShortcut={handleSelectShortcut}
        />

        {/* Advanced Filters Toolbar */}
        <WorkforceFilters
          filters={filters}
          onChange={setFilters}
          departments={deptList}
          leads={leadList}
          totalVisible={filteredPeople.length}
          totalAvailable={people.length}
        />

        {/* Main View: Table View or Organization Chart */}
        {viewMode === "table" ? (
          <WorkforceTable
            people={filteredPeople}
            onSelectEmployee={(id) => setSelectedPersonId(id)}
            canManageWorkforce={canManageWorkforce}
            isSuperAdmin={isSuperAdmin}
            onDeactivate={(target) => setDeactivateTarget(target)}
            onReactivate={handleReactivate}
            onDelete={(target) => setDeleteTarget(target)}
            onSendSetupEmail={handleSendSetupEmail}
          />
        ) : (
          <WorkforceOrgChart
            people={filteredPeople}
            onSelectEmployee={(id) => setSelectedPersonId(id)}
          />
        )}
      </div>

      {/* Employee Details Drawer */}
      <EmployeeDetailDrawer
        personId={selectedPersonId}
        open={Boolean(selectedPersonId)}
        onOpenChange={(isOpen) => {
          if (!isOpen) setSelectedPersonId(null);
        }}
        canManageWorkforce={canManageWorkforce}
        isSuperAdmin={isSuperAdmin}
        isHr={isHr}
        onDeactivate={(target) => setDeactivateTarget(target)}
        onDelete={(target) => setDeleteTarget(target)}
      />

      {/* Deactivate Employee Confirmation Dialog */}
      <DeactivateEmployeeDialog
        target={deactivateTarget}
        open={Boolean(deactivateTarget)}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDeactivateTarget(null);
        }}
        onSuccess={() => refetch()}
      />

      {/* Permanently Delete Employee Confirmation Dialog */}
      <DeleteEmployeeDialog
        target={deleteTarget}
        open={Boolean(deleteTarget)}
        onOpenChange={(isOpen) => {
          if (!isOpen) setDeleteTarget(null);
        }}
        onSuccess={() => refetch()}
      />
    </AppShell>
  );
}
