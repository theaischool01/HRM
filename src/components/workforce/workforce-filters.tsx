import { ChevronDown, ChevronUp, Filter, Search, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_LABELS,
  APP_ROLES,
  CATEGORY_LABELS,
  EMPLOYMENT_STATUSES,
  ROLE_LABELS,
  USER_CATEGORIES,
  type AccountStatus,
  type AppRole,
  type EmploymentStatus,
  type UserCategory,
} from "@/lib/permissions";
import { WORK_TYPE_LABELS, WORK_TYPES, type WorkType } from "@/lib/work-type";
import { KYC_STATUS_LABELS, type KycStatus } from "@/lib/kyc/kyc-notifications";

export type WorkforceFilterValues = {
  search: string;
  departmentId: string;
  workType: string;
  role: string;
  category: string;
  accountStatus: string;
  employmentStatus: string;
  kycStatus: string;
  reportingLeadId: string;
  needsHrAttention: boolean;
  missingReportingLead: boolean;
  hasPendingRequests: boolean;
};

export type WorkforceFiltersProps = {
  filters: WorkforceFilterValues;
  onChange: (filters: WorkforceFilterValues) => void;
  departments: { id: string; name: string }[];
  leads: { id: string; name: string }[];
  totalVisible: number;
  totalAvailable: number;
};

export const DEFAULT_WORKFORCE_FILTERS: WorkforceFilterValues = {
  search: "",
  departmentId: "all",
  workType: "all",
  role: "all",
  category: "all",
  accountStatus: "all",
  employmentStatus: "active",
  kycStatus: "all",
  reportingLeadId: "all",
  needsHrAttention: false,
  missingReportingLead: false,
  hasPendingRequests: false,
};

