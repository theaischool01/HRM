-- Migration: 20261119120000_remove_manager_department_restriction.sql
-- Description: Remove department restriction from Project Managers.
-- Managers can create projects in ANY organization department.
-- The same Manager can supervise projects and teams across multiple departments.

-- 1. Update projects_insert policy
DROP POLICY IF EXISTS projects_insert ON public.projects;
CREATE POLICY projects_insert ON public.projects
FOR INSERT TO authenticated
WITH CHECK (
  public.has_permission(auth.uid(), 'projects:manage:all')
  OR (
    public.has_permission(auth.uid(), 'projects:manage:team')
    AND (
      created_by = auth.uid()
      OR project_manager_id = auth.uid()
      OR public.is_department_manager(department_id, auth.uid())
    )
  )
);

-- 2. Update can_manage_project function
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
               OR p.created_by = _user_id
               OR public.is_department_manager(p.department_id, _user_id)
             )
         )
       )
     );
$$;

-- 3. Update can_view_project function
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
                OR p.created_by = _user_id
                OR public.is_department_manager(p.department_id, _user_id)
              )
          )
        )
      )
      OR public.is_allocated_to_project(_project_id, _user_id);
$$;

-- 4. Update projects_update policy
DROP POLICY IF EXISTS projects_update ON public.projects;
CREATE POLICY projects_update ON public.projects
FOR UPDATE TO authenticated
USING (public.can_manage_project(id, auth.uid()))
WITH CHECK (public.can_manage_project(id, auth.uid()));

-- 5. Update is_manager_of function to include created_by projects
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
       -- 3. Owner has a non-ended allocation on a project managed by _viewer, created by _viewer, or in _viewer's department
       OR EXISTS (
         SELECT 1
         FROM public.project_allocations a
         JOIN public.projects pr ON pr.id = a.project_id
         WHERE a.user_id = _owner
           AND a.status <> 'ended'
           AND (
             pr.project_manager_id = _viewer
             OR pr.created_by = _viewer
             OR public.is_department_manager(pr.department_id, _viewer)
             OR public.is_project_lead(pr.id, _viewer)
           )
       )
     );
$$;

-- 6. Permissions and grants
REVOKE ALL ON FUNCTION public.can_manage_project(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_view_project(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_manager_of(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_project(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_project(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_manager_of(uuid, uuid) TO authenticated, service_role;
