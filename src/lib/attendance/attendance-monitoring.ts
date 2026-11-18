/**
 * The AI School HRM — Attendance & Break Monitoring Engine
 * Domain rules, punctuality classification (10:00 AM IST deadline),
 * break compliance evaluations, and timeline generation.
 */

import { getIstWallClock, LUNCH_WINDOW, SHORT_BREAK_WINDOW } from "../breaks/break-management";

export type ArrivalStatus =
  | "on_time"
  | "late"
  | "not_checked_in"
  | "missing_check_in"
  | "on_leave"
  | "holiday"
  | "weekly_off";

export type BreakComplianceStatus =
  | "not_started"
  | "on_lunch"
  | "on_short_break"
  | "on_personalized_break"
  | "completed_on_time"
  | "late_return"
  | "overdue"
  | "legacy";

export type BreakSummaryItem = {
  id: string;
  category: "lunch" | "short_break" | "personal";
  startedAt: string;
  endedAt: string | null;
  expectedEndAt: string | null;
  allowedMinutes: number;
  durationMinutes: number;
  overtimeMinutes: number;
  returnStatus: "on_time" | "late_return" | "active" | "overdue" | "legacy";
  approvedMinutes?: number | null | undefined;
  reason?: string | null | undefined;
  decisionStatus?: string | null | undefined;
  isLegacy?: boolean | undefined;
};

export type AttendanceTimelineEvent = {
  id: string;
  timeIso: string;
  displayTime: string;
  title: string;
  subtitle?: string | undefined;
  type: "check_in" | "check_out" | "lunch" | "short_break" | "personal_break";
  status: "on_time" | "late" | "active" | "overdue" | "normal";
  badgeText?: string | undefined;
  overtimeText?: string | undefined;
  note?: string | undefined;
};

/**
 * Evaluates morning check-in punctuality against the official 10:00:00 AM IST deadline.
 */
export function evaluateMorningPunctuality(
  checkInAt: string | null,
  workDate: string,
  now: Date = new Date(),
  exceptionType: string = "none",
): {
  arrivalStatus: ArrivalStatus;
  minutesLate: number;
  scheduledTimeIst: string;
  displayLabel: string;
} {
  const scheduledTimeIst = "10:00 AM IST";

  if (exceptionType === "leave") {
    return { arrivalStatus: "on_leave", minutesLate: 0, scheduledTimeIst, displayLabel: "Approved Leave" };
  }
  if (exceptionType === "holiday") {
    return { arrivalStatus: "holiday", minutesLate: 0, scheduledTimeIst, displayLabel: "Holiday" };
  }
  if (exceptionType === "weekly_off") {
    return { arrivalStatus: "weekly_off", minutesLate: 0, scheduledTimeIst, displayLabel: "Weekly Off" };
  }

  const ist = getIstWallClock(now);
  const isPastDate = workDate < ist.workDate;
  const isToday = workDate === ist.workDate;

  if (!checkInAt) {
    if (isPastDate) {
      return { arrivalStatus: "missing_check_in", minutesLate: 0, scheduledTimeIst, displayLabel: "Missing Check-In" };
    }
    if (isToday) {
      // 10:00:00 AM IST is 10 * 3600 = 36,000 seconds
      if (ist.totalSecondsFromMidnight < 36000) {
        return { arrivalStatus: "not_checked_in", minutesLate: 0, scheduledTimeIst, displayLabel: "Not Checked In" };
      }
      return { arrivalStatus: "missing_check_in", minutesLate: 0, scheduledTimeIst, displayLabel: "Missing Check-In" };
    }
    return { arrivalStatus: "not_checked_in", minutesLate: 0, scheduledTimeIst, displayLabel: "Upcoming" };
  }

  // Check-in timestamp evaluation
  const checkInDate = new Date(checkInAt);
  const deadlineDate = new Date(`${workDate}T10:00:00+05:30`);
  const checkInMs = checkInDate.getTime();
  const deadlineMs = deadlineDate.getTime();

  if (checkInMs <= deadlineMs) {
    return {
      arrivalStatus: "on_time",
      minutesLate: 0,
      scheduledTimeIst,
      displayLabel: "On Time",
    };
  }

  const diffMs = checkInMs - deadlineMs;
  const minutesLate = Math.ceil(diffMs / 60_000);

  return {
    arrivalStatus: "late",
    minutesLate,
    scheduledTimeIst,
    displayLabel: `Late (${minutesLate}m)`,
  };
}