export function WorkforceFilters({
  filters,
  onChange,
  departments,
  leads,
  totalVisible,
  totalAvailable,
}: WorkforceFiltersProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  function update(patch: Partial<WorkforceFilterValues>) {
    onChange({ ...filters, ...patch });
  }

  function clearAll() {
    onChange({ ...DEFAULT_WORKFORCE_FILTERS, employmentStatus: "all" });
  }

  const activeCount = [
    filters.search.trim() !== "",
    filters.departmentId !== "all",
    filters.workType !== "all",
    filters.role !== "all",
    filters.category !== "all",
    filters.accountStatus !== "all",
    filters.employmentStatus !== "all",
    filters.kycStatus !== "all",
    filters.reportingLeadId !== "all",
    filters.needsHrAttention,
    filters.missingReportingLead,
    filters.hasPendingRequests,
  ].filter(Boolean).length;

  return (
    <div className="space-y-2.5 rounded-xl border border-border/80 bg-card p-3.5 shadow-2xs">
      {/* Primary Toolbar */}
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {/* Search */}
        <div className="relative sm:col-span-2 xl:col-span-2">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search employees"
            placeholder="Search name, ID, email, title…"
            value={filters.search}
            onChange={(e) => update({ search: e.target.value })}
            className="h-9 pl-9 text-xs"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => update({ search: "" })}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Department Filter */}
        <select
          aria-label="Filter by department"
          value={filters.departmentId}
          onChange={(e) => update({ departmentId: e.target.value })}
          className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="all">All Departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        {/* Work Type Filter */}
        <select
          aria-label="Filter by work type"
          value={filters.workType}
          onChange={(e) => update({ workType: e.target.value })}
          className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="all">All Work Types</option>
          {WORK_TYPES.map((wt) => (
            <option key={wt} value={wt}>
              {WORK_TYPE_LABELS[wt]}
            </option>
          ))}
        </select>

        {/* Role Filter */}
        <select
          aria-label="Filter by role"
          value={filters.role}
          onChange={(e) => update({ role: e.target.value })}
          className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="all">All Roles</option>
          {APP_ROLES.filter((r) => r !== "super_admin").map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>

        {/* KYC Status Filter */}
        <select
          aria-label="Filter by KYC status"
          value={filters.kycStatus}
          onChange={(e) => update({ kycStatus: e.target.value })}
          className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="all">All KYC Statuses</option>
          <option value="verified">Fully Verified</option>
          <option value="under_review">Submitted / Under Review</option>
          <option value="correction_required">Correction Required</option>
          <option value="incomplete">Incomplete / In Progress</option>
          <option value="not_started">Not Started</option>
        </select>

        {/* Advanced Toggle + Clear */}
        <div className="flex items-center gap-1.5 sm:col-span-2 lg:col-span-4 xl:col-span-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className={`h-9 flex-1 gap-1.5 px-2.5 text-xs ${
              showAdvanced || activeCount > 3 ? "border-primary/50 text-primary" : ""
            }`}
          >
            <Filter className="size-3.5" aria-hidden="true" />
            <span>Filters</span>
            {activeCount > 0 && (
              <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {activeCount}
              </span>
            )}
            {showAdvanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </Button>

          {activeCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="h-9 px-2 text-xs text-muted-foreground hover:text-foreground"
              title="Clear all filters"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Expandable Advanced Filters */}
      {showAdvanced && (
        <div className="border-t border-border/60 pt-3">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {/* Category Filter */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Category</label>
              <select
                value={filters.category}
                onChange={(e) => update({ category: e.target.value })}
                className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground"
              >
                <option value="all">All Categories</option>
                {USER_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            {/* Onboarding / Account Status */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Account Lifecycle</label>
              <select
                value={filters.accountStatus}
                onChange={(e) => update({ accountStatus: e.target.value })}
                className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground"
              >
                <option value="all">All Account Statuses</option>
                {ACCOUNT_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {ACCOUNT_STATUS_LABELS[st]}
                  </option>
                ))}
              </select>
            </div>

            {/* Employment Status */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Employment State</label>
              <select
                value={filters.employmentStatus}
                onChange={(e) => update({ employmentStatus: e.target.value })}
                className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground"
              >
                <option value="all">All States</option>
                <option value="active">Active Only</option>
                <option value="inactive">Inactive / Deactivated Only</option>
                <option value="on_hold">On Hold</option>
                <option value="exited">Exited</option>
              </select>
            </div>

            {/* Reporting Lead */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Reporting Lead / Manager</label>
              <select
                value={filters.reportingLeadId}
                onChange={(e) => update({ reportingLeadId: e.target.value })}
                className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground"
              >
                <option value="all">All Reporting Leads</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick Checkbox Toggles */}
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
            <label className="inline-flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
              <input
                type="checkbox"
                checked={filters.needsHrAttention}
                onChange={(e) => update({ needsHrAttention: e.target.checked })}
                className="size-3.5 rounded-sm border-input text-red-600 focus:ring-red-500"
              />
              <span className="font-medium">Needs HR Review / Attention</span>
            </label>

            <label className="inline-flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
              <input
                type="checkbox"
                checked={filters.missingReportingLead}
                onChange={(e) => update({ missingReportingLead: e.target.checked })}
                className="size-3.5 rounded-sm border-input text-amber-600 focus:ring-amber-500"
              />
              <span className="font-medium">Missing Reporting Lead</span>
            </label>

            <label className="inline-flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
              <input
                type="checkbox"
                checked={filters.hasPendingRequests}
                onChange={(e) => update({ hasPendingRequests: e.target.checked })}
                className="size-3.5 rounded-sm border-input text-purple-600 focus:ring-purple-500"
              />
              <span className="font-medium">Has Open Employee Requests</span>
            </label>
          </div>
        </div>
      )}

      {/* Showing count indicator */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
        <span>
          Showing <strong className="font-semibold text-foreground">{totalVisible}</strong> of{" "}
          <strong className="font-semibold text-foreground">{totalAvailable}</strong> employees
        </span>
        {activeCount > 0 && (
          <span className="text-primary font-medium">
            {activeCount} filter{activeCount > 1 ? "s" : ""} applied
          </span>
        )}
      </div>
    </div>
  );
}
