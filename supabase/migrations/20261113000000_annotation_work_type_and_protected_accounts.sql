-- =============================================================================
-- THE AI SCHOOL HRM — Annotation Workforce, Project Eligibility & Super Admin Privacy
-- Migration: 20261113000000_annotation_work_type_and_protected_accounts.sql
--
-- ADDITIVE AND REVIEWABLE. Does NOT:
--   * classify any existing employee (every profiles.work_type starts NULL = "unclassified")
--   * classify any existing project (projects.work_type starts NULL)
--   * delete, deactivate or change roles of any account
--   * renumber employee IDs
--
-- Rollback script: docs/migrations/20261113000000_rollback.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Work Type / Workstream (distinct from role, category and employment status)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE public.work_type AS ENUM (
    'annotation', 'engineering', 'operations', 'hr', 'training', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS work_type public.work_type,
  ADD COLUMN IF NOT EXISTS work_type_assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS work_type_assigned_at timestamptz;

COMMENT ON COLUMN public.profiles.work_type IS
  'Authorised workstream assignment (HR/Admin/Super Admin only). NULL = unclassified. Not an authorization role.';

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS work_type public.work_type;

COMMENT ON COLUMN public.projects.work_type IS
  'Work classification of the project. Only work_type = annotation projects accept hourly annotation logs.';

CREATE INDEX IF NOT EXISTS idx_profiles_work_type ON public.profiles (work_type);
CREATE INDEX IF NOT EXISTS idx_projects_work_type ON public.projects (work_type);

-- -----------------------------------------------------------------------------
-- 2. Annotation department (created only if missing; nobody is moved into it)
-- -----------------------------------------------------------------------------
INSERT INTO public.departments (name, code, description)
SELECT 'Annotation', 'ANN', 'Data annotation workstream (hourly production logging).'
WHERE NOT EXISTS (
  SELECT 1 FROM public.departments WHERE code = 'ANN' OR lower(name) = 'annotation'
);

-- -----------------------------------------------------------------------------
-- 3. Protected (system-owner) accounts — by ROLE, never by hardcoded ID
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_protected_account(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.user_roles r
       WHERE r.user_id = _user_id AND r.role = 'super_admin'
     );
$$;

-- Viewer may see a protected identity: themselves, or another Super Admin (governance).
CREATE OR REPLACE FUNCTION public.can_see_protected_identity(_target uuid, _viewer uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT public.is_protected_account(_target)
      OR (_viewer IS NOT NULL AND _viewer = _target)
      OR (_viewer IS NOT NULL AND public.has_role(_viewer, 'super_admin'));
$$;

REVOKE ALL ON FUNCTION public.is_protected_account(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_see_protected_identity(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_protected_account(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_protected_identity(uuid, uuid) TO authenticated, service_role;

-- RESTRICTIVE policies are AND-ed with every existing permissive policy, so they
-- close the gap regardless of which permissive policy (self/team/all) matched.
DROP POLICY IF EXISTS profiles_protected_privacy_select ON public.profiles;
CREATE POLICY profiles_protected_privacy_select ON public.profiles
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.can_see_protected_identity(id, auth.uid()));

DROP POLICY IF EXISTS profiles_protected_privacy_update ON public.profiles;
CREATE POLICY profiles_protected_privacy_update ON public.profiles
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.can_see_protected_identity(id, auth.uid()))
  WITH CHECK (public.can_see_protected_identity(id, auth.uid()));

DROP POLICY IF EXISTS user_roles_protected_privacy_select ON public.user_roles;
CREATE POLICY user_roles_protected_privacy_select ON public.user_roles
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.can_see_protected_identity(user_id, auth.uid()));

-- Operational records owned by a protected account are hidden from oversight too.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_days','break_logs','task_entries','eod_reports','blockers','documents']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_protected_privacy_select', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.can_see_protected_identity(user_id, auth.uid()))',
        t || '_protected_privacy_select', t
      );
    END IF;
  END LOOP;
END $$;

