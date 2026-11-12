-- ============================================================================
-- Migration: Phase P0 Security, Scoping, Escalation Reviews & IST Compliance
-- Safe, additive & reversible hardening migration — preserves all user data.
-- Covers:
--   1. Founder strict read-only enforcement (permissions + RLS + trigger guard)
--   2. Scoped reporting & Manager department/project/team isolation (removes :all)
--   3. Operational escalation reviews (Super Admin, Admin, scoped Manager)
--   4. Hardened can_actor_assign_role (blocks peer-HR & Admin->HR/Admin tampering)
--   5. Restricted employee_id_sequence & claim/peek RPCs
--   6. Sensitive KYC/financial document protection (Owner + HR + Super Admin only)
--   7. IST (Asia/Kolkata) calendar-date helpers for attendance & capacity RPCs
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. IST Date Helper (Asia/Kolkata)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_ist_date()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date;
$$;

REVOKE ALL ON FUNCTION public.current_ist_date() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_ist_date() TO authenticated, service_role;

ALTER TABLE public.attendance_days
  ALTER COLUMN work_date SET DEFAULT public.current_ist_date();

ALTER TABLE public.project_allocations
  ALTER COLUMN start_date SET DEFAULT public.current_ist_date();

-- ----------------------------------------------------------------------------
-- 1. New Scoped Permissions Catalogue Entries
-- ----------------------------------------------------------------------------
INSERT INTO public.permissions (key, resource, action, scope, description) VALUES
  ('workforce:update:self', 'workforce', 'update', 'self', 'Edit own personal contact and onboarding fields'),
  ('projects:manage:team', 'projects', 'manage', 'team', 'Create and edit projects within assigned departments or projects'),
  ('allocations:manage:team', 'allocations', 'manage', 'team', 'Manage allocations on projects within assigned scope'),
  ('reports:export:scoped', 'reports', 'export', 'scoped', 'View and export attendance and productivity reports within authorized scope')
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description;

-- Super Admin holds every permission in the catalogue
INSERT INTO public.role_permissions (role, permission_key)
SELECT 'super_admin'::public.app_role, key
FROM public.permissions
ON CONFLICT (role, permission_key) DO NOTHING;

