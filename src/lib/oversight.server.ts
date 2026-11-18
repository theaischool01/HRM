// Server-only oversight helpers. Every dashboard number and every export row
// is produced HERE, from the same Phase 3 primitives (attendance_day_metrics,
// derive_attendance_status, computeTargetAchievement) — so an export can never
// disagree with what a dashboard shows.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  computeTargetAchievement,
  EMPTY_METRICS,
  type DayMetrics,
  type TargetAchievement,
} from "./daily.server";
import { loadProfileNames, nameOf } from "./profile-names.server";
import { todayIso } from "./timezone";
import { excludeProtectedAccounts } from "./work-type";
import { loadProfileWorkTypes, loadProtectedAccountIds } from "./work-type.server";
import {
  evaluateMorningPunctuality,
  evaluateBreakCompliance,
  buildAttendanceTimeline,
  type ArrivalStatus,
  type BreakComplianceStatus,
  type BreakSummaryItem,
  type AttendanceTimelineEvent,
} from "./attendance/attendance-monitoring";

type Client = SupabaseClient<Database>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = (supabase: Client) => supabase as unknown as SupabaseClient<any>;

export type OversightEodReport = {
  id: string;
  highlights: string | null;
  challenges: string | null;
  tomorrowPlan: string | null;
  supportNeeded: string | null;
  status: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewerName: string | null;
  reviewNote: string | null;
};

export type OversightBlocker = {
  id: string;
  category: string;
  severity: string;
  description: string;
  status: string;
  resolutionNote: string | null;
  startedAt: string;
  resolvedAt: string | null;
  createdAt: string;
};

export type OversightRow = {
  dayId: string;
  userId: string;
  fullName: string;
  employeeCode: string | null;
  workEmail: string | null;
  departmentId: string | null;
  departmentName: string | null;
  role: string;
  workType: string;
  category: string;
  designation: string | null;
  workDate: string;
  workMode: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  requiredMinutes: number;
  status: string;
  // Morning punctuality
  arrivalStatus: ArrivalStatus;
  minutesLate: number;
  scheduledCheckInIst: string;
  displayArrivalStatus: string;
  // Breaks
  breaks: BreakSummaryItem[];
  breakStatus: BreakComplianceStatus;
  breakStatusSummary: string;
  totalBreakMinutes: number;
  breakOvertimeMinutes: number;
  hasActiveBreak: boolean;
  hasOverdueBreak: boolean;
  lunchBreak: BreakSummaryItem | null;
  shortBreak: BreakSummaryItem | null;
  personalizedBreaks: BreakSummaryItem[];
  // Timeline
  timeline: AttendanceTimelineEvent[];
  // Metrics & Targets
  metrics: DayMetrics;
  achievement: TargetAchievement;
  projectCode: string | null;
  eodStatus: string | null;
  eodReport: OversightEodReport | null;
  blockers: OversightBlocker[];
  locationStatus: string;
  locationDistanceM: number | null;
  locationAccuracyM: number | null;
  locationLatitude: number | null;
  locationLongitude: number | null;
  officeName: string | null;
};

export type OversightFilter = {
  from: string;
  to: string;
  userId?: string | null;
  projectId?: string | null;
};

export type WorkforceSummary = {
  // 8 Workforce KPI metrics
  expectedTotal: number;
  checkedInCount: number;
  onTimeArrivals: number;
  lateArrivals: number;
  currentlyOnBreak: number;
  overdueBreaks: number;
  checkedOutCount: number;
  missingCheckIns: number;
  // Aggregated hours and numbers
  days: number;
  people: number;
  workedHours: number;
  uncoveredMinutes: number;
  unitsCompleted: number;
  avgAchievementPct: number | null;
  byStatus: Record<string, number>;
  problemDays: number;
};

type Interval = { st: number; en: number };

