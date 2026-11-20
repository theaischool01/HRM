import { Link } from "@tanstack/react-router";
import { Download, FileSpreadsheet, LayoutGrid, Network, RefreshCw, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type WorkforceViewMode = "table" | "chart";

export type WorkforceHeaderProps = {
  viewMode: WorkforceViewMode;
  onViewModeChange: (mode: WorkforceViewMode) => void;
  canCreateEmployee: boolean;
  canImport: boolean;
  canExport: boolean;
  onExport: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  attentionCount?: number;
  isAttentionFilterActive?: boolean;
  onToggleAttentionFilter?: () => void;
};

export function WorkforceHeader({
  viewMode,
  onViewModeChange,
  canCreateEmployee,
  canImport,
  canExport,
  onExport,
  onRefresh,
  isRefreshing,
  attentionCount = 0,
  isAttentionFilterActive,
  onToggleAttentionFilter,
}: WorkforceHeaderProps) {
  return (
    <div className="flex flex-col gap-4 border-b border-border/80 pb-5 pt-1 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Workforce</h1>
          {attentionCount > 0 && onToggleAttentionFilter && (
            <button
              type="button"
              onClick={onToggleAttentionFilter}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${
                isAttentionFilterActive
                  ? "bg-red-600 text-white shadow-sm ring-2 ring-red-600/30"
                  : "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
              }`}
              title="Click to view employees requiring review, verification, or approvals"
            >
              <span className="size-2 rounded-full bg-red-500 animate-pulse" />
              <span>{attentionCount} Needs HR Attention</span>
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage employees, reporting relationships, onboarding and verification.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {/* Segmented View Mode Toggle: TABLE VIEW | ORGANIZATION CHART */}
        <div
          role="radiogroup"
          aria-label="Workforce View Mode"
          className="inline-flex items-center rounded-lg border border-border bg-muted/60 p-1 text-xs"
        >
          <button
            type="button"
            role="radio"
            aria-checked={viewMode === "table"}
            onClick={() => onViewModeChange("table")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              viewMode === "table"
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid className="size-3.5" aria-hidden="true" />
            <span>Table View</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={viewMode === "chart"}
            onClick={() => onViewModeChange("chart")}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              viewMode === "chart"
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Network className="size-3.5" aria-hidden="true" />
            <span>Organization Chart</span>
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {canExport && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onExport}
              className="h-9 gap-1.5 text-xs"
              title="Export visible directory to CSV"
            >
              <Download className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          )}

          {canImport && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-xs"
            >
              <Link to="/roster-import">
                <FileSpreadsheet className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Import Employees</span>
              </Link>
            </Button>
          )}

          {canCreateEmployee && (
            <Button
              asChild
              size="sm"
              className="h-9 gap-1.5 bg-red-600 text-xs font-medium text-white hover:bg-red-700 shadow-xs"
            >
              <Link to="/roster-import" search={{ mode: "single" }}>
                <UserPlus className="size-3.5" aria-hidden="true" />
                <span>Add Employee</span>
              </Link>
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
            aria-label="Refresh workforce data"
            title="Refresh workforce directory"
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
