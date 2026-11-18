-- Migration: 20261118130000_fix_unclosed_shift_metrics_and_attendance_monitoring.sql
-- Fixes the 132.83-hour unclosed shift data integrity bug in attendance_day_metrics.
-- When check_out_at is NULL on a past date, the shift interval must NEVER accumulate
-- continuous time into subsequent days via now(). It is bounded by the end of that
-- specific work date or verified activity on that date.

CREATE OR REPLACE FUNCTION public.attendance_day_metrics(_day_id uuid)
RETURNS TABLE(
  worked_minutes integer,
  task_minutes integer,
  break_minutes integer,
  blocker_minutes integer,
  covered_minutes integer,
  uncovered_minutes integer,
  units_completed numeric,
  entry_count integer,
  unsubmitted_entries integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d public.attendance_days;
  s timestamptz;
  e timestamptz;
  ist_end_of_day timestamptz;
  caller uuid := auth.uid();
BEGIN
  SELECT * INTO d FROM public.attendance_days WHERE id = _day_id;
  IF NOT FOUND OR d.check_in_at IS NULL THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0, 0, 0::numeric, 0, 0;
    RETURN;
  END IF;

  IF caller IS NOT NULL AND NOT (
       d.user_id = caller
       OR public.has_permission(caller, 'attendance:read:all')
       OR (public.has_permission(caller, 'attendance:read:team') AND public.is_supervisor_of(d.user_id, caller))
     ) THEN
    RAISE EXCEPTION 'Not authorised to view this day.';
  END IF;

  s := d.check_in_at;

  -- Bounded calculation to prevent unclosed past shifts from accumulating multi-day time
  IF d.check_out_at IS NOT NULL THEN
    e := d.check_out_at;
  ELSIF d.work_date < public.current_ist_date() THEN
    -- Past day with missing check-out: bound to verified activity or end of that specific work date (never now()!)
    ist_end_of_day := (d.work_date || ' 23:59:59.999+05:30')::timestamptz;
    e := LEAST(
      GREATEST(
        d.check_in_at,
        COALESCE(
          (SELECT MAX(ended_at) FROM public.task_entries WHERE day_id = _day_id),
          (SELECT MAX(COALESCE(ended_at, started_at)) FROM public.break_logs WHERE day_id = _day_id),
          d.check_in_at
        )
      ),
      ist_end_of_day
    );
  ELSE
    -- Active shift today: bounded by now() and end of today in IST
    ist_end_of_day := (d.work_date || ' 23:59:59.999+05:30')::timestamptz;
    e := LEAST(GREATEST(d.check_in_at, now()), ist_end_of_day);
  END IF;

  RETURN QUERY
  WITH iv AS (
    SELECT 'task'::text kind, GREATEST(t.started_at, s) st, LEAST(t.ended_at, e) en
      FROM public.task_entries t WHERE t.day_id = _day_id
    UNION ALL
    SELECT 'break', GREATEST(b.started_at, s), LEAST(COALESCE(b.ended_at, e), e)
      FROM public.break_logs b WHERE b.day_id = _day_id
    UNION ALL
    SELECT 'blocker', GREATEST(k.started_at, s), LEAST(COALESCE(k.resolved_at, e), e)
      FROM public.blockers k WHERE k.day_id = _day_id
  ),
  clamped AS (
    SELECT kind, st, en, EXTRACT(EPOCH FROM (en - st)) / 60.0 dur
      FROM iv WHERE en > st
  ),
  per_kind AS (
    SELECT
      COALESCE(SUM(dur) FILTER (WHERE kind = 'task'), 0)::integer tm,
      COALESCE(SUM(dur) FILTER (WHERE kind = 'break'), 0)::integer bm,
      COALESCE(SUM(dur) FILTER (WHERE kind = 'blocker'), 0)::integer km
    FROM clamped
  ),
  tasks_agg AS (
    SELECT
      COALESCE(SUM(units_completed), 0)::numeric uc,
      COUNT(*)::integer ec,
      COUNT(*) FILTER (WHERE status = 'draft')::integer uc_draft
    FROM public.task_entries WHERE day_id = _day_id
  )
  SELECT
    GREATEST(0, TRUNC(EXTRACT(EPOCH FROM (e - s)) / 60.0)::integer) worked_minutes,
    k.tm task_minutes,
    k.bm break_minutes,
    k.km blocker_minutes,
    LEAST(k.tm + k.bm + k.km, GREATEST(0, TRUNC(EXTRACT(EPOCH FROM (e - s)) / 60.0)::integer)) covered_minutes,
    GREATEST(0, TRUNC(EXTRACT(EPOCH FROM (e - s)) / 60.0)::integer - (k.tm + k.bm + k.km)) uncovered_minutes,
    ta.uc units_completed,
    ta.ec entry_count,
    ta.uc_draft unsubmitted_entries
  FROM per_kind k CROSS JOIN tasks_agg ta;
END;
$function$;
