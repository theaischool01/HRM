import { Link, useRouterState } from "@tanstack/react-router";
import { useActor } from "@/hooks/use-actor";
import type { PermissionKey } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export type HubTab = {
  to: string;
  label: string;
  permission?: PermissionKey;
  anyOf?: PermissionKey[];
};

export function HubSubNav({ tabs }: { tabs: HubTab[] }) {
  const actor = useActor();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const visibleTabs = tabs.filter((tab) => {
    if (tab.permission && !actor.can(tab.permission)) return false;
    if (tab.anyOf && !tab.anyOf.some((p) => actor.can(p))) return false;
    return true;
  });

  if (visibleTabs.length <= 1) return null;

  return (
    <nav
      aria-label="Section navigation"
      className="mb-5 flex max-w-full flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/40 p-1 sm:w-fit"
    >
      {visibleTabs.map((tab) => {
        const active = pathname === tab.to || pathname.startsWith(`${tab.to}/`);
        return (
          <Link
            key={tab.to}
            to={tab.to as never}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-8 items-center rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border border-border/80 bg-card text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export const RECRUITMENT_HUB_TABS: HubTab[] = [
  {
    to: "/candidates",
    label: "Candidates & Pipeline",
    permission: "recruitment:read:all",
  },
  {
    to: "/interviews",
    label: "Interviews & Scorecards",
    anyOf: ["interviews:read:all", "interviews:feedback:assigned"],
  },
  {
    to: "/email-center",
    label: "HR Email Center",
    permission: "emails:read:all",
  },
];

export const ONBOARDING_HUB_TABS: HubTab[] = [
  { to: "/invitations", label: "Add Single Employee", permission: "invitations:read:all" },
  { to: "/roster-import", label: "Bulk Import (CSV / Excel)", permission: "invitations:create:all" },
];

export const ORG_HUB_TABS: HubTab[] = [
  {
    to: "/org",
    label: "Departments, Calendar, RBAC & Audit",
    anyOf: ["org:manage:all", "audit:read:all", "rbac:manage:all"],
  },
  { to: "/office-locations", label: "Office Geofence Locations", permission: "org:manage:all" },
];

export const AUTOMATION_HUB_TABS: HubTab[] = [
  { to: "/automation", label: "Compliance Automation", permission: "automation:run:all" },
  { to: "/import", label: "Legacy Attendance Import", permission: "import:manage:all" },
];

export const OVERSIGHT_HUB_TABS: HubTab[] = [
  {
    to: "/team",
    label: "Attendance, Blockers & EOD Oversight",
    anyOf: ["attendance:read:team", "attendance:read:all"],
  },
  {
    to: "/reviews",
    label: "Hourly Task Reviews",
    anyOf: ["tasks:read:team", "tasks:review:team"],
  },
];
