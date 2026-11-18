"use client";

import { useState } from "react";
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  Coffee,
  FileText,
  ShieldAlert,
  MapPin,
  Calendar,
  User,
  ArrowRight,
  AlertCircle,
  MessageSquare,
  Check,
} from "lucide-react";
import type { OversightRow } from "@/lib/oversight.server";
import { formatMinutesHuman } from "@/lib/attendance/attendance-monitoring";
import { REVIEW_ACTION_LABELS, optionsOf } from "@/lib/enums";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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

const ACTION_OPTIONS = optionsOf(REVIEW_ACTION_LABELS);
const HIGH_IMPACT_ACTIONS = new Set(["escalated", "performance_concern"]);

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

function formatIstDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function EmployeeAttendanceDrawer({
  row,
  isOpen,
  onClose,
  canReviewEod,
  canManageBlockers,
  onReviewEodReport,
  onResolveBlocker,
  reviewEvents = [],
  isEventsLoading = false,
}: {
  row: OversightRow | null;
  isOpen: boolean;
  onClose: () => void;
  canReviewEod: boolean;
  canManageBlockers: boolean;
  onReviewEodReport: (id: string, action: string, note: string) => Promise<void>;
  onResolveBlocker: (id: string, note: string) => Promise<void>;
  reviewEvents?: Array<{
    id: string;
    action: string;
    note: string | null;
    created_at: string;
    profiles?: { full_name?: string } | null;
  }>;
  isEventsLoading?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<string>("timeline");
  const [eodAction, setEodAction] = useState<string>("approved");
  const [eodNote, setEodNote] = useState<string>("");
  const [isSubmittingEod, setIsSubmittingEod] = useState<boolean>(false);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);

  const [resolvingBlockerId, setResolvingBlockerId] = useState<string | null>(null);
  const [blockerNote, setBlockerNote] = useState<string>("");
  const [isResolvingBlocker, setIsResolvingBlocker] = useState<boolean>(false);

  if (!row) return null;

  async function handleEodSubmit() {
    if (!row?.eodReport) return;
    if (HIGH_IMPACT_ACTIONS.has(eodAction) && !showConfirmModal) {
      setShowConfirmModal(true);
      return;
    }

    setIsSubmittingEod(true);
    try {
      await onReviewEodReport(row.eodReport.id, eodAction, eodNote);
      setEodNote("");
      setShowConfirmModal(false);
    } finally {
      setIsSubmittingEod(false);
    }
  }

  async function handleBlockerResolve(blockerId: string) {
    setIsResolvingBlocker(true);
    try {
      await onResolveBlocker(blockerId, blockerNote);
      setResolvingBlockerId(null);
      setBlockerNote("");
    } finally {
      setIsResolvingBlocker(false);
    }
  }

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="w-full sm:max-w-xl md:max-w-2xl overflow-y-auto p-0">
          {/* Drawer Header */}
          <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm p-6 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-foreground tracking-tight">
                    {row.fullName}
                  </h2>
                  {row.employeeCode && (
                    <Badge variant="outline" className="font-mono text-xs font-semibold">
                      {row.employeeCode}
                    </Badge>
                  )}
                  <Badge variant="secondary" className="capitalize text-xs">
                    {row.role.replace(/_/g, " ")}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <span>{row.workEmail || "No work email"}</span>
                  <span>·</span>
                  <span>{row.departmentName || "Operations"}</span>
                  <span>·</span>
                  <span className="capitalize">{row.workType}</span>
                </p>
              </div>
            </div>

            {/* Sub-header status bar */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-2.5 text-xs">
              <div className="flex items-center gap-2">
                <Calendar className="size-3.5 text-muted-foreground" />
                <span className="font-medium text-foreground">{formatIstDate(row.workDate)}</span>
              </div>
              <div className="flex items-center gap-2">
                {row.arrivalStatus === "on_time" ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                    <CheckCircle2 className="size-3.5" />
                    On Time ({formatIstTime(row.checkInAt)})
                  </span>
                ) : row.arrivalStatus === "late" ? (
                  <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                    <AlertTriangle className="size-3.5" />
                    Late by {row.minutesLate}m ({formatIstTime(row.checkInAt)})
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-rose-600 font-medium">
                    <AlertCircle className="size-3.5" />
                    Missing Check-In
                  </span>
                )}
                <span>·</span>
                <span className="font-medium text-foreground">
                  Worked {formatMinutesHuman(row.metrics.workedMinutes)}
                </span>
              </div>
            </div>

            {/* Navigation Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="timeline" className="text-xs">
                  Timeline
                </TabsTrigger>
                <TabsTrigger value="summary" className="text-xs">
                  Summary
                </TabsTrigger>
                <TabsTrigger value="breaks" className="text-xs">
                  Breaks ({row.breaks.length})
                </TabsTrigger>
                <TabsTrigger value="eod" className="text-xs">
                  EOD & Review
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Drawer Body Content */}
          <div className="p-6 pt-2">
            {/* TAB 1: TIMELINE */}
            {activeTab === "timeline" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Chronological Verified Workday Events
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Official company timeline anchored to 10:00 AM IST check-in and scheduled breaks.
                  </p>
                </div>

                {row.timeline.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                    No verified attendance events recorded for this work date.
                  </div>
                ) : (
                  <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                    {row.timeline.map((event) => {
                      const isCheckIn = event.type === "check_in";
                      const isCheckOut = event.type === "check_out";
                      const isBreak =
                        event.type === "lunch" ||
                        event.type === "short_break" ||
                        event.type === "personal_break";
                      const isLate = event.status === "late" || event.status === "overdue";

                      return (
                        <div key={event.id} className="relative group">
                          {/* Timeline dot */}
                          <div
                            className={`absolute -left-6 top-1 flex size-5 items-center justify-center rounded-full border-2 bg-background ${
                              isLate
                                ? "border-amber-500 text-amber-600"
                                : isCheckIn || isCheckOut
                                  ? "border-emerald-500 text-emerald-600"
                                  : "border-blue-500 text-blue-600"
                            }`}
                          >
                            <span className="size-1.5 rounded-full bg-current" />
                          </div>

                          {/* Event content card */}
                          <div className="rounded-lg border bg-card p-3 shadow-2xs space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-xs text-foreground">
                                {event.title}
                              </span>
                              <span className="font-mono text-xs text-muted-foreground">
                                {event.displayTime}
                              </span>
                            </div>

                            {event.subtitle && (
                              <p className="text-xs text-muted-foreground">{event.subtitle}</p>
                            )}

                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              {event.badgeText && (
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${
                                    isLate
                                      ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
                                      : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400"
                                  }`}
                                >
                                  {event.badgeText}
                                </Badge>
                              )}

                              {event.overtimeText && (
                                <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                  <AlertTriangle className="size-3" />
                                  {event.overtimeText}
                                </span>
                              )}
                            </div>

                            {event.note && (
                              <p className="text-xs italic text-muted-foreground bg-muted/40 p-1.5 rounded mt-1">
                                Note: “{event.note}”
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: SUMMARY */}
            {activeTab === "summary" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3 bg-muted/20">
                    <span className="text-xs text-muted-foreground block">First Check-In</span>
                    <span className="text-sm font-semibold text-foreground mt-0.5 block">
                      {formatIstTime(row.checkInAt)}
                    </span>
                    <span className="text-[10px] text-muted-foreground mt-1 block">
                      Scheduled: 10:00 AM IST
                    </span>
                  </div>

                  <div className="rounded-lg border p-3 bg-muted/20">
                    <span className="text-xs text-muted-foreground block">Final Check-Out</span>
                    <span className="text-sm font-semibold text-foreground mt-0.5 block">
                      {row.checkOutAt ? (
                        formatIstTime(row.checkOutAt)
                      ) : row.checkInAt ? (
                        <span className="text-blue-600 font-medium">Still Working</span>
                      ) : (
                        "—"
                      )}
                    </span>
                    <span className="text-[10px] text-muted-foreground mt-1 block">
                      Work Mode: {row.workMode.replace(/_/g, " ")}
                    </span>
                  </div>

                  <div className="rounded-lg border p-3 bg-muted/20">
                    <span className="text-xs text-muted-foreground block">Total Worked Time</span>
                    <span className="text-sm font-semibold text-foreground mt-0.5 block">
                      {formatMinutesHuman(row.metrics.workedMinutes)}
                    </span>
                    <span className="text-[10px] text-muted-foreground mt-1 block">
                      Required: {formatMinutesHuman(row.requiredMinutes || 480)}
                    </span>
                  </div>

                  <div className="rounded-lg border p-3 bg-muted/20">
                    <span className="text-xs text-muted-foreground block">Break Time & Overtime</span>
                    <span className="text-sm font-semibold text-foreground mt-0.5 block">
                      {formatMinutesHuman(row.totalBreakMinutes)}
                    </span>
                    <span className="text-[10px] text-muted-foreground mt-1 block">
                      {row.breakOvertimeMinutes > 0 ? (
                        <span className="text-amber-600 font-semibold">
                          +{row.breakOvertimeMinutes}m Overtime
                        </span>
                      ) : (
                        "Zero Overtime"
                      )}
                    </span>
                  </div>
                </div>

                {/* Office / Geolocation Verification */}
                <div className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <MapPin className="size-4 text-muted-foreground" />
                    <h4 className="text-xs font-semibold text-foreground">Location Verification</h4>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground block">Assigned Office</span>
                      <span className="font-medium text-foreground">
                        {row.officeName || "Primary Hub"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Geo Status</span>
                      <span className="font-medium text-foreground capitalize">
                        {row.locationStatus.replace(/_/g, " ")}
                      </span>
                    </div>
                    {row.locationDistanceM != null && (
                      <div>
                        <span className="text-muted-foreground block">Distance to Office</span>
                        <span className="font-medium text-foreground">
                          {row.locationDistanceM} meters
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Targets & Production metrics (For Annotation Staff) */}
                {row.workType === "annotation" && (
                  <div className="rounded-lg border p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <FileText className="size-4 text-muted-foreground" />
                      <h4 className="text-xs font-semibold text-foreground">
                        Annotation Production Targets
                      </h4>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground block">Project</span>
                        <span className="font-medium text-foreground">
                          {row.projectCode || "Unassigned"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Units Completed</span>
                        <span className="font-medium text-foreground">
                          {row.achievement.unitsCompleted}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Target Achievement</span>
                        <span className="font-medium text-foreground">
                          {row.achievement.dailyAchievementPct != null
                            ? `${row.achievement.dailyAchievementPct}%`
                            : "—"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: BREAKS BREAKDOWN */}
            {activeTab === "breaks" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Standard & Personalized Daily Breaks
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Strict break schedule: Lunch (1:30–2:30 PM), Short (4:45–5:00 PM), and HR-approved personal breaks.
                  </p>
                </div>

                {/* Lunch Break Card */}
                <div className="rounded-lg border p-4 space-y-2 bg-card">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Coffee className="size-4 text-primary" />
                      <h4 className="text-xs font-semibold text-foreground">Lunch Break</h4>
                    </div>
                    {row.lunchBreak ? (
                      row.lunchBreak.returnStatus === "late_return" ? (
                        <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50">
                          Late Return (+{row.lunchBreak.overtimeMinutes}m)
                        </Badge>
                      ) : row.lunchBreak.returnStatus === "active" ? (
                        <Badge variant="default" className="bg-blue-600">
                          Currently Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50">
                          Completed On Time
                        </Badge>
                      )
                    ) : (
                      <Badge variant="secondary" className="text-muted-foreground">
                        Not Taken
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Policy window: 1:30 PM – 2:30 PM IST (Max return deadline 2:30 PM)
                  </p>
                  {row.lunchBreak && (
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t text-xs">
                      <div>
                        <span className="text-muted-foreground block">Started</span>
                        <span className="font-medium text-foreground">
                          {formatIstTime(row.lunchBreak.startedAt)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Ended</span>
                        <span className="font-medium text-foreground">
                          {formatIstTime(row.lunchBreak.endedAt)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Duration</span>
                        <span className="font-medium text-foreground">
                          {row.lunchBreak.durationMinutes} mins
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Short Break Card */}
                <div className="rounded-lg border p-4 space-y-2 bg-card">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Coffee className="size-4 text-primary" />
                      <h4 className="text-xs font-semibold text-foreground">Short Break</h4>
                    </div>
                    {row.shortBreak ? (
                      row.shortBreak.returnStatus === "late_return" ? (
                        <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50">
                          Late Return (+{row.shortBreak.overtimeMinutes}m)
                        </Badge>
                      ) : row.shortBreak.returnStatus === "active" ? (
                        <Badge variant="default" className="bg-blue-600">
                          Currently Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50">
                          Completed On Time
                        </Badge>
                      )
                    ) : (
                      <Badge variant="secondary" className="text-muted-foreground">
                        Not Taken
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Policy window: 4:45 PM – 5:00 PM IST (Max return deadline 5:00 PM)
                  </p>
                  {row.shortBreak && (
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t text-xs">
                      <div>
                        <span className="text-muted-foreground block">Started</span>
                        <span className="font-medium text-foreground">
                          {formatIstTime(row.shortBreak.startedAt)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Ended</span>
                        <span className="font-medium text-foreground">
                          {formatIstTime(row.shortBreak.endedAt)}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Duration</span>
                        <span className="font-medium text-foreground">
                          {row.shortBreak.durationMinutes} mins
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Personalized Breaks List */}
                <div className="space-y-3 pt-2">
                  <h4 className="text-xs font-semibold text-foreground">Personalized Breaks</h4>
                  {row.personalizedBreaks.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      No personalized breaks requested or taken on this date.
                    </p>
                  ) : (
                    row.personalizedBreaks.map((pb, idx) => (
                      <div key={pb.id || idx} className="rounded-lg border p-3 bg-card space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-foreground">
                            Personal Break #{idx + 1}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {pb.returnStatus.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        {pb.reason && (
                          <p className="text-xs text-muted-foreground">Reason: “{pb.reason}”</p>
                        )}
                        <div className="grid grid-cols-3 gap-2 pt-2 border-t text-xs">
                          <div>
                            <span className="text-muted-foreground block">Started</span>
                            <span className="font-medium text-foreground">
                              {formatIstTime(pb.startedAt)}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">Ended</span>
                            <span className="font-medium text-foreground">
                              {formatIstTime(pb.endedAt)}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">Duration</span>
                            <span className="font-medium text-foreground">
                              {pb.durationMinutes}m ({pb.allowedMinutes}m allowed)
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: EOD REPORT & HR REVIEW */}
            {activeTab === "eod" && (
              <div className="space-y-5">
                {row.eodReport ? (
                  <div className="space-y-4">
                    {/* EOD Report Contents */}
                    <div className="rounded-lg border p-4 space-y-3 bg-card">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold text-foreground">
                          Submitted End of Day Report
                        </h4>
                        <Badge variant="secondary" className="capitalize text-xs">
                          {row.eodReport.status.replace(/_/g, " ")}
                        </Badge>
                      </div>

                      {row.eodReport.highlights && (
                        <div className="space-y-1">
                          <span className="text-[11px] font-semibold text-muted-foreground uppercase">
                            Key Highlights / Completed Tasks
                          </span>
                          <p className="text-xs text-foreground bg-muted/30 p-2.5 rounded-md whitespace-pre-wrap">
                            {row.eodReport.highlights}
                          </p>
                        </div>
                      )}

                      {row.eodReport.challenges && (
                        <div className="space-y-1">
                          <span className="text-[11px] font-semibold text-muted-foreground uppercase">
                            Challenges & Blockers
                          </span>
                          <p className="text-xs text-foreground bg-muted/30 p-2.5 rounded-md whitespace-pre-wrap">
                            {row.eodReport.challenges}
                          </p>
                        </div>
                      )}

                      {row.eodReport.tomorrowPlan && (
                        <div className="space-y-1">
                          <span className="text-[11px] font-semibold text-muted-foreground uppercase">
                            Plan For Tomorrow
                          </span>
                          <p className="text-xs text-foreground bg-muted/30 p-2.5 rounded-md whitespace-pre-wrap">
                            {row.eodReport.tomorrowPlan}
                          </p>
                        </div>
                      )}

                      {row.eodReport.supportNeeded && (
                        <div className="space-y-1">
                          <span className="text-[11px] font-semibold text-muted-foreground uppercase">
                            Support Needed
                          </span>
                          <p className="text-xs text-foreground bg-muted/30 p-2.5 rounded-md whitespace-pre-wrap">
                            {row.eodReport.supportNeeded}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* HR Review Action Panel */}
                    {canReviewEod ? (
                      <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
                        <h4 className="text-xs font-semibold text-foreground">
                          HR & Supervisor Review Decision
                        </h4>
                        <div className="space-y-2">
                          <Label htmlFor="drawer-eod-action" className="text-xs text-muted-foreground">
                            Select Review Action
                          </Label>
                          <select
                            id="drawer-eod-action"
                            className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"
                            value={eodAction}
                            onChange={(e) => setEodAction(e.target.value)}
                          >
                            {ACTION_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="drawer-eod-note" className="text-xs text-muted-foreground">
                            Feedback / Reviewer Note
                          </Label>
                          <Textarea
                            id="drawer-eod-note"
                            className="text-xs resize-none"
                            rows={3}
                            placeholder="Provide constructive feedback, revision instructions, or escalation reasons..."
                            value={eodNote}
                            onChange={(e) => setEodNote(e.target.value)}
                          />
                        </div>

                        <Button
                          size="sm"
                          className="w-full text-xs font-semibold"
                          onClick={handleEodSubmit}
                          disabled={isSubmittingEod}
                        >
                          {isSubmittingEod ? "Recording Decision..." : "Submit Review Decision"}
                        </Button>
                      </div>
                    ) : null}

                    {/* Review History Audit Trail */}
                    <div className="space-y-2 pt-2">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                        Review History & Audit Trail
                      </h4>
                      {isEventsLoading ? (
                        <p className="text-xs text-muted-foreground">Loading audit log...</p>
                      ) : reviewEvents.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">
                          No prior review actions recorded for this employee.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {reviewEvents.map((evt) => (
                            <div key={evt.id} className="rounded border p-2.5 text-xs bg-card">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-foreground capitalize">
                                  {REVIEW_ACTION_LABELS[evt.action as never] ?? evt.action}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {formatIstDate(evt.created_at)}
                                </span>
                              </div>
                              <p className="text-muted-foreground text-[11px] mt-0.5">
                                Reviewed by: {evt.profiles?.full_name || "Supervisor"}
                              </p>
                              {evt.note && (
                                <p className="italic text-foreground mt-1 bg-muted/40 p-1.5 rounded">
                                  “{evt.note}”
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-8 text-center text-xs text-muted-foreground">
                    <FileText className="size-8 mx-auto text-muted-foreground/40 mb-2" />
                    <p className="font-medium text-foreground">No EOD report submitted</p>
                    <p className="mt-1">
                      The employee has not yet filed an End of Day report for this shift.
                    </p>
                  </div>
                )}

                {/* Team Blockers Section */}
                <div className="space-y-3 pt-3 border-t">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-foreground">
                      Reported Blockers ({row.blockers.length})
                    </h4>
                  </div>
                  {row.blockers.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      Zero operational blockers reported during this shift.
                    </p>
                  ) : (
                    row.blockers.map((b) => (
                      <div key={b.id} className="rounded-lg border p-3 text-xs bg-card space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold capitalize text-foreground">
                            {b.category.replace(/_/g, " ")} Blocker
                          </span>
                          <Badge
                            variant={b.status === "resolved" ? "secondary" : "destructive"}
                            className="text-[10px] capitalize"
                          >
                            {b.status}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground">{b.description}</p>
                        {b.resolutionNote && (
                          <p className="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 p-1.5 rounded text-[11px]">
                            Resolved: {b.resolutionNote}
                          </p>
                        )}
                        {b.status === "active" && canManageBlockers && (
                          <div className="pt-2 border-t space-y-2">
                            {resolvingBlockerId === b.id ? (
                              <div className="space-y-2">
                                <Label className="text-[11px] text-muted-foreground">
                                  Resolution Note
                                </Label>
                                <Textarea
                                  className="text-xs"
                                  rows={2}
                                  placeholder="Describe how the blocker was resolved..."
                                  value={blockerNote}
                                  onChange={(e) => setBlockerNote(e.target.value)}
                                />
                                <div className="flex justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs"
                                    onClick={() => setResolvingBlockerId(null)}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => handleBlockerResolve(b.id)}
                                    disabled={isResolvingBlocker}
                                  >
                                    {isResolvingBlocker ? "Resolving..." : "Confirm Resolution"}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs w-full"
                                onClick={() => setResolvingBlockerId(b.id)}
                              >
                                Resolve Blocker
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Confirmation Dialog for High Impact EOD actions */}
      <AlertDialog open={showConfirmModal} onOpenChange={setShowConfirmModal}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-destructive" />
              Confirm {REVIEW_ACTION_LABELS[eodAction as never] ?? eodAction}
            </AlertDialogTitle>
            <AlertDialogDescription>
              You are about to record a formal <strong>{REVIEW_ACTION_LABELS[eodAction as never]}</strong> for{" "}
              {row.fullName} on work date {row.workDate}. This action generates an official audit record and
              may affect employee compliance metrics.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmittingEod}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleEodSubmit}
              disabled={isSubmittingEod}
            >
              {isSubmittingEod ? "Recording..." : "Confirm Decision"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
