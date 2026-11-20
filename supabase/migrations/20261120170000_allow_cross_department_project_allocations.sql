-- Migration: 20261120170000_allow_cross_department_project_allocations.sql
-- Description: Enable cross-department project allocation for Managers while preserving
--              strict specialized hourly annotation logging protections.
--
-- Background:
-- 1. Previously, `trg_allocation_annotation_guard` (via `guard_annotation_allocation()`)
--    enforced that only active employees with `work_type = 'annotation'` could be
--    allocated to annotation projects.
-- 2. Approved Business Rule: Project membership is now decoupled from work type.
--    Managers can allocate eligible employees from ANY department or work type
--    (e.g., Engineering, Operations, HR) to any project they manage (including Annotation).
-- 3. Safety & Boundary Invariant:
--    - An employee allocated across work types does NOT automatically become an Annotation contributor.
--    - Hourly production task entries (`task_entries`) remain 100% guarded by `guard_annotation_task_entry()`,
--      `can_log_annotation_work()`, and RLS `tasks_insert_self`, which strictly require
--      `is_annotation_contributor()` (`work_type = 'annotation'`).
--    - System Administrator (protected) accounts are NEVER allocatable to projects.
--    - Only active employees (`employment_status = 'active'`) can receive new allocations.

-- 1. Replace the legacy allocation annotation guard with a universal project allocation guard
CREATE OR REPLACE FUNCTION public.guard_project_allocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'ended' THEN
    RETURN NEW;
  END IF;

  -- Invariant: Protected system-owner accounts can never be allocated to projects
  IF public.is_protected_account(NEW.user_id) THEN
    RAISE EXCEPTION 'System administrator accounts cannot be allocated to projects.'
      USING ERRCODE = '42501';
  END IF;

  -- Invariant: Exited or terminated employees cannot receive active project allocations
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = NEW.user_id AND p.employment_status = 'active'
  ) THEN
    RAISE EXCEPTION 'Only active employees can be allocated to projects.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- Drop legacy trigger and attach new universal guard
DROP TRIGGER IF EXISTS trg_allocation_annotation_guard ON public.project_allocations;
DROP TRIGGER IF EXISTS trg_allocation_guard ON public.project_allocations;
CREATE TRIGGER trg_allocation_guard
  BEFORE INSERT OR UPDATE OF project_id, user_id, status ON public.project_allocations
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_allocation();

REVOKE ALL ON FUNCTION public.guard_project_allocation() FROM PUBLIC, anon, authenticated;

-- 2. Drop the project reclassification block that prevented projects with non-annotation members
--    from being classified as Annotation
DROP TRIGGER IF EXISTS trg_project_annotation_reclassification ON public.projects;
DROP FUNCTION IF EXISTS public.guard_project_annotation_reclassification();

-- 3. Note: public.guard_annotation_task_entry() on public.task_entries is UNCHANGED.
--    Hourly production entries continue to require public.can_log_annotation_work(),
--    guaranteeing that non-annotation members allocated to Annotation projects CANNOT
--    log hourly annotation task entries.
