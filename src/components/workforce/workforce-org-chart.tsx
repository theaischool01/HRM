import { useMemo, useState } from "react";
import {
  AlertCircle,
  Building2,
  ChevronDown,
  ChevronRight,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Search,
  UserCheck,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ROLE_LABELS, type AppRole } from "@/lib/permissions";
import { WORK_TYPE_LABELS, type WorkType } from "@/lib/work-type";
import type { listWorkforce } from "@/lib/workforce.functions";

type WorkforceMember = Awaited<ReturnType<typeof listWorkforce>>[number];

export type OrgChartProps = {
  people: WorkforceMember[];
  onSelectEmployee: (employeeId: string) => void;
};

type TreeNode = {
  person: WorkforceMember;
  children: TreeNode[];
  directReportsCount: number;
};

export function WorkforceOrgChart({ people, onSelectEmployee }: OrgChartProps) {
  const [zoom, setZoom] = useState(1);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");

  // Build hierarchy tree with cycle prevention
  const { roots, unassigned } = useMemo(() => {
    const personMap = new Map<string, WorkforceMember>(people.map((p) => [p.id, p]));
    const childrenMap = new Map<string, WorkforceMember[]>();

    for (const p of people) {
      if (p.reporting_lead_id && personMap.has(p.reporting_lead_id)) {
        const list = childrenMap.get(p.reporting_lead_id) ?? [];
        list.push(p);
        childrenMap.set(p.reporting_lead_id, list);
      }
    }

    // Identify roots: founder, top managers, or people without reporting lead
    const rootPeople: WorkforceMember[] = [];
    const unassignedPeople: WorkforceMember[] = [];

    for (const p of people) {
      const hasLead = Boolean(p.reporting_lead_id && personMap.has(p.reporting_lead_id));
      if (!hasLead) {
        const isLeadership =
          p.roles.includes("founder") ||
          p.roles.includes("admin") ||
          (p.roles.includes("manager") && (childrenMap.get(p.id)?.length ?? 0) > 0);

        if (isLeadership) {
          rootPeople.push(p);
        } else {
          unassignedPeople.push(p);
        }
      }
    }

    // Recursive tree constructor with cycle detection
    function buildNode(person: WorkforceMember, visited: Set<string>): TreeNode {
      const nextVisited = new Set(visited).add(person.id);
      const directChildren = (childrenMap.get(person.id) ?? []).filter(
        (child) => !nextVisited.has(child.id),
      );

      return {
        person,
        children: directChildren.map((c) => buildNode(c, nextVisited)),
        directReportsCount: directChildren.length,
      };
    }

    const treeRoots = rootPeople.map((r) => buildNode(r, new Set()));
    return { roots: treeRoots, unassigned: unassignedPeople };
  }, [people]);

  function toggleCollapse(nodeId: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  function expandAll() {
    setCollapsedIds(new Set());
  }

  function collapseAll() {
    const allParentIds = new Set<string>();
    function collect(node: TreeNode) {
      if (node.children.length > 0) {
        allParentIds.add(node.person.id);
        node.children.forEach(collect);
      }
    }
    roots.forEach(collect);
    setCollapsedIds(allParentIds);
  }

  const normalizedSearch = searchTerm.trim().toLowerCase();

  return (
    <div className="flex flex-col rounded-xl border border-border/80 bg-card overflow-hidden shadow-xs">
      {/* Chart Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 bg-muted/30 p-3 text-xs">
        {/* Search within chart */}
        <div className="relative min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Highlight employee in chart…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-8 pl-8 text-xs bg-background"
          />
        </div>

        {/* Zoom & Expansion Controls */}
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={expandAll}
            className="h-8 px-2.5 text-xs"
          >
            Expand All
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={collapseAll}
            className="h-8 px-2.5 text-xs"
          >
            Collapse All
          </Button>

          <div className="h-4 w-px bg-border mx-1" />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.1).toFixed(1))))}
            className="h-8 w-8 p-0"
            title="Zoom out"
          >
            <Minus className="size-3.5" />
          </Button>
          <span className="font-mono text-xs w-10 text-center font-medium">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setZoom((z) => Math.min(1.6, Number((z + 0.1).toFixed(1))))}
            className="h-8 w-8 p-0"
            title="Zoom in"
          >
            <Plus className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setZoom(1)}
            className="h-8 w-8 p-0"
            title="Reset zoom to 100%"
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Main Interactive Zoomable Canvas */}
      <div className="relative min-h-[500px] overflow-auto p-8 bg-muted/10">
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top center",
            transition: "transform 0.15s ease-out",
          }}
          className="inline-flex min-w-full justify-center pb-12"
        >
          {roots.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No organization structure found for current filters.
            </div>
          ) : (
            <div className="flex gap-12 justify-center">
              {roots.map((root) => (
                <OrgNodeItem
                  key={root.person.id}
                  node={root}
                  collapsedIds={collapsedIds}
                  onToggleCollapse={toggleCollapse}
                  onSelectEmployee={onSelectEmployee}
                  searchTerm={normalizedSearch}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Unassigned Reporting Relationships Tray */}
      {unassigned.length > 0 && (
        <div className="border-t border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-300">
            <AlertCircle className="size-4 shrink-0 text-amber-600" />
            <span>Unassigned Reporting Relationships ({unassigned.length})</span>
          </div>
          <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-400">
            These employees are not connected to a reporting lead or manager in the principal organization tree. Click any person to inspect or assign.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {unassigned.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectEmployee(p.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:border-primary hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="font-semibold">{p.full_name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">({p.employee_code ?? "No ID"})</span>
                {p.department_name && (
                  <span className="text-[10px] text-muted-foreground">· {p.department_name}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OrgNodeItem({
  node,
  collapsedIds,
  onToggleCollapse,
  onSelectEmployee,
  searchTerm,
}: {
  node: TreeNode;
  collapsedIds: Set<string>;
  onToggleCollapse: (id: string) => void;
  onSelectEmployee: (id: string) => void;
  searchTerm: string;
}) {
  const isCollapsed = collapsedIds.has(node.person.id);
  const hasChildren = node.children.length > 0;
  const isMatched =
    Boolean(searchTerm) &&
    [node.person.full_name, node.person.employee_code, node.person.work_email, node.person.designation].some(
      (v) => (v ?? "").toLowerCase().includes(searchTerm),
    );

  const primaryRole = (node.person.roles[0] as AppRole) ?? "employee";

  return (
    <div className="flex flex-col items-center">
      {/* Node Card */}
      <div
        className={`group relative flex w-60 flex-col rounded-xl border bg-card p-3 shadow-xs transition-all hover:shadow-md hover:border-primary/60 cursor-pointer ${
          isMatched
            ? "ring-2 ring-red-600 border-red-500 bg-red-50/30 dark:bg-red-950/20"
            : "border-border/80"
        }`}
        onClick={() => onSelectEmployee(node.person.id)}
      >
        <div className="flex items-start gap-2.5">
          <Avatar className="size-10 border border-border/80 shrink-0">
            <AvatarImage src={node.person.photo_url ?? undefined} alt={node.person.full_name} />
            <AvatarFallback className="bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300 font-bold text-xs">
              {node.person.full_name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <span className="font-bold text-xs text-foreground truncate">{node.person.full_name}</span>
            </div>
            <div className="font-mono text-[10px] text-muted-foreground truncate">
              {node.person.employee_code ?? "—"}
            </div>
            <div className="text-[11px] text-muted-foreground truncate mt-0.5">
              {node.person.designation || "Staff"}
            </div>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2 text-[10px]">
          <span className="rounded bg-secondary/80 px-1.5 py-0.5 font-medium text-secondary-foreground">
            {ROLE_LABELS[primaryRole] ?? primaryRole}
          </span>
          {node.person.department_name && (
            <span className="truncate text-muted-foreground">· {node.person.department_name}</span>
          )}
          {node.directReportsCount > 0 && (
            <span className="ml-auto inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">
              <Users className="size-2.5" />
              <span>{node.directReportsCount}</span>
            </span>
          )}
        </div>

        {/* Expand / Collapse toggle for nodes with children */}
        {hasChildren && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(node.person.id);
            }}
            className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex size-6 items-center justify-center rounded-full border border-border bg-background shadow-xs hover:bg-muted text-muted-foreground hover:text-foreground transition-colors z-10"
            title={isCollapsed ? `Expand ${node.children.length} direct reports` : "Collapse direct reports"}
          >
            {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
          </button>
        )}
      </div>

      {/* Connector lines to children */}
      {hasChildren && !isCollapsed && (
        <div className="flex flex-col items-center w-full">
          {/* Vertical stem from parent */}
          <div className="w-px h-6 bg-border" />

          {/* Children container */}
          <div className="flex justify-center relative">
            {node.children.length > 1 && (
              /* Horizontal bar spanning across children */
              <div
                className="absolute top-0 border-t border-border"
                style={{
                  left: "calc(15rem / 2)",
                  right: "calc(15rem / 2)",
                }}
              />
            )}

            <div className="flex gap-8 items-start">
              {node.children.map((child) => (
                <div key={child.person.id} className="flex flex-col items-center">
                  {/* Stem down to child */}
                  <div className="w-px h-6 bg-border" />
                  <OrgNodeItem
                    node={child}
                    collapsedIds={collapsedIds}
                    onToggleCollapse={onToggleCollapse}
                    onSelectEmployee={onSelectEmployee}
                    searchTerm={searchTerm}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
