"use client";

import { useMemo } from "react";
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  Coffee,
  MoreHorizontal,
  Eye,
  FileText,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import type { OversightRow } from "@/lib/oversight.server";
import { formatMinutesHuman } from "@/lib/attendance/attendance-monitoring";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function formatIstTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "—";
  }
}

function getInitials(name: string): string {
  if (!name) return "TAS";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "T";
  const last = parts[parts.length - 1] ?? first;
  if (parts.length <= 1) return first.slice(0, 2).toUpperCase();
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

function renderArrivalBadge(row: OversightRow) {
  switch (row.arrivalStatus) {
    case "on_time":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400">
          <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
          On Time
        </span>
      );
    case "late":
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
                <AlertTriangle className="size-3 text-amber-600 dark:text-amber-400" />
                Late ({row.minutesLate}m)
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Official deadline: 10:00 AM IST</p>
              <p>Logged in: {formatIstTime(row.checkInAt)}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case "missing_check_in":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400">
          <AlertCircle className="size-3 text-rose-600 dark:text-rose-400" />
          Missing Check-In
        </span>
      );
    case "on_leave":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-400">
          On Leave
        </span>
      );
    case "holiday":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-400">
          Holiday
        </span>
      );
    case "weekly_off":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Weekly Off
        </span>
      );
    case "not_checked_in":
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          Not Checked In
        </span>
      );
  }
}

function renderBreakStatusBadge(row: OversightRow) {
  if (row.hasActiveBreak) {
    if (row.hasOverdueBreak) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 animate-pulse dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400">
          <AlertTriangle className="size-3 text-rose-600 dark:text-rose-400" />
          Overdue Break
        </span>
      );
    }
    const label =
      row.breakStatus === "on_lunch"
        ? "On Lunch"
        : row.breakStatus === "on_short_break"
          ? "On Short Break"
          : "On Break";
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400">
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"></span>
          <span className="relative inline-flex size-2 rounded-full bg-blue-600"></span>
        </span>
        {label}
      </span>
    );
  }

  if (row.breakStatus === "late_return" || row.breakOvertimeMinutes > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
        Late Return (+{row.breakOvertimeMinutes}m)
      </span>
    );
  }

  if (row.breaks.length > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400">
        <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
        Completed
      </span>
    );
  }

  return <span className="text-xs text-muted-foreground">—</span>;
}