-- Self profile updates allowed for operational roles, NOT Founder (strict read-only)
INSERT INTO public.role_permissions (role, permission_key)
SELECT r.role, 'workforce:update:self'
FROM (VALUES
  ('super_admin'::public.app_role),
  ('hr'::public.app_role),
  ('admin'::public.app_role),
  ('manager'::public.app_role),
  ('lead'::public.app_role),
  ('employee'::public.app_role)
) AS r(role)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Scoped report viewing & CSV/XLSX export for Super Admin, Founder, HR, Admin, Manager
INSERT INTO public.role_permissions (role, permission_key)
SELECT r.role, 'reports:export:scoped'
FROM (VALUES
  ('super_admin'::public.app_role),
  ('founder'::public.app_role),
  ('hr'::public.app_role),
  ('admin'::public.app_role),
  ('manager'::public.app_role)
) AS r(role)
ON CONFLICT (role, permission_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Founder Read-Only Cleanup (Item 1 & Item 2)
-- ----------------------------------------------------------------------------
DELETE FROM public.role_permissions
WHERE role = 'founder'
  AND permission_key IN (
    'workforce:create:all',
    'workforce:update:all',
    'workforce:update:self',
    'workforce:deactivate:all',
    'documents:upload:self',
    'documents:verify:all',
    'documents:read:all',
    'documents:read:team',
    'invitations:create:all',
    'rbac:manage:all',
    'rbac:assign:all',
    'org:manage:all',
    'projects:manage:all',
    'projects:manage:team',
    'allocations:manage:all',
    'allocations:manage:team',
    'allocations:acknowledge:self',
    'attendance:log:self',
    'attendance:update:all',
    'tasks:log:self',
    'tasks:review:team',
    'blockers:raise:self',
    'blockers:manage:team',
    'eod:submit:self',
    'eod:review:team',
    'requests:submit:self',
    'requests:approve:lead',
    'requests:approve:hr',
    'announcements:manage:all',
    'automation:run:all',
    'import:manage:all'
  );

-- Ensure Founder retains full read-only oversight & reporting permissions
INSERT INTO public.role_permissions (role, permission_key)
SELECT 'founder'::public.app_role, p.key
FROM public.permissions p
WHERE p.key IN (
  'workforce:read:self',
  'workforce:read:team',
  'workforce:read:all',
  'documents:read:self',
  'invitations:read:all',
  'audit:read:all',
  'projects:read:all',
  'allocations:read:all',
  'attendance:read:self',
  'attendance:read:team',
  'attendance:read:all',
  'tasks:read:team',
  'tasks:read:all',
  'eod:read:team',
  'eod:read:all',
  'requests:read:self',
  'requests:read:team',
  'requests:read:all',
  'announcements:read:all',
  'analytics:read:team',
  'analytics:read:all',
  'reports:export:scoped'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Fix guard_attendance_self_update: require attendance:update:all (NOT attendance:read:all!)
CREATE OR REPLACE FUNCTION public.guard_attendance_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE caller uuid := auth.uid();
BEGIN
  IF caller IS NULL OR public.has_permission(caller, 'attendance:update:all') THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.work_date IS DISTINCT FROM OLD.work_date
     OR NEW.exception_type IS DISTINCT FROM OLD.exception_type
     OR NEW.exception_note IS DISTINCT FROM OLD.exception_note
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id THEN
    RAISE EXCEPTION 'Only an administrator can change these attendance details.';
  END IF;

  IF NEW.required_minutes IS DISTINCT FROM OLD.required_minutes AND OLD.check_in_at IS NOT NULL THEN
    RAISE EXCEPTION 'Required hours cannot be changed after check-in.';
  END IF;

  IF OLD.check_in_at IS NOT NULL AND (
       NEW.location_status IS DISTINCT FROM OLD.location_status
       OR NEW.location_latitude IS DISTINCT FROM OLD.location_latitude
       OR NEW.location_longitude IS DISTINCT FROM OLD.location_longitude
       OR NEW.location_accuracy_m IS DISTINCT FROM OLD.location_accuracy_m
       OR NEW.location_distance_m IS DISTINCT FROM OLD.location_distance_m
       OR NEW.office_location_id IS DISTINCT FROM OLD.office_location_id
     ) THEN
    RAISE EXCEPTION 'Check-in location evidence cannot be changed after check-in.';
  END IF;

  RETURN NEW;
END;
$function$;

-- Enforce explicit :self write permissions on all self-mutation RLS policies
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
FOR UPDATE TO authenticated
USING (id = auth.uid() AND public.has_permission(auth.uid(), 'workforce:update:self'))
WITH CHECK (id = auth.uid() AND public.has_permission(auth.uid(), 'workforce:update:self'));

DROP POLICY IF EXISTS allocations_update_self_ack ON public.project_allocations;
CREATE POLICY allocations_update_self_ack ON public.project_allocations
FOR UPDATE TO authenticated
USING (user_id = auth.uid() AND public.has_permission(auth.uid(), 'allocations:acknowledge:self'))
WITH CHECK (user_id = auth.uid() AND public.has_permission(auth.uid(), 'allocations:acknowledge:self'));

DROP POLICY IF EXISTS attendance_update_self ON public.attendance_days;
CREATE POLICY attendance_update_self ON public.attendance_days
FOR UPDATE TO authenticated
USING (user_id = auth.uid() AND public.has_permission(auth.uid(), 'attendance:log:self'))
WITH CHECK (user_id = auth.uid() AND public.has_permission(auth.uid(), 'attendance:log:self'));

DROP POLICY IF EXISTS tasks_update_self ON public.task_entries;
CREATE POLICY tasks_update_self ON public.task_entries
FOR UPDATE TO authenticated
USING (user_id = auth.uid() AND status <> 'approved' AND public.has_permission(auth.uid(), 'tasks:log:self'))
WITH CHECK (user_id = auth.uid() AND public.has_permission(auth.uid(), 'tasks:log:self'));

DROP POLICY IF EXISTS tasks_delete_self ON public.task_entries;
CREATE POLICY tasks_delete_self ON public.task_entries
FOR DELETE TO authenticated
USING (
  user_id = auth.uid()
  AND status IN ('draft', 'revision_required')
  AND public.has_permission(auth.uid(), 'tasks:log:self')
);

DROP POLICY IF EXISTS breaks_update_self ON public.break_logs;
CREATE POLICY breaks_update_self ON public.break_logs
FOR UPDATE TO authenticated
USING (user_id = auth.uid() AND public.has_permission(auth.uid(), 'attendance:log:self'))
WITH CHECK (user_id = auth.uid() AND public.has_permission(auth.uid(), 'attendance:log:self'));

DROP POLICY IF EXISTS breaks_delete_self ON public.break_logs;
CREATE POLICY breaks_delete_self ON public.break_logs
FOR DELETE TO authenticated
USING (user_id = auth.uid() AND public.has_permission(auth.uid(), 'attendance:log:self'));

DROP POLICY IF EXISTS blockers_update_self ON public.blockers;
CREATE POLICY blockers_update_self ON public.blockers
FOR UPDATE TO authenticated
USING (user_id = auth.uid() AND public.has_permission(auth.uid(), 'blockers:raise:self'))
WITH CHECK (user_id = auth.uid() AND public.has_permission(auth.uid(), 'blockers:raise:self'));

DROP POLICY IF EXISTS blockers_delete_self ON public.blockers;
CREATE POLICY blockers_delete_self ON public.blockers
FOR DELETE TO authenticated
USING (user_id = auth.uid() AND status = 'open' AND public.has_permission(auth.uid(), 'blockers:raise:self'));

DROP POLICY IF EXISTS eod_update_self ON public.eod_reports;
CREATE POLICY eod_update_self ON public.eod_reports
FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  AND status IN ('draft', 'submitted', 'revision_required')
  AND public.has_permission(auth.uid(), 'eod:submit:self')
)
WITH CHECK (user_id = auth.uid() AND public.has_permission(auth.uid(), 'eod:submit:self'));

DROP POLICY IF EXISTS eod_delete_self ON public.eod_reports;
CREATE POLICY eod_delete_self ON public.eod_reports
FOR DELETE TO authenticated
USING (user_id = auth.uid() AND status = 'draft' AND public.has_permission(auth.uid(), 'eod:submit:self'));

DROP POLICY IF EXISTS requests_update_self_pending ON public.requests;
CREATE POLICY requests_update_self_pending ON public.requests
FOR UPDATE TO authenticated
USING (user_id = auth.uid() AND status = 'pending' AND public.has_permission(auth.uid(), 'requests:submit:self'))
WITH CHECK (user_id = auth.uid() AND public.has_permission(auth.uid(), 'requests:submit:self'));

-- ----------------------------------------------------------------------------
-- 3. Manager Explicit Department / Project / Team Scoping (Item 3)
-- ----------------------------------------------------------------------------
-- Remove ALL temporary organization-wide :all permissions (except announcements:read:all) from Manager
DELETE FROM public.role_permissions
WHERE role = 'manager'
  AND permission_key IN (
    'workforce:read:all',
    'documents:read:team',
    'documents:read:all',
    'projects:read:all',
    'projects:manage:all',
    'allocations:read:all',
    'allocations:manage:all',
    'attendance:read:all',
    'tasks:read:all',
    'eod:read:all',
    'requests:read:all',
    'analytics:read:all'
  );

-- Grant Manager strictly scoped permissions
INSERT INTO public.role_permissions (role, permission_key)
SELECT 'manager'::public.app_role, p.key
FROM public.permissions p
WHERE p.key IN (
  'workforce:read:self',
  'workforce:read:team',
  'workforce:update:self',
  'documents:read:self',
  'documents:upload:self',
  'projects:read:team',
  'projects:manage:team',
  'allocations:read:team',
  'allocations:manage:team',
  'allocations:acknowledge:self',
  'attendance:log:self',
  'attendance:read:self',
  'attendance:read:team',
  'tasks:log:self',
  'tasks:read:team',
  'tasks:review:team',
  'blockers:raise:self',
  'blockers:manage:team',
  'eod:submit:self',
  'eod:read:team',
  'eod:review:team',
  'requests:submit:self',
  'requests:read:self',
  'requests:read:team',
  'requests:approve:lead',
  'announcements:read:all',
  'analytics:read:team',
  'reports:export:scoped'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Explicit Department <-> Manager assignment table
CREATE TABLE IF NOT EXISTS public.department_managers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  manager_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, manager_id)
);