/**
 * Evaluates an employee's breaks for a specific work date.
 */
export function evaluateBreakCompliance(
  breaks: Array<{
    id: string;
    category: string;
    started_at: string;
    ended_at: string | null;
    expected_end_at?: string | null;
    allowed_minutes?: number | null;
    overtime_seconds?: number | null;
    return_status?: string | null;
    is_legacy?: boolean | null;
    break_requests?: {
      requested_minutes: number;
      approved_minutes: number | null;
      reason: string;
      status: string;
    } | null;
  }>,
  workDate: string,
  now: Date = new Date(),
): {
  breakStatus: BreakComplianceStatus;
  lunchBreak: BreakSummaryItem | null;
  shortBreak: BreakSummaryItem | null;
  personalizedBreaks: BreakSummaryItem[];
  totalBreakOvertimeMinutes: number;
  openBreak: BreakSummaryItem | null;
} {
  const nowMs = now.getTime();
  let totalBreakOvertimeMinutes = 0;
  let openBreak: BreakSummaryItem | null = null;

  let lunchBreak: BreakSummaryItem | null = null;
  let shortBreak: BreakSummaryItem | null = null;
  const personalizedBreaks: BreakSummaryItem[] = [];

  for (const b of breaks) {
    const sMs = new Date(b.started_at).getTime();
    const isEnded = Boolean(b.ended_at);
    const endMs = isEnded ? new Date(b.ended_at!).getTime() : nowMs;

    let expectedEndMs: number;
    let allowedMinutes: number;

    if (b.category === "lunch") {
      allowedMinutes = LUNCH_WINDOW.durationMinutes;
      expectedEndMs = b.expected_end_at
        ? new Date(b.expected_end_at).getTime()
        : new Date(`${workDate}T14:30:00+05:30`).getTime();
    } else if (b.category === "short_break") {
      allowedMinutes = SHORT_BREAK_WINDOW.durationMinutes;
      expectedEndMs = b.expected_end_at
        ? new Date(b.expected_end_at).getTime()
        : new Date(`${workDate}T17:00:00+05:30`).getTime();
    } else {
      allowedMinutes = b.allowed_minutes || b.break_requests?.approved_minutes || 30;
      expectedEndMs = b.expected_end_at
        ? new Date(b.expected_end_at).getTime()
        : sMs + allowedMinutes * 60_000;
    }

    const durationMinutes = Math.max(0, Math.trunc((endMs - sMs) / 60_000));
    let overtimeMinutes = 0;
    let returnStatus: BreakSummaryItem["returnStatus"] = "on_time";

    if (b.is_legacy) {
      returnStatus = "legacy";
    } else if (isEnded) {
      if (endMs > expectedEndMs) {
        returnStatus = "late_return";
        overtimeMinutes = Math.ceil((endMs - expectedEndMs) / 60_000);
      } else {
        returnStatus = "on_time";
      }
    } else {
      // Active break
      if (nowMs > expectedEndMs) {
        returnStatus = "overdue";
        overtimeMinutes = Math.ceil((nowMs - expectedEndMs) / 60_000);
      } else {
        returnStatus = "active";
      }
    }

    totalBreakOvertimeMinutes += overtimeMinutes;

    const item: BreakSummaryItem = {
      id: b.id,
      category: b.category as any,
      startedAt: b.started_at,
      endedAt: b.ended_at,
      expectedEndAt: b.expected_end_at || new Date(expectedEndMs).toISOString(),
      allowedMinutes,
      durationMinutes,
      overtimeMinutes,
      returnStatus,
      approvedMinutes: b.break_requests?.approved_minutes,
      reason: b.break_requests?.reason,
      decisionStatus: b.break_requests?.status,
      isLegacy: Boolean(b.is_legacy),
    };

    if (!isEnded && !openBreak) {
      openBreak = item;
    }

    if (b.category === "lunch" && !lunchBreak) {
      lunchBreak = item;
    } else if (b.category === "short_break" && !shortBreak) {
      shortBreak = item;
    } else {
      personalizedBreaks.push(item);
    }
  }

  // Derive high-level break status
  let breakStatus: BreakComplianceStatus = "not_started";

  if (openBreak) {
    if (openBreak.returnStatus === "overdue") {
      breakStatus = "overdue";
    } else if (openBreak.category === "lunch") {
      breakStatus = "on_lunch";
    } else if (openBreak.category === "short_break") {
      breakStatus = "on_short_break";
    } else {
      breakStatus = "on_personalized_break";
    }
  } else if (breaks.length > 0) {
    const hasLate = [lunchBreak, shortBreak, ...personalizedBreaks].some(
      (b) => b && b.returnStatus === "late_return",
    );
    breakStatus = hasLate ? "late_return" : "completed_on_time";
  }

  return {
    breakStatus,
    lunchBreak,
    shortBreak,
    personalizedBreaks,
    totalBreakOvertimeMinutes,
    openBreak,
  };
}