export function AttendanceMonitoringTable({
  rows,
  onSelectEmployee,
  selectedDayId,
  onReviewEod,
}: {
  rows: OversightRow[];
  onSelectEmployee: (row: OversightRow) => void;
  selectedDayId?: string | null | undefined;
  onReviewEod?: ((row: OversightRow) => void) | undefined;
}) {
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      // Sort priority: active break first, then late, then on time, then missing check-in
      if (a.hasActiveBreak && !b.hasActiveBreak) return -1;
      if (!a.hasActiveBreak && b.hasActiveBreak) return 1;
      if (a.arrivalStatus === "late" && b.arrivalStatus !== "late") return -1;
      if (a.arrivalStatus !== "late" && b.arrivalStatus === "late") return 1;
      return a.fullName.localeCompare(b.fullName);
    });
  }, [rows]);

  if (sortedRows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
        <Clock className="size-10 text-muted-foreground/50 mb-3" />
        <h3 className="font-medium text-base text-foreground">No records match your filters</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
          Try expanding your date range, clearing search terms or resetting department and status
          filters.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Mobile Card Layout */}
      <div className="space-y-3 md:hidden">
        {sortedRows.map((row) => {
          const isSelected = selectedDayId === row.dayId;
          return (
            <div
              key={row.dayId}
              onClick={() => onSelectEmployee(row)}
              className={`rounded-lg border p-4 transition-colors cursor-pointer bg-card shadow-sm ${
                isSelected
                  ? "border-primary ring-1 ring-primary/30 bg-primary/5"
                  : "hover:bg-muted/40"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                    {getInitials(row.fullName)}
                  </div>
                  <div>
                    <p className="font-medium text-sm text-foreground">{row.fullName}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.employeeCode || "TAS-EMP"} · {row.departmentName || "General"}
                    </p>
                  </div>
                </div>
                {renderArrivalBadge(row)}
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t text-xs">
                <div>
                  <span className="text-muted-foreground block">Check-In</span>
                  <span className="font-medium text-foreground">
                    {formatIstTime(row.checkInAt)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Check-Out</span>
                  <span className="font-medium text-foreground">
                    {row.checkOutAt ? (
                      formatIstTime(row.checkOutAt)
                    ) : row.checkInAt ? (
                      <span className="text-blue-600 font-medium">Still Working</span>
                    ) : (
                      "—"
                    )}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Worked Duration</span>
                  <span className="font-medium text-foreground">
                    {formatMinutesHuman(row.metrics.workedMinutes)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Break Status</span>
                  {renderBreakStatusBadge(row)}
                </div>
              </div>

              {row.breakOvertimeMinutes > 0 && (
                <div className="mt-2.5 flex items-center gap-1.5 rounded bg-amber-50 dark:bg-amber-950/40 p-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  <span>Break Overtime: +{row.breakOvertimeMinutes} mins</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop Enterprise Table Layout */}
      <div className="hidden md:block rounded-lg border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b bg-muted/40 text-xs font-medium text-muted-foreground">
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-3">Dept & Role</th>
                <th className="py-3 px-3">Check-In (IST)</th>
                <th className="py-3 px-3">Arrival Status</th>
                <th className="py-3 px-3">Check-Out (IST)</th>
                <th className="py-3 px-3">Worked Hours</th>
                <th className="py-3 px-3">Break Status</th>
                <th className="py-3 px-3">Overtime</th>
                <th className="py-3 px-3">EOD</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedRows.map((row) => {
                const isSelected = selectedDayId === row.dayId;
                return (
                  <tr
                    key={row.dayId}
                    onClick={() => onSelectEmployee(row)}
                    className={`transition-colors cursor-pointer group ${
                      isSelected
                        ? "bg-primary/5 font-medium"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    {/* Employee info */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                          {getInitials(row.fullName)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate max-w-[180px]">
                            {row.fullName}
                          </p>
                          <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                            {row.employeeCode ? (
                              <span className="font-mono text-muted-foreground/90 font-medium">
                                {row.employeeCode}
                              </span>
                            ) : null}
                            {row.employeeCode && row.workEmail ? " · " : ""}
                            {row.workEmail ? (
                              <span className="truncate">{row.workEmail}</span>
                            ) : null}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Department & Role */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-foreground">
                          {row.departmentName || "Operations"}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">
                            {row.role.replace(/_/g, " ")}
                          </Badge>
                          {row.workType === "annotation" ? (
                            <span className="text-[10px] text-muted-foreground">Annotation</span>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    {/* Check-In */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span className="font-mono text-xs font-medium text-foreground">
                        {formatIstTime(row.checkInAt)}
                      </span>
                    </td>

                    {/* Arrival Status */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      {renderArrivalBadge(row)}
                    </td>

                    {/* Check-Out */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      {row.checkOutAt ? (
                        <span className="font-mono text-xs font-medium text-foreground">
                          {formatIstTime(row.checkOutAt)}
                        </span>
                      ) : row.checkInAt ? (
                        <span className="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                          Still Working
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Worked Duration */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span className="font-medium tabular-nums text-xs text-foreground">
                        {formatMinutesHuman(row.metrics.workedMinutes)}
                      </span>
                    </td>

                    {/* Break Status */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      {renderBreakStatusBadge(row)}
                    </td>

                    {/* Break Overtime */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      {row.breakOvertimeMinutes > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="size-3" />
                          +{row.breakOvertimeMinutes}m
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* EOD status */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      {row.eodStatus ? (
                        <Badge
                          variant="secondary"
                          className="text-[10px] capitalize font-medium"
                        >
                          {row.eodStatus.replace(/_/g, " ")}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Pending</span>
                      )}
                    </td>

                    {/* Row Actions */}
                    <td
                      className="py-3 px-4 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2.5 text-xs gap-1.5"
                          onClick={() => onSelectEmployee(row)}
                        >
                          <Eye className="size-3.5" />
                          Details
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="size-8 p-0"
                              aria-label="More actions"
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => onSelectEmployee(row)}>
                              <Eye className="size-4 mr-2" />
                              View Timeline & Breaks
                            </DropdownMenuItem>
                            {row.eodReport && onReviewEod ? (
                              <DropdownMenuItem onClick={() => onReviewEod(row)}>
                                <FileText className="size-4 mr-2" />
                                Review EOD Report
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