CREATE INDEX IF NOT EXISTS idx_department_managers_manager ON public.department_managers(manager_id);
CREATE INDEX IF NOT EXISTS idx_department_managers_dept ON public.department_managers(department_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.department_managers TO authenticated;
GRANT ALL ON public.department_managers TO service_role;
ALTER TABLE public.department_managers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS department_managers_read ON public.department_managers;
CREATE POLICY department_managers_read ON public.department_managers
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS department_managers_write ON public.department_managers;
CREATE POLICY department_managers_write ON public.department_managers
FOR ALL TO authenticated
USING (
  public.has_permission(auth.uid(), 'org:manage:all')
  OR public.has_permission(auth.uid(), 'workforce:update:all')
)
WITH CHECK (
  public.has_permission(auth.uid(), 'org:manage:all')
  OR public.has_permission(auth.uid(), 'workforce:update:all')
);

-- Add optional department_id and project_manager_id to projects for scoped Manager ownership
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_manager_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_department ON public.projects(department_id);
CREATE INDEX IF NOT EXISTS idx_projects_manager ON public.projects(project_manager_id);

-- Scoping helper: is _user_id explicitly assigned as Manager of _department_id?
CREATE OR REPLACE FUNCTION public.is_department_manager(_department_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _department_id IS NOT NULL
     AND _user_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.department_managers dm
       WHERE dm.department_id = _department_id
         AND dm.manager_id = _user_id
     );
$$;

-- Scoping helper: is _viewer an assigned Manager over _owner (via dept, project, direct report, or Lead tree)?
CREATE OR REPLACE FUNCTION public.is_manager_of(_owner uuid, _viewer uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _owner IS NOT NULL
     AND _viewer IS NOT NULL
     AND _owner <> _viewer
     AND public.has_role(_viewer, 'manager')
     AND (
       -- 1. Owner belongs to a department managed by _viewer, or reports directly to _viewer
       EXISTS (
         SELECT 1
         FROM public.profiles p
         LEFT JOIN public.profiles lead_p ON lead_p.id = p.reporting_lead_id
         WHERE p.id = _owner
           AND (
             public.is_department_manager(p.department_id, _viewer)
             OR p.reporting_lead_id = _viewer
             -- 2. 2-hop hierarchy: Owner reports to a Lead who reports to _viewer or is in _viewer's department
             OR lead_p.reporting_lead_id = _viewer
             OR public.is_department_manager(lead_p.department_id, _viewer)
           )
       )
       -- 3. Owner has a non-ended allocation on a project managed by _viewer or in _viewer's department
       OR EXISTS (
         SELECT 1
         FROM public.project_allocations a
         JOIN public.projects pr ON pr.id = a.project_id
         WHERE a.user_id = _owner
           AND a.status <> 'ended'
           AND (
             pr.project_manager_id = _viewer
             OR public.is_department_manager(pr.department_id, _viewer)
             OR public.is_project_lead(pr.id, _viewer)
           )
       )
     );
$$;

-- Unified supervisor check (Lead OR scoped Manager)
CREATE OR REPLACE FUNCTION public.is_supervisor_of(_owner uuid, _viewer uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_work_lead_of(_owner, _viewer)
      OR public.is_manager_of(_owner, _viewer);
$$;

-- Scoped project management check (org-wide projects:manage:all OR scoped Manager)
CREATE OR REPLACE FUNCTION public.can_manage_project(_project_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _project_id IS NOT NULL
     AND _user_id IS NOT NULL
     AND (
       public.has_permission(_user_id, 'projects:manage:all')
       OR (
         public.has_permission(_user_id, 'projects:manage:team')
         AND EXISTS (
           SELECT 1
           FROM public.projects p
           WHERE p.id = _project_id
             AND (
               p.project_manager_id = _user_id
               OR public.is_department_manager(p.department_id, _user_id)
             )
         )
       )
     );
$$;

-- Update can_view_project to include scoped Manager visibility
CREATE OR REPLACE FUNCTION public.can_view_project(_project_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_permission(_user_id, 'projects:read:all')
      OR (
        public.has_permission(_user_id, 'projects:read:team')
        AND (
          public.is_project_lead(_project_id, _user_id)
          OR EXISTS (
            SELECT 1
            FROM public.projects p
            WHERE p.id = _project_id
              AND (
                p.project_manager_id = _user_id
                OR public.is_department_manager(p.department_id, _user_id)
              )
          )
        )
      )
      OR public.is_allocated_to_project(_project_id, _user_id);
$$;

-- Operational review & escalation helper (Item 4):
-- Never allows self-review; allows direct Lead, scoped Manager, Admin, or Super Admin.
CREATE OR REPLACE FUNCTION public.can_review_subordinate_or_escalate(_subject_user_id uuid, _reviewer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _subject_user_id IS NOT NULL
     AND _reviewer_id IS NOT NULL
     AND _subject_user_id <> _reviewer_id
     AND (
       public.is_supervisor_of(_subject_user_id, _reviewer_id)
       OR public.has_role(_reviewer_id, 'super_admin')
       OR public.has_role(_reviewer_id, 'admin')
     );
$$;

REVOKE ALL ON FUNCTION public.is_department_manager(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_manager_of(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_supervisor_of(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_project(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_project(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_review_subordinate_or_escalate(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_department_manager(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_manager_of(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_supervisor_of(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_project(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_project(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_review_subordinate_or_escalate(uuid, uuid) TO authenticated, service_role;

-- Update allocation acknowledgment guard to recognize scoped project managers
CREATE OR REPLACE FUNCTION public.guard_allocation_acknowledgment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  manager boolean := false;
BEGIN
  IF caller IS NULL THEN
    RETURN NEW;
  END IF;

  manager := public.has_permission(caller, 'allocations:manage:all')
          OR (
            public.has_permission(caller, 'allocations:manage:team')
            AND public.can_manage_project(NEW.project_id, caller)
          );

  IF NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at THEN
    IF OLD.acknowledged_at IS NOT NULL THEN
      RAISE EXCEPTION 'An acknowledgment cannot be changed once recorded.';
    END IF;
    IF caller <> NEW.user_id OR NEW.acknowledged_by IS DISTINCT FROM caller THEN
      RAISE EXCEPTION 'Only the assigned person can acknowledge this allocation.';
    END IF;
  END IF;

  IF NEW.acknowledged_by IS DISTINCT FROM OLD.acknowledged_by
     AND NEW.acknowledged_by IS DISTINCT FROM caller THEN
    RAISE EXCEPTION 'Only the assigned person can acknowledge this allocation.';
  END IF;

  IF NOT manager THEN
    IF caller <> OLD.user_id THEN
      RAISE EXCEPTION 'You cannot modify this allocation.';
    END IF;
    IF NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.reporting_lead_id IS DISTINCT FROM OLD.reporting_lead_id
       OR NEW.role_in_project IS DISTINCT FROM OLD.role_in_project
       OR NEW.start_date IS DISTINCT FROM OLD.start_date
       OR NEW.end_date IS DISTINCT FROM OLD.end_date
       OR NEW.hours_per_day IS DISTINCT FROM OLD.hours_per_day
       OR NEW.allocation_pct IS DISTINCT FROM OLD.allocation_pct
       OR NEW.daily_task_target IS DISTINCT FROM OLD.daily_task_target
       OR NEW.quality_target_pct IS DISTINCT FROM OLD.quality_target_pct
       OR NEW.max_rejection_rate_pct IS DISTINCT FROM OLD.max_rejection_rate_pct
       OR NEW.allocated_by IS DISTINCT FROM OLD.allocated_by
       OR NEW.over_allocation_override IS DISTINCT FROM OLD.over_allocation_override THEN
      RAISE EXCEPTION 'You can only acknowledge this allocation, not change its terms.';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'pending_acknowledgment' AND NEW.status = 'active') THEN
      RAISE EXCEPTION 'You cannot change the status of this allocation.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Update RLS policies for Manager scoping & Escalation reviews (Items 3 & 4)
DROP POLICY IF EXISTS profiles_select_team ON public.profiles;
CREATE POLICY profiles_select_team ON public.profiles
FOR SELECT TO authenticated
USING (
  public.has_permission(auth.uid(), 'workforce:read:team')
  AND public.is_supervisor_of(id, auth.uid())
);

DROP POLICY IF EXISTS user_roles_select_team ON public.user_roles;
CREATE POLICY user_roles_select_team ON public.user_roles
FOR SELECT TO authenticated
USING (
  public.has_permission(auth.uid(), 'workforce:read:team')
  AND public.is_supervisor_of(user_id, auth.uid())
);

DROP POLICY IF EXISTS projects_insert ON public.projects;
CREATE POLICY projects_insert ON public.projects
FOR INSERT TO authenticated
WITH CHECK (
  public.has_permission(auth.uid(), 'projects:manage:all')
  OR (
    public.has_permission(auth.uid(), 'projects:manage:team')
    AND (
      project_manager_id = auth.uid()
      OR public.is_department_manager(department_id, auth.uid())
    )
  )
);

DROP POLICY IF EXISTS projects_update ON public.projects;
CREATE POLICY projects_update ON public.projects
FOR UPDATE TO authenticated
USING (public.can_manage_project(id, auth.uid()))
WITH CHECK (
  public.has_permission(auth.uid(), 'projects:manage:all')
  OR (
    public.has_permission(auth.uid(), 'projects:manage:team')
    AND (
      project_manager_id = auth.uid()
      OR public.is_department_manager(department_id, auth.uid())
    )
  )
);

DROP POLICY IF EXISTS ptl_insert ON public.project_team_leads;
CREATE POLICY ptl_insert ON public.project_team_leads
FOR INSERT TO authenticated
WITH CHECK (public.can_manage_project(project_id, auth.uid()));

DROP POLICY IF EXISTS ptl_update ON public.project_team_leads;
CREATE POLICY ptl_update ON public.project_team_leads
FOR UPDATE TO authenticated
USING (public.can_manage_project(project_id, auth.uid()))
WITH CHECK (public.can_manage_project(project_id, auth.uid()));

DROP POLICY IF EXISTS ptl_delete ON public.project_team_leads;
CREATE POLICY ptl_delete ON public.project_team_leads
FOR DELETE TO authenticated
USING (public.can_manage_project(project_id, auth.uid()));

DROP POLICY IF EXISTS allocations_select_team ON public.project_allocations;
CREATE POLICY allocations_select_team ON public.project_allocations
FOR SELECT TO authenticated
USING (
  public.has_permission(auth.uid(), 'allocations:read:team')
  AND (
    reporting_lead_id = auth.uid()
    OR public.is_project_lead(project_id, auth.uid())
    OR public.can_manage_project(project_id, auth.uid())
    OR public.is_supervisor_of(user_id, auth.uid())
  )
);

DROP POLICY IF EXISTS allocations_insert_manage ON public.project_allocations;
CREATE POLICY allocations_insert_manage ON public.project_allocations
FOR INSERT TO authenticated
WITH CHECK (
  public.has_permission(auth.uid(), 'allocations:manage:all')
  OR (
    public.has_permission(auth.uid(), 'allocations:manage:team')
    AND public.can_manage_project(project_id, auth.uid())
  )
);

DROP POLICY IF EXISTS allocations_update_manage ON public.project_allocations;
CREATE POLICY allocations_update_manage ON public.project_allocations
FOR UPDATE TO authenticated
USING (
  public.has_permission(auth.uid(), 'allocations:manage:all')
  OR (
    public.has_permission(auth.uid(), 'allocations:manage:team')
    AND public.can_manage_project(project_id, auth.uid())
  )
)
WITH CHECK (
  public.has_permission(auth.uid(), 'allocations:manage:all')
  OR (
    public.has_permission(auth.uid(), 'allocations:manage:team')
    AND public.can_manage_project(project_id, auth.uid())
  )
);

DROP POLICY IF EXISTS allocations_delete_manage ON public.project_allocations;
CREATE POLICY allocations_delete_manage ON public.project_allocations
FOR DELETE TO authenticated
USING (
  public.has_permission(auth.uid(), 'allocations:manage:all')
  OR (
    public.has_permission(auth.uid(), 'allocations:manage:team')
    AND public.can_manage_project(project_id, auth.uid())
  )
);

DROP POLICY IF EXISTS attendance_select_team ON public.attendance_days;
CREATE POLICY attendance_select_team ON public.attendance_days
FOR SELECT TO authenticated
USING (
  public.has_permission(auth.uid(), 'attendance:read:team')
  AND public.is_supervisor_of(user_id, auth.uid())
);

DROP POLICY IF EXISTS tasks_select_team ON public.task_entries;
CREATE POLICY tasks_select_team ON public.task_entries
FOR SELECT TO authenticated
USING (
  public.has_permission(auth.uid(), 'tasks:read:team')
  AND public.is_supervisor_of(user_id, auth.uid())
);

DROP POLICY IF EXISTS tasks_update_reviewer ON public.task_entries;
CREATE POLICY tasks_update_reviewer ON public.task_entries
FOR UPDATE TO authenticated
USING (
  user_id <> auth.uid()
  AND public.has_permission(auth.uid(), 'tasks:review:team')
  AND public.can_review_subordinate_or_escalate(user_id, auth.uid())
)
WITH CHECK (
  user_id <> auth.uid()
  AND public.has_permission(auth.uid(), 'tasks:review:team')
  AND public.can_review_subordinate_or_escalate(user_id, auth.uid())
);

DROP POLICY IF EXISTS breaks_select_team ON public.break_logs;
CREATE POLICY breaks_select_team ON public.break_logs
FOR SELECT TO authenticated
USING (
  (public.has_permission(auth.uid(), 'attendance:read:team') AND public.is_supervisor_of(user_id, auth.uid()))
  OR public.has_permission(auth.uid(), 'attendance:read:all')
);

DROP POLICY IF EXISTS blockers_select_team ON public.blockers;
CREATE POLICY blockers_select_team ON public.blockers
FOR SELECT TO authenticated
USING (
  (public.has_permission(auth.uid(), 'blockers:manage:team') AND public.is_supervisor_of(user_id, auth.uid()))
  OR public.has_permission(auth.uid(), 'tasks:read:all')
);

DROP POLICY IF EXISTS blockers_update_lead ON public.blockers;
CREATE POLICY blockers_update_lead ON public.blockers
FOR UPDATE TO authenticated
USING (
  user_id <> auth.uid()
  AND public.has_permission(auth.uid(), 'blockers:manage:team')
  AND (
    notified_lead_id = auth.uid()
    OR public.can_review_subordinate_or_escalate(user_id, auth.uid())
  )
)
WITH CHECK (
  user_id <> auth.uid()
  AND public.has_permission(auth.uid(), 'blockers:manage:team')
);

DROP POLICY IF EXISTS eod_select_team ON public.eod_reports;
CREATE POLICY eod_select_team ON public.eod_reports
FOR SELECT TO authenticated
USING (
  public.has_permission(auth.uid(), 'eod:read:team')
  AND public.is_supervisor_of(user_id, auth.uid())
);

DROP POLICY IF EXISTS eod_update_reviewer ON public.eod_reports;
CREATE POLICY eod_update_reviewer ON public.eod_reports
FOR UPDATE TO authenticated
USING (
  user_id <> auth.uid()
  AND public.has_permission(auth.uid(), 'eod:review:team')
  AND public.can_review_subordinate_or_escalate(user_id, auth.uid())
)
WITH CHECK (
  user_id <> auth.uid()
  AND public.has_permission(auth.uid(), 'eod:review:team')
  AND public.can_review_subordinate_or_escalate(user_id, auth.uid())
);

DROP POLICY IF EXISTS requests_select_team ON public.requests;
CREATE POLICY requests_select_team ON public.requests
FOR SELECT TO authenticated
USING (
  public.has_permission(auth.uid(), 'requests:read:team')
  AND public.is_supervisor_of(user_id, auth.uid())
);

DROP POLICY IF EXISTS requests_update_approver ON public.requests;
CREATE POLICY requests_update_approver ON public.requests
FOR UPDATE TO authenticated
USING (
  user_id <> auth.uid()
  AND (
    public.has_permission(auth.uid(), 'requests:approve:hr')
    OR (
      public.has_permission(auth.uid(), 'requests:approve:lead')
      AND public.can_review_subordinate_or_escalate(user_id, auth.uid())
    )
  )
)
WITH CHECK (
  user_id <> auth.uid()
  AND (
    public.has_permission(auth.uid(), 'requests:approve:hr')
    OR (
      public.has_permission(auth.uid(), 'requests:approve:lead')
      AND public.can_review_subordinate_or_escalate(user_id, auth.uid())
    )
  )
);

DROP POLICY IF EXISTS request_approvals_select ON public.request_approvals;
CREATE POLICY request_approvals_select ON public.request_approvals
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.requests r
    WHERE r.id = request_id
      AND (
        r.user_id = auth.uid()
        OR public.has_permission(auth.uid(), 'requests:read:all')
        OR (public.has_permission(auth.uid(), 'requests:read:team') AND public.is_supervisor_of(r.user_id, auth.uid()))
        OR approver_id = auth.uid()
      )
  )
);

DROP POLICY IF EXISTS request_approvals_update_lead ON public.request_approvals;
CREATE POLICY request_approvals_update_lead ON public.request_approvals
FOR UPDATE TO authenticated
USING (
  tier = 'lead'
  AND public.has_permission(auth.uid(), 'requests:approve:lead')
  AND EXISTS (
    SELECT 1
    FROM public.requests r
    WHERE r.id = request_id
      AND r.user_id <> auth.uid()
      AND (
        approver_id = auth.uid()
        OR public.can_review_subordinate_or_escalate(r.user_id, auth.uid())
      )
  )
)
WITH CHECK (
  tier = 'lead'
  AND EXISTS (
    SELECT 1
    FROM public.requests r
    WHERE r.id = request_id
      AND r.user_id <> auth.uid()
  )
);

DROP POLICY IF EXISTS request_approvals_update_hr ON public.request_approvals;
CREATE POLICY request_approvals_update_hr ON public.request_approvals
FOR UPDATE TO authenticated
USING (
  tier = 'hr'
  AND public.has_permission(auth.uid(), 'requests:approve:hr')
  AND EXISTS (
    SELECT 1
    FROM public.requests r
    WHERE r.id = request_id
      AND r.user_id <> auth.uid()
  )
)
WITH CHECK (
  tier = 'hr'
  AND EXISTS (
    SELECT 1
    FROM public.requests r
    WHERE r.id = request_id
      AND r.user_id <> auth.uid()
  )
);

DROP POLICY IF EXISTS review_events_select ON public.review_events;
CREATE POLICY review_events_select ON public.review_events
FOR SELECT TO authenticated
USING (
  subject_user_id = auth.uid()
  OR reviewer_id = auth.uid()
  OR public.has_permission(auth.uid(), 'tasks:read:all')
  OR public.has_permission(auth.uid(), 'eod:read:all')
  OR (public.has_permission(auth.uid(), 'tasks:review:team') AND public.is_supervisor_of(subject_user_id, auth.uid()))
);

DROP POLICY IF EXISTS automation_flags_read_team ON public.automation_flags;
CREATE POLICY automation_flags_read_team ON public.automation_flags
FOR SELECT TO authenticated
USING (
  public.has_permission(auth.uid(), 'attendance:read:team')
  AND public.is_supervisor_of(user_id, auth.uid())
);

-- Update SECURITY DEFINER RPCs for supervisor scoping & IST calendar dates
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
  e := COALESCE(d.check_out_at, GREATEST(d.check_in_at, now()));

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
  ), c AS (SELECT kind, st, en FROM iv WHERE en > st),
  ordered AS (
    SELECT st, en, MAX(en) OVER (ORDER BY st ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) prev_max
      FROM c
  ), grp AS (
    SELECT st, en, SUM(CASE WHEN prev_max IS NULL OR st > prev_max THEN 1 ELSE 0 END)
                     OVER (ORDER BY st ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) g
      FROM ordered
  ), merged AS (
    SELECT MIN(st) st, MAX(en) en FROM grp GROUP BY g
  )
  SELECT
    (EXTRACT(EPOCH FROM (e - s)) / 60)::int,
    COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (en - st)) / 60) FROM c WHERE kind = 'task'), 0)::int,
    COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (en - st)) / 60) FROM c WHERE kind = 'break'), 0)::int,
    COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (en - st)) / 60) FROM c WHERE kind = 'blocker'), 0)::int,
    COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (en - st)) / 60) FROM merged), 0)::int,
    GREATEST((EXTRACT(EPOCH FROM (e - s)) / 60)::int
             - COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (en - st)) / 60) FROM merged), 0)::int, 0),
    COALESCE((SELECT SUM(t.units_completed) FROM public.task_entries t WHERE t.day_id = _day_id), 0),
    (SELECT COUNT(*) FROM public.task_entries t WHERE t.day_id = _day_id)::int,
    (SELECT COUNT(*) FROM public.task_entries t WHERE t.day_id = _day_id AND t.status = 'draft')::int;