/**
 * Builds a chronological timeline of verified database events for an employee's workday.
 */
export function buildAttendanceTimeline(params: {
  workDate: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  lateReason?: string | null;
  minutesLate: number;
  arrivalStatus: ArrivalStatus;
  breaks: BreakSummaryItem[];
}): AttendanceTimelineEvent[] {
  const events: AttendanceTimelineEvent[] = [];

  const timeFmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

  if (params.checkInAt) {
    events.push({
      id: "check_in",
      timeIso: params.checkInAt,
      displayTime: timeFmt(params.checkInAt),
      title: "Checked In",
      subtitle:
        params.arrivalStatus === "late"
          ? `Late by ${params.minutesLate} mins${params.lateReason ? ` · “${params.lateReason}”` : ""}`
          : "On Time (Official start 10:00 AM IST)",
      type: "check_in",
      status: params.arrivalStatus === "late" ? "late" : "on_time",
      badgeText: params.arrivalStatus === "late" ? `Late (${params.minutesLate}m)` : "On Time",
      note: params.lateReason || undefined,
    });
  }

  for (const b of params.breaks) {
    const isLunch = b.category === "lunch";
    const isShort = b.category === "short_break";
    const label = isLunch ? "Lunch Break" : isShort ? "Short Break" : "Personalized Break";

    events.push({
      id: `${b.id}-start`,
      timeIso: b.startedAt,
      displayTime: timeFmt(b.startedAt),
      title: `${label} Started`,
      subtitle: b.expectedEndAt
        ? `Scheduled Return: ${timeFmt(b.expectedEndAt)} IST`
        : undefined,
      type: isLunch ? "lunch" : isShort ? "short_break" : "personal_break",
      status: "normal",
      badgeText: `${b.allowedMinutes}m Allowed`,
    });

    if (b.endedAt) {
      const isLate = b.returnStatus === "late_return";
      events.push({
        id: `${b.id}-end`,
        timeIso: b.endedAt,
        displayTime: timeFmt(b.endedAt),
        title: `${label} Ended`,
        subtitle: isLate
          ? `Returned late by ${b.overtimeMinutes} mins (Duration: ${b.durationMinutes}m)`
          : `Returned on time (Duration: ${b.durationMinutes}m)`,
        type: isLunch ? "lunch" : isShort ? "short_break" : "personal_break",
        status: isLate ? "late" : "on_time",
        badgeText: isLate ? `Overrun +${b.overtimeMinutes}m` : "On Time",
        overtimeText: isLate ? `${b.overtimeMinutes}m overtime` : undefined,
      });
    } else {
      // Active break
      const isOverdue = b.returnStatus === "overdue";
      events.push({
        id: `${b.id}-active`,
        timeIso: new Date().toISOString(),
        displayTime: "Now",
        title: `${label} in Progress`,
        subtitle: isOverdue
          ? `Overdue by ${b.overtimeMinutes} mins! Expected return was ${b.expectedEndAt ? timeFmt(b.expectedEndAt) : "earlier"}`
          : `Expected return: ${b.expectedEndAt ? timeFmt(b.expectedEndAt) : "2:30 PM IST"}`,
        type: isLunch ? "lunch" : isShort ? "short_break" : "personal_break",
        status: isOverdue ? "overdue" : "active",
        badgeText: isOverdue ? `Overdue (+${b.overtimeMinutes}m)` : "Active Break",
      });
    }
  }

  if (params.checkOutAt) {
    events.push({
      id: "check_out",
      timeIso: params.checkOutAt,
      displayTime: timeFmt(params.checkOutAt),
      title: "Checked Out",
      subtitle: "Shift completed for today",
      type: "check_out",
      status: "on_time",
      badgeText: "Completed",
    });
  }

  return events.sort((a, b) => new Date(a.timeIso).getTime() - new Date(b.timeIso).getTime());
}

/**
 * Human-readable duration formatter (e.g. 340 -> "5h 40m", 15 -> "15m", 0 -> "0m").
 */
export function formatMinutesHuman(minutes: number): string {
  if (!minutes || minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
