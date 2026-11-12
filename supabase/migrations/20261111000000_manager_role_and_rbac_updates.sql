-- ============================================================================
-- Migration: Introduce Manager Role & Enforce Tiered Role Assignment Security
-- Hierarchy: super_admin (1) -> founder (2) -> hr (3) -> admin (4) -> manager (5) -> lead (6) -> employee (7)
-- ============================================================================

-- 1. Add 'manager' to app_role enum (idempotent)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';

-- 2. Update role ranks and insert the Manager role catalog entry
UPDATE public.roles SET rank = 6 WHERE role = 'lead';
UPDATE public.roles SET rank = 7 WHERE role = 'employee';

INSERT INTO public.roles (role, label, rank, description)
VALUES ('manager', 'Manager', 5, 'Oversees assigned teams, departments and projects')
ON CONFLICT (role) DO UPDATE
SET label = EXCLUDED.label,
    rank = EXCLUDED.rank,
    description = EXCLUDED.description;

-- 3. Remove root permission matrix editing from Admin (reserved for Super Admin)
DELETE FROM public.role_permissions
WHERE role = 'admin' AND permission_key = 'rbac:manage:all';

-- 4. Grant HR the role-assignment capability so HR can assign/remove Admin, Manager, Lead, Employee
INSERT INTO public.role_permissions (role, permission_key)
SELECT 'hr'::public.app_role, key
FROM public.permissions
WHERE key = 'rbac:assign:all'
ON CONFLICT (role, permission_key) DO NOTHING;

-- 5. Seed Manager permissions (team, department & project oversight + lead review capabilities)
INSERT INTO public.role_permissions (role, permission_key)
SELECT 'manager'::public.app_role, key
FROM public.permissions
WHERE key IN (
  'workforce:read:self',
  'workforce:read:team',
  'workforce:read:all',
  'documents:read:self',
  'documents:read:team',
  'documents:upload:self',
  'projects:read:all',
  'projects:read:team',
  'projects:manage:all',
  'allocations:read:all',
  'allocations:read:team',
  'allocations:manage:all',
  'allocations:acknowledge:self',
  'attendance:log:self',
  'attendance:read:self',
  'attendance:read:team',
  'attendance:read:all',
  'tasks:log:self',
  'tasks:read:team',
  'tasks:read:all',
  'tasks:review:team',
  'blockers:raise:self',
  'blockers:manage:team',
  'eod:submit:self',
  'eod:read:team',
  'eod:read:all',
  'eod:review:team',
  'requests:submit:self',
  'requests:read:self',
  'requests:read:team',
  'requests:read:all',
  'requests:approve:lead',
  'announcements:read:all',
  'analytics:read:team',
  'analytics:read:all'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 6. Helper function: can_actor_assign_role(_actor_id, _target_user_id, _role)
-- Enforces:
--   * No self-role modification
--   * Super Admin: can assign/revoke any role
--   * HR: can assign/revoke 'admin', 'manager', 'lead', 'employee' (cannot modify super_admin or founder)
--   * Admin: can assign/revoke 'manager', 'lead', 'employee' (cannot grant/revoke admin, hr, founder, super_admin)
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
  target_is_protected boolean;
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

  -- Non-super-admins can never modify a user who holds super_admin or founder
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _target_user_id AND role IN ('super_admin', 'founder')
  ) INTO target_is_protected;

  IF target_is_protected THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _actor_id AND role = 'hr'
  ) INTO is_hr;

  IF is_hr AND _role IN ('admin', 'manager', 'lead', 'employee') THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _actor_id AND role = 'admin'
  ) INTO is_admin;

  IF is_admin AND _role IN ('manager', 'lead', 'employee') THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_actor_assign_role(uuid, uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_actor_assign_role(uuid, uuid, public.app_role) TO authenticated, service_role;

-- 7. Tighten RLS policies on role_permissions and user_roles
DROP POLICY IF EXISTS role_permissions_insert ON public.role_permissions;
DROP POLICY IF EXISTS role_permissions_delete ON public.role_permissions;

CREATE POLICY role_permissions_insert ON public.role_permissions
FOR INSERT TO authenticated
WITH CHECK (
  public.has_permission(auth.uid(), 'rbac:manage:all')
  AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  AND role <> 'super_admin'::public.app_role
);

CREATE POLICY role_permissions_delete ON public.role_permissions
FOR DELETE TO authenticated
USING (
  public.has_permission(auth.uid(), 'rbac:manage:all')
  AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin')
  AND role <> 'super_admin'::public.app_role
);

DROP POLICY IF EXISTS user_roles_insert ON public.user_roles;
DROP POLICY IF EXISTS user_roles_delete ON public.user_roles;

CREATE POLICY user_roles_insert ON public.user_roles
FOR INSERT TO authenticated
WITH CHECK (public.can_actor_assign_role(auth.uid(), user_id, role));

CREATE POLICY user_roles_delete ON public.user_roles
FOR DELETE TO authenticated
USING (public.can_actor_assign_role(auth.uid(), user_id, role));

-- 8. Allow HR and Admin to manage org_calendar_days alongside org:manage:all
DROP POLICY IF EXISTS calendar_write ON public.org_calendar_days;
CREATE POLICY calendar_write ON public.org_calendar_days
FOR ALL TO authenticated
USING (
  public.has_permission(auth.uid(), 'org:manage:all')
  OR public.has_permission(auth.uid(), 'import:manage:all')
)
WITH CHECK (
  public.has_permission(auth.uid(), 'org:manage:all')
  OR public.has_permission(auth.uid(), 'import:manage:all')
);