-- Name resolution (audit trails, rosters) masks protected identities for other viewers.
CREATE OR REPLACE FUNCTION public.profile_names(_ids uuid[])
RETURNS TABLE(id uuid, full_name text, designation text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.id,
    CASE WHEN auth.uid() IS NOT NULL AND NOT public.can_see_protected_identity(p.id, auth.uid())
         THEN 'System Administrator' ELSE p.full_name END,
    CASE WHEN auth.uid() IS NOT NULL AND NOT public.can_see_protected_identity(p.id, auth.uid())
         THEN NULL ELSE p.designation END
  FROM public.profiles p
  WHERE p.id = ANY(COALESCE(_ids, ARRAY[]::uuid[]))
    AND (
      auth.uid() IS NULL
      OR p.id = auth.uid()
      OR public.has_permission(auth.uid(), 'workforce:read:all')
      OR (public.has_permission(auth.uid(), 'workforce:read:team') AND p.reporting_lead_id = auth.uid())
      OR public.is_work_lead_of(p.id, auth.uid())
      OR public.is_work_lead_of(auth.uid(), p.id)
    );
$function$;

-- -----------------------------------------------------------------------------
-- 4. Work type changes: HR / Admin / Super Admin only, stamped for audit
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_work_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RETURN NEW; -- service role / migrations
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.work_type IS NOT DISTINCT FROM OLD.work_type THEN
    -- Assignment stamps can only move together with an actual work type change.
    NEW.work_type_assigned_by := OLD.work_type_assigned_by;
    NEW.work_type_assigned_at := OLD.work_type_assigned_at;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.work_type IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT (
       public.has_role(caller, 'super_admin')
    OR public.has_role(caller, 'hr')
    OR public.has_role(caller, 'admin')
  ) THEN
    RAISE EXCEPTION 'Only HR, Admin or Super Admin can change an employee work type.'
      USING ERRCODE = '42501';
  END IF;

  IF caller = NEW.id AND NOT public.has_role(caller, 'super_admin') THEN
    RAISE EXCEPTION 'You cannot assign your own work type.' USING ERRCODE = '42501';
  END IF;

  NEW.work_type_assigned_by := caller;
  NEW.work_type_assigned_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_work_type_guard ON public.profiles;
CREATE TRIGGER trg_profile_work_type_guard
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_work_type();

REVOKE ALL ON FUNCTION public.guard_profile_work_type() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. ONE authoritative annotation eligibility policy
-- -----------------------------------------------------------------------------
-- Profile-level: role = employee only, work type = annotation, verified & active,
-- category full_time or intern (trainer / freelancer excluded).
CREATE OR REPLACE FUNCTION public.is_annotation_contributor(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
     AND public.has_role(_user_id, 'employee')
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles r
       WHERE r.user_id = _user_id
         AND r.role IN ('super_admin', 'founder', 'hr', 'admin', 'manager', 'lead')
     )
     AND EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = _user_id
         AND p.work_type = 'annotation'
         AND p.account_status = 'active'
         AND p.employment_status = 'active'
         AND p.category IN ('full_time', 'intern')
     );
$$;

