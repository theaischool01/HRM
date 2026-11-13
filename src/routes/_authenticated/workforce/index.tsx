import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { actorQueryOptions } from "@/hooks/use-actor";
import {
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_LABELS,
  APP_ROLES,
  CATEGORY_LABELS,
  ROLE_LABELS,
  USER_CATEGORIES,
  type AccountStatus,
  type AppRole,
  type UserCategory,
} from "@/lib/permissions";
import { WORK_TYPE_LABELS, type WorkType } from "@/lib/work-type";
import { listWorkforce } from "@/lib/workforce.functions";

export const Route = createFileRoute("/_authenticated/workforce/")({
  head: () => ({
    meta: [
      { title: "Workforce Directory | The AI School HRM" },
      {
        name: "description",
        content: "Directory of staff, leads, and managers with role, category, and onboarding status.",
      },
      { property: "og:title", content: "Workforce Directory | The AI School HRM" },
      { property: "og:description", content: "Staff directory and verification status." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(actorQueryOptions),
  component: WorkforcePage,
});

const STATUS_BADGE_VARIANT: Record<
  AccountStatus,
  "neutral" | "info" | "warning" | "success"
> = {
  invited: "neutral",
  activated: "info",
  profile_pending: "warning",
  under_verification: "warning",
  active: "success",
};

function WorkforcePage() {
  const { data: people } = useSuspenseQuery({
    queryKey: ["workforce"],
    queryFn: () => listWorkforce(),
  });
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const hasActiveFilter =
    query.trim() !== "" ||
    roleFilter !== "all" ||
    categoryFilter !== "all" ||
    statusFilter !== "all";

  function clearFilters() {
    setQuery("");
    setRoleFilter("all");
    setCategoryFilter("all");
    setStatusFilter("all");
  }

  const term = query.trim().toLowerCase();
  const filtered = people.filter((p) => {
    if (roleFilter !== "all" && !p.roles.includes(roleFilter)) return false;
    if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
    if (statusFilter !== "all" && p.account_status !== statusFilter) return false;
    if (!term) return true;
    return [
      p.full_name,
      p.work_email,
      p.designation,
      p.employee_code,
      p.department_name,
    ].some((v) => (v ?? "").toLowerCase().includes(term));
  });

  const unassigned = people.filter((p) => p.missingReportingLead);

  return (
    <AppShell
      title="Workforce Directory"
      description={`${filtered.length} of ${people.length} ${people.length === 1 ? "person" : "people"} visible in your scope`}
      actions={
        hasActiveFilter ? (
          <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
            <X className="mr-1.5 size-3.5" aria-hidden="true" />
            Clear filters
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {unassigned.length > 0 && (
          <Card className="border-warning/40 bg-warning/10 p-4">
            <p className="text-sm font-medium text-warning">
              {unassigned.length} {unassigned.length === 1 ? "person has" : "people have"} no
              reporting lead
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              They cannot submit leave, WFH, or attendance-correction requests until a reporting
              lead is assigned.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {unassigned.map((person) => (
                <Link
                  key={person.id}
                  to="/workforce/$personId"
                  params={{ personId: person.id }}
                  className="rounded-md border border-warning/40 bg-background px-2.5 py-1 text-xs font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {person.full_name}
                </Link>
              ))}
            </div>
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search workforce directory"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, ID, email, dept…"
              className="pl-9"
            />
          </div>
          <select
            aria-label="Filter by role"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="all">All roles</option>
            {APP_ROLES.filter((r) => r !== "super_admin").map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by employment category"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="all">All employment categories</option>
            {USER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by onboarding status"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All onboarding statuses</option>
            {ACCOUNT_STATUSES.map((st) => (
              <option key={st} value={st}>
                {ACCOUNT_STATUS_LABELS[st]}
              </option>
            ))}
          </select>
        </div>

        {/* Mobile stacked directory cards (<768px) */}
        <div className="space-y-2.5 md:hidden">
          {filtered.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              <p>No workforce profiles match your current search or filter criteria.</p>
              {hasActiveFilter && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              )}
            </Card>
          ) : (
            filtered.map((person) => {
              const status = person.account_status as AccountStatus;
              return (
                <Link
                  key={person.id}
                  to="/workforce/$personId"
                  params={{ personId: person.id }}
                  className="block rounded-xl border border-border/80 bg-card p-3.5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{person.full_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{person.work_email}</p>
                    </div>
                    <Badge variant={STATUS_BADGE_VARIANT[status] ?? "outline"}>
                      {ACCOUNT_STATUS_LABELS[status]}
                    </Badge>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono">{person.employee_code ?? "ID Pending"}</span>
                    <span>
                      {person.roles.map((r) => ROLE_LABELS[r as AppRole] ?? r).join(", ") || "—"}
                    </span>
                    <span>{CATEGORY_LABELS[person.category as UserCategory] ?? "—"}</span>
                    {person.work_type && (
                      <Badge variant="outline" className="text-[11px]">
                        {WORK_TYPE_LABELS[person.work_type as WorkType] ?? person.work_type}
                      </Badge>
                    )}
                    <span>
                      {person.department_name ?? "Unassigned"}
                      {person.designation ? ` · ${person.designation}` : ""}
                    </span>
                  </div>
                </Link>
              );
            })
          )}
        </div>

        {/* Tablet & Desktop directory table (>=768px) */}
        <Card className="hidden overflow-hidden p-0 md:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Person
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Employee ID
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Role
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Category
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Department / Title
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((person) => {
                  const status = person.account_status as AccountStatus;
                  return (
                    <tr key={person.id} className="hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <Link
                          to="/workforce/$personId"
                          params={{ personId: person.id }}
                          className="rounded-xs font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {person.full_name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{person.work_email}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {person.employee_code ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-foreground">
                        {person.roles
                          .map((r) => ROLE_LABELS[r as AppRole] ?? r)
                          .join(", ") || "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {CATEGORY_LABELS[person.category as UserCategory] ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <span className="text-foreground">
                          {person.department_name ?? "Unassigned"}
                        </span>
                        {person.designation ? ` · ${person.designation}` : ""}
                        {person.work_type && (
                          <Badge variant="outline" className="ml-2 text-[11px]">
                            {WORK_TYPE_LABELS[person.work_type as WorkType] ?? person.work_type}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_BADGE_VARIANT[status] ?? "outline"}>
                          {ACCOUNT_STATUS_LABELS[status]}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                      <p>No workforce profiles match your current search or filter criteria.</p>
                      {hasActiveFilter && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={clearFilters}
                        >
                          Clear filters
                        </Button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
