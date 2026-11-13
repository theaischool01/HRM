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

type Client = SupabaseClient<Database>;

export type OversightRow = {
  dayId: string;
  userId: string;
  fullName: string;
  workDate: string;
  workMode: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  requiredMinutes: number;
  status: string;
  metrics: DayMetrics;
  achievement: TargetAchievement;
  projectCode: string | null;
  eodStatus: string | null;
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

type Interval = { st: number; en: number };

function computeDayMetricsInMemory(
  day: { check_in_at: string | null; check_out_at: string | null },
  entries: {
    started_at: string;
    ended_at: string;
    units_completed: number;
    status: string;
  }[],
  breaks: { started_at: string; ended_at: string | null }[],
  blockers: { started_at: string; resolved_at: string | null }[],
  nowMs: number,
): DayMetrics {
  if (!day.check_in_at) return EMPTY_METRICS;

  const s = new Date(day.check_in_at).getTime();
  const e = day.check_out_at
    ? new Date(day.check_out_at).getTime()
    : Math.max(s, nowMs);

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

function deriveDayStatusInMemory(
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
 * decorates each one with the derived status, metrics and target maths using
 * batched queries (no N+1 per-day roundtrips).
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

  const [
    names,
    { data: allEntries },
    { data: allBreaks },
    { data: allBlockers },
    { data: allEods },
    { data: allAllocations },
  ] = await Promise.all([
    loadProfileNames(supabase, userIds),
    supabase
      .from("task_entries")
      .select(
        "day_id, project_id, allocation_id, started_at, ended_at, units_completed, units_approved, units_rejected, status, projects(code, hourly_task_target, daily_task_target, quality_target_pct, max_rejection_rate_pct), project_allocations(hours_per_day, daily_task_target, quality_target_pct, max_rejection_rate_pct)",
      )
      .in("day_id", dayIds),
    supabase
      .from("break_logs")
      .select("day_id, started_at, ended_at")
      .in("day_id", dayIds),
    supabase
      .from("blockers")
      .select("day_id, started_at, resolved_at")
      .in("day_id", dayIds),
    supabase
      .from("eod_reports")
      .select("day_id, status")
      .in("day_id", dayIds),
    supabase
      .from("project_allocations")
      .select(
        "user_id, project_id, start_date, end_date, hours_per_day, daily_task_target, quality_target_pct, max_rejection_rate_pct, projects(code, hourly_task_target, daily_task_target, quality_target_pct, max_rejection_rate_pct)",
      )
      .in("user_id", userIds)
      .neq("status", "ended"),
  ]);

  const entriesByDay = new Map<string, NonNullable<typeof allEntries>>();
  for (const e of allEntries ?? []) {
    const list = entriesByDay.get(e.day_id) ?? [];
    list.push(e);
    entriesByDay.set(e.day_id, list);
  }

  const breaksByDay = new Map<string, NonNullable<typeof allBreaks>>();
  for (const b of allBreaks ?? []) {
    const list = breaksByDay.get(b.day_id) ?? [];
    list.push(b);
    breaksByDay.set(b.day_id, list);
  }

  const blockersByDay = new Map<string, NonNullable<typeof allBlockers>>();
  for (const k of allBlockers ?? []) {
    const list = blockersByDay.get(k.day_id) ?? [];
    list.push(k);
    blockersByDay.set(k.day_id, list);
  }

  const eodByDay = new Map<string, string>();
  for (const eod of allEods ?? []) {
    eodByDay.set(eod.day_id, eod.status);
  }

  const allocationsByUser = new Map<string, NonNullable<typeof allAllocations>>();
  for (const a of allAllocations ?? []) {
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
    const eodStatus = eodByDay.get(day.id) ?? null;

    const metrics = computeDayMetricsInMemory(
      day,
      dayEntries,
      dayBreaks,
      dayBlockers,
      nowMs,
    );
    const status = deriveDayStatusInMemory(
      day,
      metrics,
      eodStatus,
      today,
      // Mirrors SQL derive_attendance_status: hourly coverage is expected only from
      // Annotation staff. Before the migration (no work types) keep legacy behaviour.
      workTypes.schemaReady ? workTypes.map.get(day.user_id) === "annotation" : true,
    );

    // Resolve target parameters from the most frequent task_entry project or active allocation
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

    rows.push({
      dayId: day.id,
      userId: day.user_id,
      fullName: nameOf(names, day.user_id),
      workDate: day.work_date,
      workMode: day.work_mode,
      checkInAt: day.check_in_at,
      checkOutAt: day.check_out_at,
      requiredMinutes: day.required_minutes,
      status,
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

/** Roll-up used by the lead / admin / founder summary cards. */
export function summariseRows(rows: OversightRow[]) {
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

  return {
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