-- Assignable to an annotation project (allocation may precede final verification).
CREATE OR REPLACE FUNCTION public.is_annotation_assignable(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
     AND public.has_role(_user_id, 'employee')
     AND NOT EXISTS (
       SELECT 1 FROM public.user_roles r
       WHERE r.user_id = _user_id
         AND r.role IN ('super_admin', 'founder', 'hr', 'admin', 'manager', 'lead')
     )
     AND EXISTS (
       SELECT 1 FROM public.profiles p
       WHERE p.id = _user_id
         AND p.work_type = 'annotation'
         AND p.employment_status = 'active'
         AND p.category IN ('full_time', 'intern')
     );
$$;

CREATE OR REPLACE FUNCTION public.can_log_annotation_work(
  _user_id uuid,
  _project_id uuid,
  _on_date date DEFAULT public.current_ist_date()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE caller uuid := auth.uid();
BEGIN
  IF caller IS NOT NULL AND NOT (
       _user_id = caller
       OR public.has_permission(caller, 'allocations:read:all')
       OR (public.has_permission(caller, 'allocations:read:team') AND public.is_supervisor_of(_user_id, caller))
     ) THEN
    RAISE EXCEPTION 'Not authorised.';
  END IF;

  RETURN public.is_annotation_contributor(_user_id)
     AND EXISTS (
       SELECT 1
       FROM public.project_allocations a
       JOIN public.projects pr ON pr.id = a.project_id
       WHERE a.user_id = _user_id
         AND a.project_id = _project_id
         AND a.status = 'active'
         AND a.acknowledged_at IS NOT NULL
         AND a.start_date <= _on_date
         AND (a.end_date IS NULL OR a.end_date >= _on_date)
         AND pr.work_type = 'annotation'
         AND pr.status = 'active'
     );
END;
$function$;

REVOKE ALL ON FUNCTION public.is_annotation_contributor(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_annotation_assignable(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_log_annotation_work(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_annotation_contributor(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_annotation_assignable(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_log_annotation_work(uuid, uuid, date) TO authenticated, service_role;

-- RLS: hourly entries require the full annotation policy.
DROP POLICY IF EXISTS tasks_insert_self ON public.task_entries;
CREATE POLICY tasks_insert_self ON public.task_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.has_permission(auth.uid(), 'tasks:log:self')
    AND public.can_log_annotation_work(auth.uid(), project_id)
  );

DROP POLICY IF EXISTS tasks_update_self ON public.task_entries;
CREATE POLICY tasks_update_self ON public.task_entries
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status <> 'approved' AND public.has_permission(auth.uid(), 'tasks:log:self'))
  WITH CHECK (
    user_id = auth.uid()
    AND public.has_permission(auth.uid(), 'tasks:log:self')
    AND public.can_log_annotation_work(auth.uid(), project_id)
  );

-- Trigger: covers every entrypoint that runs as an authenticated user (RPCs,
-- alternate clients, crafted requests). Reviewer updates (caller <> owner) pass.
CREATE OR REPLACE FUNCTION public.guard_annotation_task_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RETURN NEW;
  END IF;

  IF caller <> NEW.user_id THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Hourly entries can only be logged by the employee who did the work.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW; -- reviewer path, governed by tasks_update_reviewer
  END IF;

  IF NOT public.can_log_annotation_work(
       NEW.user_id, NEW.project_id, (NEW.started_at AT TIME ZONE 'Asia/Kolkata')::date
     ) THEN
    RAISE EXCEPTION 'Hourly annotation logging is limited to eligible annotation employees with an active, acknowledged annotation project allocation.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.allocation_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.project_allocations a
       WHERE a.id = NEW.allocation_id AND a.user_id = NEW.user_id AND a.project_id = NEW.project_id
     ) THEN
    RAISE EXCEPTION 'The allocation does not belong to this employee and project.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_entry_annotation_guard ON public.task_entries;
CREATE TRIGGER trg_task_entry_annotation_guard
  BEFORE INSERT OR UPDATE ON public.task_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_annotation_task_entry();

REVOKE ALL ON FUNCTION public.guard_annotation_task_entry() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Annotation project allocation is limited to annotation employees
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_annotation_allocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'ended' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = NEW.project_id AND pr.work_type = 'annotation')
     AND NOT public.is_annotation_assignable(NEW.user_id) THEN
    RAISE EXCEPTION 'Only active employees with the Annotation work type (full-time or intern, employee role) can be allocated to annotation projects.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_allocation_annotation_guard ON public.project_allocations;
CREATE TRIGGER trg_allocation_annotation_guard
  BEFORE INSERT OR UPDATE OF project_id, user_id, status ON public.project_allocations
  FOR EACH ROW EXECUTE FUNCTION public.guard_annotation_allocation();

REVOKE ALL ON FUNCTION public.guard_annotation_allocation() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_project_annotation_reclassification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.work_type = 'annotation'
     AND NEW.work_type IS DISTINCT FROM OLD.work_type
     AND EXISTS (
       SELECT 1 FROM public.project_allocations a
       WHERE a.project_id = NEW.id
         AND a.status <> 'ended'
         AND NOT public.is_annotation_assignable(a.user_id)
     ) THEN
    RAISE EXCEPTION 'This project has allocations for people who are not annotation employees. End or reassign them before classifying it as Annotation.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_annotation_reclassification ON public.projects;
CREATE TRIGGER trg_project_annotation_reclassification
  BEFORE UPDATE OF work_type ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_annotation_reclassification();

REVOKE ALL ON FUNCTION public.guard_project_annotation_reclassification() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Attendance status: hourly coverage only applies to annotation contributors
--    (managers / HR / engineering / operations are not marked "review required"
--    merely because they do not log annotation hours).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_attendance_status(_day_id uuid)
RETURNS attendance_status
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d public.attendance_days;
  m record;
  eod public.eod_reports;
  required int;
  worked int;
  hourly_expected boolean;
  caller uuid := auth.uid();
BEGIN
  SELECT * INTO d FROM public.attendance_days WHERE id = _day_id;
  IF NOT FOUND THEN RETURN 'absent'; END IF;

  IF caller IS NOT NULL AND NOT (
       d.user_id = caller
       OR public.has_permission(caller, 'attendance:read:all')
       OR (public.has_permission(caller, 'attendance:read:team') AND public.is_supervisor_of(d.user_id, caller))
     ) THEN
    RAISE EXCEPTION 'Not authorised to view this day.';
  END IF;

  IF d.exception_type = 'holiday'     THEN RETURN 'holiday';     END IF;
  IF d.exception_type = 'weekly_off'  THEN RETURN 'weekly_off';  END IF;
  IF d.exception_type = 'leave'       THEN RETURN 'on_leave';    END IF;

  SELECT * INTO eod FROM public.eod_reports WHERE day_id = _day_id;

  IF d.check_in_at IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.task_entries t WHERE t.day_id = _day_id) OR eod.id IS NOT NULL
      THEN RETURN 'review_required'; END IF;
    RETURN 'absent';
  END IF;

  IF d.check_out_at IS NULL THEN
    IF d.work_date < public.current_ist_date() THEN RETURN 'missed_check_out'; END IF;
    RETURN 'present_eod_pending';
  END IF;

  SELECT * INTO m FROM public.attendance_day_metrics(_day_id);
  required := GREATEST(d.required_minutes, 1);
  worked := m.worked_minutes;
  hourly_expected := EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = d.user_id AND p.work_type = 'annotation'
  );

  IF worked < (required * 0.5) THEN RETURN 'half_day'; END IF;
  IF hourly_expected AND worked > 0 AND m.uncovered_minutes > (worked * 0.25) THEN RETURN 'review_required'; END IF;
  IF m.unsubmitted_entries > 0 THEN RETURN 'review_required'; END IF;
  IF eod.id IS NULL OR eod.status = 'draft' THEN RETURN 'present_eod_pending'; END IF;
  IF worked + 15 < required THEN RETURN 'present_hours_incomplete'; END IF;

  RETURN 'present_complete';
END;
$function$;

NOTIFY pgrst, 'reload schema';