export function computeDayMetricsInMemory(
  day: { check_in_at: string | null; check_out_at: string | null; work_date: string },
  entries: {
    started_at: string;
    ended_at: string;
    units_completed: number;
    status: string;
  }[],
  breaks: { started_at: string; ended_at: string | null }[],
  blockers: { started_at: string; resolved_at: string | null }[],
  nowMs: number,
  today: string,
): DayMetrics {
  if (!day.check_in_at) return EMPTY_METRICS;

  const s = new Date(day.check_in_at).getTime();
  let e: number;

  if (day.check_out_at) {
    e = new Date(day.check_out_at).getTime();
  } else if (day.work_date < today) {
    // Unclosed past shift!
    // Bounded by verified activity or work date end in IST. Never accumulates multi-day time.
    let maxActivityMs = s;
    for (const t of entries) {
      if (t.ended_at) {
        const val = new Date(t.ended_at).getTime();
        if (!isNaN(val)) maxActivityMs = Math.max(maxActivityMs, val);
      }
    }
    for (const b of breaks) {
      if (b.ended_at) {
        const val = new Date(b.ended_at).getTime();
        if (!isNaN(val)) maxActivityMs = Math.max(maxActivityMs, val);
      }
    }
    for (const k of blockers) {
      if (k.resolved_at) {
        const val = new Date(k.resolved_at).getTime();
        if (!isNaN(val)) maxActivityMs = Math.max(maxActivityMs, val);
      }
    }
    const endOfDayIstMs = new Date(`${day.work_date}T23:59:59.999+05:30`).getTime();
    e = Math.min(Math.max(s, maxActivityMs), isNaN(endOfDayIstMs) ? s : endOfDayIstMs);
  } else {
    // Ongoing shift today
    e = Math.max(s, nowMs);
  }

  const clamp = (rawStart: string, rawEnd: string | null): Interval | null => {
    const st = Math.max(new Date(rawStart).getTime(), s);
    const en = Math.min(rawEnd ? new Date(rawEnd).getTime() : e, e);
    return en > st ? { st, en } : null;
  };

  const taskIntervals: Interval[] = [];
  let unitsCompleted = 0;
  let unsubmittedEntries = 0;
  for (const t of entries) {
    unitsCompleted += Number(t.units_completed ?? 0);
    if (t.status === "draft") unsubmittedEntries += 1;
    const iv = clamp(t.started_at, t.ended_at);
    if (iv) taskIntervals.push(iv);
  }

  const breakIntervals: Interval[] = [];
  for (const b of breaks) {
    const iv = clamp(b.started_at, b.ended_at);
    if (iv) breakIntervals.push(iv);
  }

  const blockerIntervals: Interval[] = [];
  for (const k of blockers) {
    const iv = clamp(k.started_at, k.resolved_at);
    if (iv) blockerIntervals.push(iv);
  }

  const sumMinutes = (list: Interval[]) =>
    Math.trunc(list.reduce((acc, iv) => acc + (iv.en - iv.st) / 60_000, 0));

  const all = [...taskIntervals, ...breakIntervals, ...blockerIntervals].sort(
    (a, b) => a.st - b.st,
  );
  const merged: Interval[] = [];
  for (const iv of all) {
    const last = merged[merged.length - 1];
    if (!last || iv.st > last.en) {
      merged.push({ st: iv.st, en: iv.en });
    } else if (iv.en > last.en) {
      last.en = iv.en;
    }
  }

  const workedMinutes = Math.trunc((e - s) / 60_000);
  const coveredMinutes = sumMinutes(merged);

  return {
    workedMinutes,
    taskMinutes: sumMinutes(taskIntervals),
    breakMinutes: sumMinutes(breakIntervals),
    blockerMinutes: sumMinutes(blockerIntervals),
    coveredMinutes,
    uncoveredMinutes: Math.max(workedMinutes - coveredMinutes, 0),
    unitsCompleted,
    entryCount: entries.length,
    unsubmittedEntries,
  };
}