END;
$function$;

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

  IF worked < (required * 0.5) THEN RETURN 'half_day'; END IF;
  IF worked > 0 AND m.uncovered_minutes > (worked * 0.25) THEN RETURN 'review_required'; END IF;
  IF m.unsubmitted_entries > 0 THEN RETURN 'review_required'; END IF;
  IF eod.id IS NULL OR eod.status = 'draft' THEN RETURN 'present_eod_pending'; END IF;
  IF worked + 15 < required THEN RETURN 'present_hours_incomplete'; END IF;

  RETURN 'present_complete';
END;
$function$;

CREATE OR REPLACE FUNCTION public.day_targets(_day_id uuid)
RETURNS TABLE(
  project_code text,
  hourly_task_target numeric,
  daily_task_target numeric,
  quality_target_pct numeric,
  max_rejection_rate_pct numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE owner uuid;
BEGIN
  SELECT d.user_id INTO owner FROM public.attendance_days d WHERE d.id = _day_id;
  IF owner IS NULL THEN RETURN; END IF;

  IF NOT (
       owner = auth.uid()
       OR public.has_permission(auth.uid(), 'attendance:read:all')
       OR (public.has_permission(auth.uid(), 'attendance:read:team') AND public.is_supervisor_of(owner, auth.uid()))
     ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.code,
         COALESCE(a.daily_task_target / NULLIF(a.hours_per_day, 0), p.hourly_task_target),
         COALESCE(a.daily_task_target, p.daily_task_target),
         COALESCE(a.quality_target_pct, p.quality_target_pct),
         COALESCE(a.max_rejection_rate_pct, p.max_rejection_rate_pct)
  FROM public.task_entries t
  JOIN public.projects p ON p.id = t.project_id
  LEFT JOIN public.project_allocations a ON a.id = t.allocation_id
  WHERE t.day_id = _day_id
  GROUP BY p.code, p.hourly_task_target, p.daily_task_target, p.quality_target_pct, p.max_rejection_rate_pct,
           a.daily_task_target, a.hours_per_day, a.quality_target_pct, a.max_rejection_rate_pct
  ORDER BY COUNT(*) DESC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.allocation_pct_used(
  _user_id uuid,
  _on_date date DEFAULT public.current_ist_date(),
  _exclude_allocation uuid DEFAULT NULL::uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := auth.uid();
  total numeric;
BEGIN
  IF caller IS NOT NULL AND NOT (
       _user_id = caller
       OR public.has_permission(caller, 'allocations:manage:all')
       OR public.has_permission(caller, 'allocations:manage:team')
       OR public.has_permission(caller, 'allocations:read:all')
       OR (public.has_permission(caller, 'allocations:read:team') AND public.is_supervisor_of(_user_id, caller))
     ) THEN
    RAISE EXCEPTION 'Not authorised to view this capacity.';
  END IF;

  SELECT COALESCE(SUM(a.allocation_pct), 0) INTO total
  FROM public.project_allocations a
  WHERE a.user_id = _user_id
    AND a.status <> 'ended'
    AND (_exclude_allocation IS NULL OR a.id <> _exclude_allocation)
    AND a.start_date <= _on_date
    AND (a.end_date IS NULL OR a.end_date >= _on_date);

  RETURN total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_log_work(
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

  RETURN EXISTS (
    SELECT 1 FROM public.project_allocations a
    WHERE a.user_id = _user_id
      AND a.project_id = _project_id
      AND a.status = 'active'
      AND a.acknowledged_at IS NOT NULL
      AND a.start_date <= _on_date
      AND (a.end_date IS NULL OR a.end_date >= _on_date)
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. Harden can_actor_assign_role Against Peer & Cross-Tier Escalation (Item 5)
-- ----------------------------------------------------------------------------
-- Rules:
--   * Self-edit always forbidden.
--   * Super Admin: can assign/revoke any role on other accounts.
--   * HR: cannot touch accounts holding super_admin, founder, OR hr;
--         can assign/revoke ('admin', 'manager', 'lead', 'employee').
--   * Admin: cannot touch accounts holding super_admin, founder, hr, OR admin;
--            can assign/revoke ('manager', 'lead', 'employee').
CREATE OR REPLACE FUNCTION public.can_actor_assign_role(
  _actor_id uuid,
  _target_user_id uuid,
  _role public.app_role
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_super boolean;
  is_hr boolean;
  is_admin boolean;
BEGIN
  IF _actor_id IS NULL OR _target_user_id IS NULL OR _actor_id = _target_user_id THEN
    RETURN false;
  END IF;

  IF NOT public.has_permission(_actor_id, 'rbac:assign:all') THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _actor_id AND role = 'super_admin'
  ) INTO is_super;

  IF is_super THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _actor_id AND role = 'hr'
  ) INTO is_hr;

  IF is_hr THEN
    -- HR cannot modify accounts holding super_admin, founder, or hr (peer HR protection)
    IF EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _target_user_id AND role IN ('super_admin', 'founder', 'hr')
    ) THEN
      RETURN false;
    END IF;
    RETURN _role IN ('admin', 'manager', 'lead', 'employee');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _actor_id AND role = 'admin'
  ) INTO is_admin;

  IF is_admin THEN
    -- Admin cannot modify accounts holding super_admin, founder, hr, or admin
    IF EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _target_user_id AND role IN ('super_admin', 'founder', 'hr', 'admin')
    ) THEN
      RETURN false;
    END IF;
    RETURN _role IN ('manager', 'lead', 'employee');
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_actor_assign_role(uuid, uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_actor_assign_role(uuid, uuid, public.app_role) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Restrict Employee ID Sequence Allocation (Item 6)
-- ----------------------------------------------------------------------------
ALTER TABLE public.employee_id_sequence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.employee_id_sequence FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.employee_id_sequence TO service_role;

CREATE OR REPLACE FUNCTION public.claim_next_employee_id()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  next_num integer;
  formatted_id text;
BEGIN
  IF caller IS NOT NULL AND NOT (
    public.has_permission(caller, 'invitations:create:all')
    OR public.has_permission(caller, 'workforce:create:all')
  ) THEN
    RAISE EXCEPTION 'Forbidden: only authorized provisioning workflows can claim employee IDs.';
  END IF;

  SELECT last_val + 1 INTO next_num
  FROM public.employee_id_sequence
  WHERE id = 1
  FOR UPDATE;

  IF next_num IS NULL THEN
    INSERT INTO public.employee_id_sequence (id, last_val) VALUES (1, 1)
    ON CONFLICT (id) DO UPDATE SET last_val = public.employee_id_sequence.last_val + 1
    RETURNING last_val INTO next_num;
  ELSE
    UPDATE public.employee_id_sequence
    SET last_val = next_num, updated_at = now()
    WHERE id = 1;
  END IF;

  formatted_id := 'TAS-' || lpad(next_num::text, 3, '0');
  RETURN formatted_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.peek_next_employee_id()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  next_num integer;
BEGIN
  IF caller IS NOT NULL AND NOT (
    public.has_permission(caller, 'invitations:create:all')
    OR public.has_permission(caller, 'workforce:create:all')
  ) THEN
    RAISE EXCEPTION 'Forbidden: not authorized to preview employee IDs.';
  END IF;

  SELECT COALESCE(last_val, 0) + 1 INTO next_num
  FROM public.employee_id_sequence
  WHERE id = 1;

  RETURN 'TAS-' || lpad(COALESCE(next_num, 1)::text, 3, '0');
END;
$$;

-- Only service_role claims sequential IDs during invitation/roster provisioning;
-- authorized invitation/workforce creators may preview the next ID.
REVOKE ALL ON FUNCTION public.claim_next_employee_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_employee_id() TO service_role;

REVOKE ALL ON FUNCTION public.peek_next_employee_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.peek_next_employee_id() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Sensitive Employee KYC / Financial Document Protection (Item 7)
-- ----------------------------------------------------------------------------
-- Restrict raw employee document access strictly to Document Owner (self), HR, and Super Admin.
DELETE FROM public.role_permissions
WHERE permission_key = 'documents:read:team'
  AND role <> 'super_admin';

DELETE FROM public.role_permissions
WHERE permission_key IN ('documents:read:all', 'documents:verify:all')
  AND role NOT IN ('super_admin', 'hr');

DROP POLICY IF EXISTS documents_select_team ON public.documents;

DROP POLICY IF EXISTS documents_select_all ON public.documents;
CREATE POLICY documents_select_all ON public.documents
FOR SELECT TO authenticated
USING (
  public.has_permission(auth.uid(), 'documents:read:all')
  AND (
    public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'super_admin')
  )
);

DROP POLICY IF EXISTS documents_insert_self ON public.documents;
CREATE POLICY documents_insert_self ON public.documents
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.has_permission(auth.uid(), 'documents:upload:self')
);

