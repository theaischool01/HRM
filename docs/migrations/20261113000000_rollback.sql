-- Rollback for 20261113000000_annotation_work_type_and_protected_accounts.sql
-- Review before running. Restores the pre-migration policies/functions.
-- Column drops are commented out so work-type assignments are not lost by accident.

DROP TRIGGER IF EXISTS trg_project_annotation_reclassification ON public.projects;
DROP TRIGGER IF EXISTS trg_allocation_annotation_guard ON public.project_allocations;
DROP TRIGGER IF EXISTS trg_task_entry_annotation_guard ON public.task_entries;
DROP TRIGGER IF EXISTS trg_profile_work_type_guard ON public.profiles;

DROP FUNCTION IF EXISTS public.guard_project_annotation_reclassification();
DROP FUNCTION IF EXISTS public.guard_annotation_allocation();
DROP FUNCTION IF EXISTS public.guard_annotation_task_entry();
DROP FUNCTION IF EXISTS public.guard_profile_work_type();

-- Restore P0 task policies
DROP POLICY IF EXISTS tasks_insert_self ON public.task_entries;
CREATE POLICY tasks_insert_self ON public.task_entries FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.has_permission(auth.uid(), 'tasks:log:self')
              AND public.can_log_work(auth.uid(), project_id));
DROP POLICY IF EXISTS tasks_update_self ON public.task_entries;
CREATE POLICY tasks_update_self ON public.task_entries FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status <> 'approved' AND public.has_permission(auth.uid(), 'tasks:log:self'))
  WITH CHECK (user_id = auth.uid() AND public.has_permission(auth.uid(), 'tasks:log:self'));

DROP FUNCTION IF EXISTS public.can_log_annotation_work(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.is_annotation_assignable(uuid);
DROP FUNCTION IF EXISTS public.is_annotation_contributor(uuid);

-- Remove protected-account privacy policies
DROP POLICY IF EXISTS profiles_protected_privacy_select ON public.profiles;
DROP POLICY IF EXISTS profiles_protected_privacy_update ON public.profiles;
DROP POLICY IF EXISTS user_roles_protected_privacy_select ON public.user_roles;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_days','break_logs','task_entries','eod_reports','blockers','documents']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_protected_privacy_select', t);
    END IF;
  END LOOP;
END $$;

-- Restore original profile_names()
CREATE OR REPLACE FUNCTION public.profile_names(_ids uuid[])
RETURNS TABLE(id uuid, full_name text, designation text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT p.id, p.full_name, p.designation
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

DROP FUNCTION IF EXISTS public.can_see_protected_identity(uuid, uuid);
DROP FUNCTION IF EXISTS public.is_protected_account(uuid);

-- derive_attendance_status: re-run the definition from
-- 20261111150000_p0_security_scoping_and_compliance.sql (section derive_attendance_status).

-- Optional, destructive (loses assignments):
-- ALTER TABLE public.projects DROP COLUMN IF EXISTS work_type;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS work_type_assigned_at;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS work_type_assigned_by;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS work_type;
-- DROP TYPE IF EXISTS public.work_type;

NOTIFY pgrst, 'reload schema';

