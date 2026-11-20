-- Migration: 20261120180000_project_allocation_candidates_rpc.sql
-- Description: Adds a purpose-built, secure RPC function for project staffing candidate discovery.
-- Allows authorized Managers, Admins, and Super Admins to discover eligible employees across all
-- departments without exposing confidential HR records (DOB, salary, PAN, bank, private notes).

CREATE OR REPLACE FUNCTION public.get_project_allocation_candidates(
  _project_id uuid,
  _search text DEFAULT NULL,
  _department_id uuid DEFAULT NULL,
  _work_type text DEFAULT NULL,
  _role text DEFAULT NULL,
  _category text DEFAULT NULL,
  _capacity_filter text DEFAULT 'all', -- 'all', 'available', 'full'
  _assigned_filter text DEFAULT 'all', -- 'all', 'unallocated', 'allocated'
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  full_name text,
  work_email text,
  employee_code text,
  designation text,
  department_id uuid,
  department_name text,
  work_type text,
  category text,
  primary_role text,
  roles text[],
  used_pct integer,
  available_hours_per_day numeric,
  is_allocated_to_project boolean,
  is_annotation_eligible boolean,
  employment_status text,
  account_status text,
  eligibility_status text,
  eligibility_reason text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  p_rec record;
  is_auth boolean := false;
  clamped_limit integer := LEAST(GREATEST(COALESCE(_limit, 50), 1), 200);
  clamped_offset integer := GREATEST(COALESCE(_offset, 0), 0);
  cleaned_search text := NULLIF(TRIM(_search), '');
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Check Project Staffing Authorization
  SELECT * INTO p_rec FROM public.projects WHERE projects.id = _project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  IF public.has_permission(caller, 'allocations:manage:all')
     OR public.has_permission(caller, 'projects:manage:all') THEN
    is_auth := true;
  ELSIF (public.has_permission(caller, 'allocations:manage:team')
         OR public.has_permission(caller, 'projects:manage:team')) THEN
    IF p_rec.project_manager_id = caller OR p_rec.created_by = caller THEN
      is_auth := true;
    ELSIF p_rec.department_id IS NOT NULL AND public.is_department_manager(p_rec.department_id, caller) THEN
      is_auth := true;
    END IF;
  END IF;

  IF NOT is_auth THEN
    RAISE EXCEPTION 'Forbidden: you are not authorized to manage allocations on this project.';
  END IF;

  -- 2. Query candidates with minimal fields, capacity aggregation, and eligibility computation
  RETURN QUERY
  WITH protected_users AS (
    SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'super_admin'
  ),
  user_roles_agg AS (
    SELECT
      ur.user_id,
      array_agg(ur.role::text ORDER BY ur.role) AS all_roles,
      (array_agg(ur.role::text ORDER BY
        CASE ur.role
          WHEN 'super_admin' THEN 1
          WHEN 'founder' THEN 2
          WHEN 'admin' THEN 3
          WHEN 'hr' THEN 4
          WHEN 'manager' THEN 5
          WHEN 'lead' THEN 6
          ELSE 7
        END
      ))[1] AS main_role
    FROM public.user_roles ur
    GROUP BY ur.user_id
  ),
  user_alloc_agg AS (
    SELECT
      pa.user_id,
      COALESCE(SUM(pa.allocation_pct), 0)::integer AS total_pct,
      bool_or(pa.project_id = _project_id) AS allocated_here
    FROM public.project_allocations pa
    WHERE pa.status <> 'ended'
    GROUP BY pa.user_id
  ),
  candidate_pool AS (
    SELECT
      p.id AS c_id,
      p.full_name AS c_name,
      p.work_email AS c_email,
      p.employee_code AS c_code,
      p.designation AS c_designation,
      p.department_id AS c_dept_id,
      d.name AS c_dept_name,
      p.work_type::text AS c_work_type,
      p.category::text AS c_category,
      COALESCE(ra.main_role, 'employee') AS c_primary_role,
      COALESCE(ra.all_roles, ARRAY['employee']::text[]) AS c_roles,
      COALESCE(ua.total_pct, 0) AS c_used_pct,
      COALESCE(p.available_hours_per_day, 8.0) AS c_hours,
      COALESCE(ua.allocated_here, false) AS c_allocated_here,
      (p.work_type = 'annotation' AND p_rec.work_type = 'annotation') AS c_annotation_eligible,
      p.employment_status::text AS c_emp_status,
      p.account_status::text AS c_acc_status,
      CASE
        WHEN p.employment_status <> 'active' THEN 'inactive'
        WHEN p.account_status = 'profile_pending' THEN 'profile_pending'
        WHEN p.account_status = 'under_verification' THEN 'under_verification'
        WHEN COALESCE(ua.allocated_here, false) THEN 'already_allocated'
        WHEN COALESCE(ua.total_pct, 0) >= 100 THEN 'capacity_full'
        ELSE 'available'
      END AS c_elig_status,
      CASE
        WHEN p.employment_status <> 'active' THEN 'Employment status is ' || p.employment_status::text
        WHEN p.account_status = 'profile_pending' THEN 'Profile onboarding incomplete'
        WHEN p.account_status = 'under_verification' THEN 'Under HR / KYC verification'
        WHEN COALESCE(ua.allocated_here, false) THEN 'Already allocated to this project'
        WHEN COALESCE(ua.total_pct, 0) >= 100 THEN 'Allocated at 100%+ across other projects'
        ELSE NULL
      END AS c_elig_reason
    FROM public.profiles p
    LEFT JOIN public.departments d ON d.id = p.department_id
    LEFT JOIN user_roles_agg ra ON ra.user_id = p.id
    LEFT JOIN user_alloc_agg ua ON ua.user_id = p.id
    WHERE p.id NOT IN (SELECT pu.user_id FROM protected_users pu)
      -- Search filter
      AND (
        cleaned_search IS NULL
        OR p.full_name ILIKE ('%' || cleaned_search || '%')
        OR COALESCE(p.employee_code, '') ILIKE ('%' || cleaned_search || '%')
        OR p.work_email ILIKE ('%' || cleaned_search || '%')
      )
      -- Department filter
      AND (_department_id IS NULL OR p.department_id = _department_id)
      -- Work type filter
      AND (_work_type IS NULL OR _work_type = 'all' OR p.work_type::text = _work_type)
      -- Category filter
      AND (_category IS NULL OR _category = 'all' OR p.category::text = _category)
      -- Role filter
      AND (_role IS NULL OR _role = 'all' OR _role = ANY(COALESCE(ra.all_roles, ARRAY['employee']::text[])))
  ),
  filtered_pool AS (
    SELECT cp.*
    FROM candidate_pool cp
    WHERE
      -- Capacity filter
      (
        _capacity_filter IS NULL OR _capacity_filter = 'all'
        OR (_capacity_filter = 'available' AND cp.c_used_pct < 100)
        OR (_capacity_filter = 'full' AND cp.c_used_pct >= 100)
      )
      -- Assigned filter
      AND (
        _assigned_filter IS NULL OR _assigned_filter = 'all'
        OR (_assigned_filter = 'unallocated' AND NOT cp.c_allocated_here)
        OR (_assigned_filter = 'allocated' AND cp.c_allocated_here)
      )
  ),
  counted AS (
    SELECT
      fp.*,
      COUNT(*) OVER() AS total_count_val
    FROM filtered_pool fp
  )
  SELECT
    counted.c_id AS id,
    counted.c_name AS full_name,
    counted.c_email AS work_email,
    counted.c_code AS employee_code,
    counted.c_designation AS designation,
    counted.c_dept_id AS department_id,
    counted.c_dept_name AS department_name,
    counted.c_work_type AS work_type,
    counted.c_category AS category,
    counted.c_primary_role AS primary_role,
    counted.c_roles AS roles,
    counted.c_used_pct AS used_pct,
    counted.c_hours AS available_hours_per_day,
    counted.c_allocated_here AS is_allocated_to_project,
    counted.c_annotation_eligible AS is_annotation_eligible,
    counted.c_emp_status AS employment_status,
    counted.c_acc_status AS account_status,
    counted.c_elig_status AS eligibility_status,
    counted.c_elig_reason AS eligibility_reason,
    counted.total_count_val AS total_count
  FROM counted
  ORDER BY
    CASE counted.c_elig_status
      WHEN 'available' THEN 1
      WHEN 'capacity_full' THEN 2
      WHEN 'already_allocated' THEN 3
      ELSE 4
    END,
    counted.c_name ASC
  LIMIT clamped_limit
  OFFSET clamped_offset;
END;
$$;

-- Grant execution to authenticated users (role authorization checked inside function body)
GRANT EXECUTE ON FUNCTION public.get_project_allocation_candidates(
  uuid, text, uuid, text, text, text, text, text, integer, integer
) TO authenticated;