DROP POLICY IF EXISTS documents_update_self ON public.documents;
CREATE POLICY documents_update_self ON public.documents
FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  AND status <> 'verified'::document_status
  AND public.has_permission(auth.uid(), 'documents:upload:self')
)
WITH CHECK (
  user_id = auth.uid()
  AND status = 'pending'::document_status
  AND reviewed_by IS NULL
  AND reviewed_at IS NULL
  AND review_note IS NULL
  AND public.has_permission(auth.uid(), 'documents:upload:self')
);

DROP POLICY IF EXISTS documents_delete_self ON public.documents;
CREATE POLICY documents_delete_self ON public.documents
FOR DELETE TO authenticated
USING (
  user_id = auth.uid()
  AND status <> 'verified'::document_status
  AND public.has_permission(auth.uid(), 'documents:upload:self')
);

DROP POLICY IF EXISTS documents_update_verify ON public.documents;
CREATE POLICY documents_update_verify ON public.documents
FOR UPDATE TO authenticated
USING (
  public.has_permission(auth.uid(), 'documents:verify:all')
  AND (
    public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'super_admin')
  )
)
WITH CHECK (
  public.has_permission(auth.uid(), 'documents:verify:all')
  AND (
    public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'super_admin')
  )
);

DROP POLICY IF EXISTS "docs verifier read" ON storage.objects;
CREATE POLICY "docs verifier read" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'employee-documents'
  AND public.has_permission(auth.uid(), 'documents:read:all')
  AND (
    public.has_role(auth.uid(), 'hr')
    OR public.has_role(auth.uid(), 'super_admin')
  )
);