export function deriveDayStatusInMemory(
  day: {
    work_date: string;
    check_in_at: string | null;
    check_out_at: string | null;
    required_minutes: number;
    exception_type: string;
  },
  metrics: DayMetrics,
  eodStatus: string | null,
  today: string,
  hourlyLoggingExpected = true,
): string {
  if (day.exception_type === "holiday") return "holiday";
  if (day.exception_type === "weekly_off") return "weekly_off";
  if (day.exception_type === "leave") return "on_leave";

  if (!day.check_in_at) {
    if (metrics.entryCount > 0 || eodStatus != null) return "review_required";
    return "absent";
  }

  if (!day.check_out_at) {
    if (day.work_date < today) return "missed_check_out";
    return "present_eod_pending";
  }

  const required = Math.max(day.required_minutes ?? 480, 1);
  const worked = metrics.workedMinutes;

  if (worked < required * 0.5) return "half_day";
  if (worked > 0 && hourlyLoggingExpected && metrics.uncoveredMinutes > worked * 0.25)
    return "review_required";
  if (metrics.unsubmittedEntries > 0) return "review_required";
  if (!eodStatus || eodStatus === "draft") return "present_eod_pending";
  if (worked + 15 < required) return "present_hours_incomplete";

  return "present_complete";
}

/**
 * Loads attendance days visible to the caller (RLS decides the scope) and
 * decorates each one with the derived status, metrics, morning punctuality,
 * break evaluations, and timeline using batched queries.
 */
