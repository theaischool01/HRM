-- Workforce roster ordering (presentation only).
--
-- Adds an owner-controlled display position so the current operational team can
-- be listed as Team #01..#10 WITHOUT renumbering permanent employee IDs
-- (employee_code), auth UUIDs or employee_id_sequence.
--
-- Status: PREPARED — NOT YET APPLIED. Requires owner approval (Phase C gate).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS roster_position smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_roster_position_positive'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_roster_position_positive
      CHECK (roster_position IS NULL OR roster_position BETWEEN 1 AND 999);
  END IF;
END $$;

-- At most one person per position.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_roster_position_key
  ON public.profiles (roster_position)
  WHERE roster_position IS NOT NULL;

COMMENT ON COLUMN public.profiles.roster_position IS
  'Display order of the current operational team (Team #01..). Presentation only; employee_code stays the permanent identifier.';

-- Self-update guard: identical to the existing definition
-- (20260820042744_*), plus roster_position so employees cannot reorder themselves.
CREATE OR REPLACE FUNCTION public.guard_profile_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE caller uuid := auth.uid();
BEGIN
  IF caller IS NULL OR public.has_permission(caller, 'workforce:update:all') THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'You cannot change this profile.';
  END IF;

  IF NEW.work_email IS DISTINCT FROM OLD.work_email
     OR NEW.employment_status IS DISTINCT FROM OLD.employment_status
     OR NEW.profile_verified_at IS DISTINCT FROM OLD.profile_verified_at
     OR NEW.profile_verified_by IS DISTINCT FROM OLD.profile_verified_by
     OR NEW.needs_assignment IS DISTINCT FROM OLD.needs_assignment
     OR NEW.department_id IS DISTINCT FROM OLD.department_id
     OR NEW.reporting_lead_id IS DISTINCT FROM OLD.reporting_lead_id
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.designation IS DISTINCT FROM OLD.designation
     OR NEW.employee_code IS DISTINCT FROM OLD.employee_code
     OR NEW.joining_date IS DISTINCT FROM OLD.joining_date
     OR NEW.last_working_day IS DISTINCT FROM OLD.last_working_day
     OR NEW.work_location IS DISTINCT FROM OLD.work_location
     OR NEW.roster_position IS DISTINCT FROM OLD.roster_position THEN
    RAISE EXCEPTION 'Only HR can change employment and verification details.';
  END IF;

  IF NEW.account_status IS DISTINCT FROM OLD.account_status
     AND NOT (
       (OLD.account_status = 'activated' AND NEW.account_status = 'profile_pending')
       OR (OLD.account_status = 'profile_pending' AND NEW.account_status = 'under_verification')
     ) THEN
    RAISE EXCEPTION 'You cannot change your account status.';
  END IF;

  IF NEW.account_status = 'under_verification'
     AND OLD.account_status = 'profile_pending'
     AND NEW.profile_submitted_at IS NULL THEN
    NEW.profile_submitted_at := now();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_profile_self_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_profile_self_update() TO service_role;