export async function loadOversightRows(
  supabase: Client,
  filter: OversightFilter,
): Promise<OversightRow[]> {
  let query = supabase
    .from("attendance_days")
    .select(
      "id, user_id, work_date, work_mode, check_in_at, check_out_at, required_minutes, exception_type, location_status, location_distance_m, location_accuracy_m, location_latitude, location_longitude, office_locations(name)",
    )
    .gte("work_date", filter.from)
    .lte("work_date", filter.to)
    .order("work_date", { ascending: false })
    .limit(500);
  if (filter.userId) query = query.eq("user_id", filter.userId);

  const { data: rawDays, error } = await query;
  if (error) throw error;
  if (!rawDays || rawDays.length === 0) return [];

  // Protected system-owner accounts never appear in oversight, dashboards,
  // reports or exports (RLS also hides them once the privacy migration is live).
  const [protectedIds, workTypes] = await Promise.all([
    loadProtectedAccountIds(supabase),
    loadProfileWorkTypes(supabase, [...new Set(rawDays.map((d) => d.user_id))]),
  ]);
  const days = excludeProtectedAccounts(rawDays, protectedIds);
  if (days.length === 0) return [];

  const dayIds = days.map((d) => d.id);
  const userIds = [...new Set(days.map((d) => d.user_id))];

  // Batch queries for all related tables
  const [
    names,
    profilesRes,
    rolesRes,
    entriesRes,
    breaksRes,
    breakRequestsRes,
    blockersRes,
    eodsRes,
    allocationsRes,
  ] = await Promise.all([
    loadProfileNames(supabase, userIds),
    loose(supabase)
      .from("profiles")
      .select("id, full_name, employee_code, work_email, department_id, work_type, category, designation, departments(id, name)")
      .in("id", userIds),
    supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", userIds),
    supabase
      .from("task_entries")
      .select(
        "day_id, project_id, allocation_id, started_at, ended_at, units_completed, units_approved, units_rejected, status, projects(code, hourly_task_target, daily_task_target, quality_target_pct, max_rejection_rate_pct), project_allocations(hours_per_day, daily_task_target, quality_target_pct, max_rejection_rate_pct)",
      )
      .in("day_id", dayIds),
    // Select break_logs with all columns
    supabase
      .from("break_logs")
      .select("id, day_id, user_id, category, started_at, ended_at, expected_end_at, allowed_minutes, overtime_seconds, return_status, break_request_id, is_legacy, note" as never)
      .in("day_id", dayIds),
    // Select break_requests
    supabase
      .from("break_requests" as never)
      .select("id, user_id, work_date, requested_minutes, approved_minutes, reason, status, decided_at, decided_by" as never)
      .in("user_id", userIds),
    // Select blockers with resolution
    supabase
      .from("blockers")
      .select("id, day_id, user_id, category, severity, description, status, resolution_note, started_at, resolved_at, created_at")
      .in("day_id", dayIds),
    // Select eod_reports
    supabase
      .from("eod_reports")
      .select(
        "id, day_id, user_id, work_date, highlights, challenges, tomorrow_plan, support_needed, status, submitted_at, reviewed_by, reviewed_at, review_note",
      )
      .in("day_id", dayIds),
    supabase
      .from("project_allocations")
      .select(
        "user_id, project_id, start_date, end_date, hours_per_day, daily_task_target, quality_target_pct, max_rejection_rate_pct, projects(code, hourly_task_target, daily_task_target, quality_target_pct, max_rejection_rate_pct)",
      )
      .in("user_id", userIds)
      .neq("status", "ended"),
  ]);

  // Build profile lookup map
  const profileMap = new Map<
    string,
    {
      employeeCode: string | null;
      workEmail: string | null;
      departmentId: string | null;
      departmentName: string | null;
      workType: string;
      category: string;
      designation: string | null;
    }
  >();
  for (const p of (profilesRes.data as unknown as Array<{
    id: string;
    employee_code?: string | null;
    work_email?: string | null;
    department_id?: string | null;
    work_type?: string | null;
    category?: string | null;
    designation?: string | null;
    departments?: { id?: string; name?: string } | null;
  }>) ?? []) {
    const dept = p.departments as { id?: string; name?: string } | null;
    profileMap.set(p.id, {
      employeeCode: p.employee_code ?? null,
      workEmail: p.work_email ?? null,
      departmentId: p.department_id ?? null,
      departmentName: dept?.name ?? null,
      workType: p.work_type ?? "operations",
      category: p.category ?? "full_time",
      designation: p.designation ?? null,
    });
  }

  // Build roles lookup map
  const roleMap = new Map<string, string>();
  for (const r of rolesRes.data ?? []) {
    roleMap.set(r.user_id, r.role);
  }

  // Build break requests map
  const breakRequestsMap = new Map<
    string,
    {
      requested_minutes: number;
      approved_minutes: number | null;
      reason: string;
      status: string;
    }
  >();
  for (const br of (breakRequestsRes.data as unknown as Array<{
    id: string;
    requested_minutes: number;
    approved_minutes: number | null;
    reason: string;
    status: string;
  }>) ?? []) {
    breakRequestsMap.set(br.id, {
      requested_minutes: br.requested_minutes,
      approved_minutes: br.approved_minutes,
      reason: br.reason,
      status: br.status,
    });
  }

  const entriesByDay = new Map<string, NonNullable<typeof entriesRes.data>>();
  for (const e of entriesRes.data ?? []) {
    const list = entriesByDay.get(e.day_id) ?? [];
    list.push(e);
    entriesByDay.set(e.day_id, list);
  }

  type RawBreakRow = {
    id: string;
    day_id: string;
    user_id: string;
    category: string;
    started_at: string;
    ended_at: string | null;
    expected_end_at?: string | null;
    allowed_minutes?: number | null;
    overtime_seconds?: number | null;
    return_status?: string | null;
    break_request_id?: string | null;
    is_legacy?: boolean | null;
    note?: string | null;
  };

  const breaksByDay = new Map<string, RawBreakRow[]>();
  for (const b of (breaksRes.data as unknown as RawBreakRow[]) ?? []) {
    const list = breaksByDay.get(b.day_id) ?? [];
    list.push(b);
    breaksByDay.set(b.day_id, list);
  }

  const blockersByDay = new Map<string, NonNullable<typeof blockersRes.data>>();
  for (const k of blockersRes.data ?? []) {
    const list = blockersByDay.get(k.day_id) ?? [];
    list.push(k);
    blockersByDay.set(k.day_id, list);
  }

  type RawEodRow = NonNullable<typeof eodsRes.data>[number];
  const eodByDay = new Map<string, RawEodRow>();
  for (const eod of eodsRes.data ?? []) {
    eodByDay.set(eod.day_id, eod);
  }

  const allocationsByUser = new Map<string, NonNullable<typeof allocationsRes.data>>();
  for (const a of allocationsRes.data ?? []) {
    const list = allocationsByUser.get(a.user_id) ?? [];
    list.push(a);
    allocationsByUser.set(a.user_id, list);
  }

  const nowMs = Date.now();
  const today = todayIso(new Date(nowMs));
  const rows: OversightRow[] = [];

  for (const day of days) {
    const dayEntries = entriesByDay.get(day.id) ?? [];
    const scoped = dayEntries.filter(
      (e) => !filter.projectId || e.project_id === filter.projectId,
    );
    if (filter.projectId && scoped.length === 0) continue;

    const dayBreaks = breaksByDay.get(day.id) ?? [];
    const dayBlockers = blockersByDay.get(day.id) ?? [];
    const dayEod = eodByDay.get(day.id) ?? null;
    const eodStatus = dayEod?.status ?? null;

    const profile = profileMap.get(day.user_id);
    const role = roleMap.get(day.user_id) ?? "employee";

    // 1. Memory metrics with past-unclosed-shift bound fix (eliminating 132.83-hour anomaly)
    const metrics = computeDayMetricsInMemory(
      day,
      dayEntries,
      dayBreaks,
      dayBlockers,
      nowMs,
      today,
    );

    // 2. Attendance Status derivation
    const status = deriveDayStatusInMemory(
      day,
      metrics,
      eodStatus,
      today,
      workTypes.schemaReady ? workTypes.map.get(day.user_id) === "annotation" : true,
    );

    // 3. Morning punctuality evaluation (10:00 AM IST deadline)
    const punctuality = evaluateMorningPunctuality(
      day.check_in_at,
      day.work_date,
      new Date(nowMs),
      day.exception_type,
    );

    // 4. Break compliance evaluation
    const breaksWithRequests = dayBreaks.map((b) => ({
      ...b,
      break_requests: b.break_request_id ? breakRequestsMap.get(b.break_request_id) ?? null : null,
    }));
    const breakEval = evaluateBreakCompliance(breaksWithRequests, day.work_date, new Date(nowMs));

    const allBreakSummaryItems: BreakSummaryItem[] = [
      breakEval.lunchBreak,
      breakEval.shortBreak,
      ...breakEval.personalizedBreaks,
    ].filter((item): item is BreakSummaryItem => Boolean(item));

    const totalBreakMinutes = allBreakSummaryItems.reduce(
      (sum, item) => sum + item.durationMinutes,
      0,
    );
    const hasActiveBreak = Boolean(breakEval.openBreak);
    const hasOverdueBreak =
      breakEval.openBreak?.returnStatus === "overdue" || breakEval.totalBreakOvertimeMinutes > 0;

    let breakStatusSummary = "None";
    if (breakEval.breakStatus === "on_lunch") breakStatusSummary = "On Lunch";
    else if (breakEval.breakStatus === "on_short_break") breakStatusSummary = "On Short Break";
    else if (breakEval.breakStatus === "on_personalized_break") breakStatusSummary = "On Break";
    else if (breakEval.breakStatus === "overdue") breakStatusSummary = "Overdue Break";
    else if (breakEval.breakStatus === "late_return") breakStatusSummary = "Late Return";
    else if (breakEval.breakStatus === "completed_on_time") breakStatusSummary = "Completed";
    else if (breakEval.breakStatus === "legacy") breakStatusSummary = "Legacy";

    // 5. Build chronological verified attendance timeline
    const timeline = buildAttendanceTimeline({
      workDate: day.work_date,
      checkInAt: day.check_in_at,
      checkOutAt: day.check_out_at,
      minutesLate: punctuality.minutesLate,
      arrivalStatus: punctuality.arrivalStatus,
      breaks: allBreakSummaryItems,
    });

    // 6. Resolve target parameters
    let projectTarget: {
      project_code?: string | null;
      hourly_task_target?: number | null;
      daily_task_target?: number | null;
      quality_target_pct?: number | null;
      max_rejection_rate_pct?: number | null;
    } | null = null;

    if (scoped.length > 0) {
      const counts = new Map<string, { count: number; sample: (typeof scoped)[number] }>();
      for (const e of scoped) {
        const cur = counts.get(e.project_id);
        if (cur) cur.count += 1;
        else counts.set(e.project_id, { count: 1, sample: e });
      }
      const dominant = [...counts.values()].sort((a, b) => b.count - a.count)[0]?.sample;
      if (dominant) {
        const p = dominant.projects as {
          code?: string | null;
          hourly_task_target?: number | null;
          daily_task_target?: number | null;
          quality_target_pct?: number | null;
          max_rejection_rate_pct?: number | null;
        } | null;
        const a = dominant.project_allocations as {
          hours_per_day?: number | null;
          daily_task_target?: number | null;
          quality_target_pct?: number | null;
          max_rejection_rate_pct?: number | null;
        } | null;
        const allocHourly =
          a?.daily_task_target != null && a?.hours_per_day && Number(a.hours_per_day) > 0
            ? Number(a.daily_task_target) / Number(a.hours_per_day)
            : null;
        projectTarget = {
          project_code: p?.code ?? null,
          hourly_task_target: allocHourly ?? p?.hourly_task_target ?? null,
          daily_task_target: a?.daily_task_target ?? p?.daily_task_target ?? null,
          quality_target_pct: a?.quality_target_pct ?? p?.quality_target_pct ?? null,
          max_rejection_rate_pct: a?.max_rejection_rate_pct ?? p?.max_rejection_rate_pct ?? null,
        };
      }
    } else {
      const userAllocs = (allocationsByUser.get(day.user_id) ?? []).filter(
        (a) =>
          a.start_date <= day.work_date &&
          (!a.end_date || a.end_date >= day.work_date) &&
          (!filter.projectId || a.project_id === filter.projectId),
      );
      const firstAlloc = userAllocs[0];
      if (firstAlloc) {
        const p = firstAlloc.projects as {
          code?: string | null;
          hourly_task_target?: number | null;
          daily_task_target?: number | null;
          quality_target_pct?: number | null;
          max_rejection_rate_pct?: number | null;
        } | null;
        projectTarget = {
          project_code: p?.code ?? null,
          hourly_task_target: p?.hourly_task_target ?? null,
          daily_task_target: firstAlloc.daily_task_target ?? p?.daily_task_target ?? null,
          quality_target_pct: firstAlloc.quality_target_pct ?? p?.quality_target_pct ?? null,
          max_rejection_rate_pct:
            firstAlloc.max_rejection_rate_pct ?? p?.max_rejection_rate_pct ?? null,
        };
      }
    }

    const unitsApproved = scoped.reduce((sum, e) => sum + Number(e.units_approved ?? 0), 0);
    const unitsRejected = scoped.reduce((sum, e) => sum + Number(e.units_rejected ?? 0), 0);
    const unitsCompleted = filter.projectId
      ? scoped.reduce((sum, e) => sum + Number(e.units_completed ?? 0), 0)
      : metrics.unitsCompleted;

    // 7. Structured EOD report
    const eodReport: OversightEodReport | null = dayEod
      ? {
          id: dayEod.id,
          highlights: dayEod.highlights,
          challenges: dayEod.challenges,
          tomorrowPlan: dayEod.tomorrow_plan,
          supportNeeded: dayEod.support_needed,
          status: dayEod.status,
          submittedAt: dayEod.submitted_at,
          reviewedAt: dayEod.reviewed_at,
          reviewedBy: dayEod.reviewed_by,
          reviewerName: dayEod.reviewed_by ? nameOf(names, dayEod.reviewed_by) : null,
          reviewNote: dayEod.review_note,
        }
      : null;

    // 8. Structured blockers
    const formattedBlockers: OversightBlocker[] = dayBlockers.map((b) => ({
      id: b.id,
      category: b.category,
      severity: b.severity,
      description: b.description,
      status: b.status,
      resolutionNote: b.resolution_note,
      startedAt: b.started_at,
      resolvedAt: b.resolved_at,
      createdAt: b.created_at,
    }));

    rows.push({
      dayId: day.id,
      userId: day.user_id,
      fullName: nameOf(names, day.user_id),
      employeeCode: profile?.employeeCode ?? null,
      workEmail: profile?.workEmail ?? null,
      departmentId: profile?.departmentId ?? null,
      departmentName: profile?.departmentName ?? null,
      role,
      workType: profile?.workType ?? "operations",
      category: profile?.category ?? "full_time",
      designation: profile?.designation ?? null,
      workDate: day.work_date,
      workMode: day.work_mode,
      checkInAt: day.check_in_at,
      checkOutAt: day.check_out_at,
      requiredMinutes: day.required_minutes,
      status,
      // Punctuality
      arrivalStatus: punctuality.arrivalStatus,
      minutesLate: punctuality.minutesLate,
      scheduledCheckInIst: punctuality.scheduledTimeIst,
      displayArrivalStatus: punctuality.displayLabel,
      // Breaks
      breaks: allBreakSummaryItems,
      breakStatus: breakEval.breakStatus,
      breakStatusSummary,
      totalBreakMinutes,
      breakOvertimeMinutes: breakEval.totalBreakOvertimeMinutes,
      hasActiveBreak,
      hasOverdueBreak,
      lunchBreak: breakEval.lunchBreak,
      shortBreak: breakEval.shortBreak,
      personalizedBreaks: breakEval.personalizedBreaks,
      // Timeline
      timeline,
      // Metrics & Targets
      metrics,
      achievement: computeTargetAchievement({
        taskMinutes: metrics.taskMinutes,
        unitsCompleted,
        unitsApproved: unitsApproved || null,
        unitsRejected: unitsRejected || null,
        targets: {
          hourlyTarget: projectTarget?.hourly_task_target ?? null,
          dailyTarget: projectTarget?.daily_task_target ?? null,
          qualityTargetPct: projectTarget?.quality_target_pct ?? null,
          maxRejectionRatePct: projectTarget?.max_rejection_rate_pct ?? null,
        },
      }),
      projectCode: projectTarget?.project_code ?? null,
      eodStatus,
      eodReport,
      blockers: formattedBlockers,
      locationStatus: day.location_status ?? "not_required",
      locationDistanceM: day.location_distance_m == null ? null : Number(day.location_distance_m),
      locationAccuracyM: day.location_accuracy_m == null ? null : Number(day.location_accuracy_m),
      locationLatitude: day.location_latitude == null ? null : Number(day.location_latitude),
      locationLongitude: day.location_longitude == null ? null : Number(day.location_longitude),
      officeName: (day.office_locations as { name?: string } | null)?.name ?? null,
    });
  }

  return rows;
}

/** Roll-up used by the lead / admin / founder summary cards and workforce KPI strip. */
export function summariseRows(rows: OversightRow[]): WorkforceSummary {
  const people = new Set(rows.map((r) => r.userId));
  const workedMinutes = rows.reduce((s, r) => s + r.metrics.workedMinutes, 0);
  const uncovered = rows.reduce((s, r) => s + r.metrics.uncoveredMinutes, 0);
  const units = rows.reduce((s, r) => s + r.achievement.unitsCompleted, 0);
  const withPct = rows.filter((r) => r.achievement.dailyAchievementPct != null);
  const avgAchievement =
    withPct.length > 0
      ? Math.round(
          (withPct.reduce((s, r) => s + (r.achievement.dailyAchievementPct ?? 0), 0) /
            withPct.length) *
            10,
        ) / 10
      : null;

  const byStatus: Record<string, number> = {};
  for (const row of rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;

  // 8 Workforce KPI metrics
  const checkedInCount = rows.filter((r) => r.checkInAt != null).length;
  const onTimeArrivals = rows.filter((r) => r.arrivalStatus === "on_time").length;
  const lateArrivals = rows.filter((r) => r.arrivalStatus === "late").length;
  const currentlyOnBreak = rows.filter((r) => r.hasActiveBreak).length;
  const overdueBreaks = rows.filter((r) => r.hasOverdueBreak || r.breakOvertimeMinutes > 0).length;
  const checkedOutCount = rows.filter((r) => r.checkOutAt != null).length;
  const missingCheckIns = rows.filter((r) => r.arrivalStatus === "missing_check_in").length;
  const expectedTotal = people.size;

  return {
    expectedTotal,
    checkedInCount,
    onTimeArrivals,
    lateArrivals,
    currentlyOnBreak,
    overdueBreaks,
    checkedOutCount,
    missingCheckIns,
    days: rows.length,
    people: people.size,
    workedHours: Math.round((workedMinutes / 60) * 10) / 10,
    uncoveredMinutes: uncovered,
    unitsCompleted: units,
    avgAchievementPct: avgAchievement,
    byStatus,
    problemDays: rows.filter(
      (r) =>
        r.status === "review_required" ||
        r.status === "missed_check_out" ||
        r.status === "half_day" ||
        r.status === "present_hours_incomplete",
    ).length,
  };
}
