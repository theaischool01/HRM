-- ============================================================================
-- Migration: Phase P2 HR Recruitment, Interview Management & Email Center
-- Safe, additive, idempotent migration — preserves 100% of existing tables,
-- accounts, permissions, attendance, tasks, EODs, projects, and invitations.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Recruitment, Interview & Email Permissions
-- ----------------------------------------------------------------------------
INSERT INTO public.permissions (key, resource, action, scope, description) VALUES
  ('recruitment:read:all', 'recruitment', 'read', 'all', 'View candidate pipeline, profiles, resumes, and recruitment analytics'),
  ('recruitment:manage:all', 'recruitment', 'manage', 'all', 'Create and update candidates, import candidate sheets, move stages, and convert hires to onboarding'),
  ('interviews:read:all', 'interviews', 'read', 'all', 'View all scheduled interviews and submitted scorecards across the organization'),
  ('interviews:manage:all', 'interviews', 'manage', 'all', 'Schedule, reschedule, complete, or cancel candidate interviews and assign interviewers'),
  ('interviews:feedback:assigned', 'interviews', 'feedback', 'assigned', 'View assigned candidate interviews and submit structured interview feedback and ratings'),
  ('emails:read:all', 'emails', 'read', 'all', 'View HR recruitment email templates and delivery audit logs'),
  ('emails:manage:all', 'emails', 'manage', 'all', 'Edit HR recruitment and onboarding email templates'),
  ('emails:send:all', 'emails', 'send', 'all', 'Compose, send, retry, and test HR recruitment emails via verified provider')
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description;

-- Super Admin & HR hold complete recruitment, interview, template, and sending control
INSERT INTO public.role_permissions (role, permission_key)
SELECT r.role, p.perm
FROM (VALUES
  ('super_admin'::public.app_role),
  ('hr'::public.app_role)
) AS r(role)
CROSS JOIN (VALUES
  ('recruitment:read:all'),
  ('recruitment:manage:all'),
  ('interviews:read:all'),
  ('interviews:manage:all'),
  ('interviews:feedback:assigned'),
  ('emails:read:all'),
  ('emails:manage:all'),
  ('emails:send:all')
) AS p(perm)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Founder (read-only oversight) & Admin (operational visibility) hold read permissions only
INSERT INTO public.role_permissions (role, permission_key)
SELECT r.role, p.perm
FROM (VALUES
  ('founder'::public.app_role),
  ('admin'::public.app_role)
) AS r(role)
CROSS JOIN (VALUES
  ('recruitment:read:all'),
  ('interviews:read:all'),
  ('emails:read:all')
) AS p(perm)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Manager & Lead hold assigned interview participation & feedback ONLY
INSERT INTO public.role_permissions (role, permission_key)
SELECT r.role, 'interviews:feedback:assigned'
FROM (VALUES
  ('manager'::public.app_role),
  ('lead'::public.app_role)
) AS r(role)
ON CONFLICT (role, permission_key) DO NOTHING;

-- Enforce strict role boundaries (Founder read-only, Employee no recruitment admin)
DELETE FROM public.role_permissions
WHERE role = 'founder'
  AND permission_key IN (
    'recruitment:manage:all',
    'interviews:manage:all',
    'interviews:feedback:assigned',
    'emails:manage:all',
    'emails:send:all'
  );

DELETE FROM public.role_permissions
WHERE role = 'employee'
  AND permission_key IN (
    'recruitment:read:all',
    'recruitment:manage:all',
    'interviews:read:all',
    'interviews:manage:all',
    'interviews:feedback:assigned',
    'emails:read:all',
    'emails:manage:all',
    'emails:send:all'
  );

-- ----------------------------------------------------------------------------
-- 2. Candidate Code Sequence & Helper
-- ----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.candidate_code_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION public.claim_next_candidate_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_permission(auth.uid(), 'recruitment:manage:all') THEN
    RAISE EXCEPTION 'Forbidden: missing permission recruitment:manage:all';
  END IF;
  RETURN 'CAN-' || LPAD(nextval('public.candidate_code_seq')::text, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_candidate_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_next_candidate_code() TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Candidate Import Batches & Candidates Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.candidate_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  invalid_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  column_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_code text NOT NULL UNIQUE DEFAULT public.claim_next_candidate_code(),
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  location text,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  designation text,
  applied_category public.user_category NOT NULL DEFAULT 'full_time',
  source text NOT NULL DEFAULT 'direct'
    CHECK (source IN ('direct', 'csv_import', 'linkedin', 'referral', 'campus', 'job_portal', 'agency', 'other')),
  status text NOT NULL DEFAULT 'applied'
    CHECK (status IN (
      'applied',
      'screening',
      'shortlisted',
      'interview_scheduled',
      'interviewed',
      'selected',
      'offer_sent',
      'offer_accepted',
      'onboarding',
      'rejected',
      'on_hold',
      'withdrawn'
    )),
  experience_years numeric(4,1),
  current_company text,
  expected_ctc text,
  notice_period_days integer,
  available_joining_date date,
  skills text[] NOT NULL DEFAULT '{}',
  resume_path text,
  resume_file_name text,
  portfolio_url text,
  linkedin_url text,
  notes_summary text,
  assigned_hr_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  import_batch_id uuid REFERENCES public.candidate_import_batches(id) ON DELETE SET NULL,
  converted_invitation_id uuid REFERENCES public.invitations(id) ON DELETE SET NULL,
  converted_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  converted_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS candidates_email_lower_uniq
  ON public.candidates (lower(email));
CREATE INDEX IF NOT EXISTS candidates_status_idx
  ON public.candidates (status, created_at DESC);
CREATE INDEX IF NOT EXISTS candidates_department_idx
  ON public.candidates (department_id);
CREATE INDEX IF NOT EXISTS candidates_assigned_hr_idx
  ON public.candidates (assigned_hr_id);

CREATE TABLE IF NOT EXISTS public.candidate_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  activity_type text NOT NULL
    CHECK (activity_type IN (
      'created',
      'imported',
      'note',
      'status_change',
      'resume_uploaded',
      'interview_scheduled',
      'interview_updated',
      'interview_feedback',
      'email_sent',
      'converted_to_onboarding'
    )),
  from_status text,
  to_status text,
  body text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS candidate_activities_candidate_idx
  ON public.candidate_activities (candidate_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. Interviews & Structured Interview Feedback Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  round_number integer NOT NULL DEFAULT 1,
  round_name text NOT NULL,
  mode text NOT NULL DEFAULT 'online'
    CHECK (mode IN ('online', 'offline')),
  scheduled_start_at timestamptz NOT NULL,
  scheduled_end_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  meeting_link text,
  office_location_id uuid REFERENCES public.office_locations(id) ON DELETE SET NULL,
  location_details text,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'rescheduled', 'completed', 'cancelled', 'no_show')),
  interviewer_ids uuid[] NOT NULL DEFAULT '{}',
  lead_interviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  instructions text,
  cancel_or_reschedule_reason text,
  scheduled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT interviews_end_after_start CHECK (scheduled_end_at > scheduled_start_at)
);

CREATE INDEX IF NOT EXISTS interviews_candidate_idx
  ON public.interviews (candidate_id, round_number ASC);
CREATE INDEX IF NOT EXISTS interviews_schedule_idx
  ON public.interviews (scheduled_start_at ASC, status);
CREATE INDEX IF NOT EXISTS interviews_interviewer_ids_gin_idx
  ON public.interviews USING gin (interviewer_ids);

CREATE TABLE IF NOT EXISTS public.interview_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id uuid NOT NULL REFERENCES public.interviews(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  interviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  technical_rating integer CHECK (technical_rating IS NULL OR technical_rating BETWEEN 1 AND 5),
  communication_rating integer CHECK (communication_rating IS NULL OR communication_rating BETWEEN 1 AND 5),
  recommendation text NOT NULL
    CHECK (recommendation IN ('strong_hire', 'hire', 'hold', 'no_hire')),
  strengths text,
  concerns text,
  notes text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interview_id, interviewer_id)
);

CREATE INDEX IF NOT EXISTS interview_feedback_candidate_idx
  ON public.interview_feedback (candidate_id, submitted_at DESC);

-- ----------------------------------------------------------------------------
-- 5. HR Email Templates & Delivery Messages Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'recruitment',
  subject_template text NOT NULL,
  body_html_template text NOT NULL,
  body_text_template text,
  variables text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  template_slug text,
  candidate_id uuid REFERENCES public.candidates(id) ON DELETE SET NULL,
  interview_id uuid REFERENCES public.interviews(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  recipient_name text,
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text,
  variables_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_test boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'queued', 'sending', 'sent', 'delivered', 'failed')),
  provider text NOT NULL DEFAULT 'resend',
  provider_message_id text,
  attempts integer NOT NULL DEFAULT 0,
  error_message text,
  sent_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_messages_candidate_idx
  ON public.email_messages (candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_status_idx
  ON public.email_messages (status, created_at DESC);

-- ----------------------------------------------------------------------------
-- 6. Updated_at Triggers
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_candidates_updated_at ON public.candidates;
    CREATE TRIGGER trg_candidates_updated_at
      BEFORE UPDATE ON public.candidates
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

    DROP TRIGGER IF EXISTS trg_candidate_import_batches_updated_at ON public.candidate_import_batches;
    CREATE TRIGGER trg_candidate_import_batches_updated_at
      BEFORE UPDATE ON public.candidate_import_batches
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

    DROP TRIGGER IF EXISTS trg_interviews_updated_at ON public.interviews;
    CREATE TRIGGER trg_interviews_updated_at
      BEFORE UPDATE ON public.interviews
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

    DROP TRIGGER IF EXISTS trg_interview_feedback_updated_at ON public.interview_feedback;
    CREATE TRIGGER trg_interview_feedback_updated_at
      BEFORE UPDATE ON public.interview_feedback
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

    DROP TRIGGER IF EXISTS trg_email_templates_updated_at ON public.email_templates;
    CREATE TRIGGER trg_email_templates_updated_at
      BEFORE UPDATE ON public.email_templates
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

    DROP TRIGGER IF EXISTS trg_email_messages_updated_at ON public.email_messages;
    CREATE TRIGGER trg_email_messages_updated_at
      BEFORE UPDATE ON public.email_messages
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. Security Definer Helpers (Prevent RLS Recursion for Assigned Interviewers)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_assigned_interviewer_for_candidate(
  _candidate_id uuid,
  _user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.interviews i
    WHERE i.candidate_id = _candidate_id
      AND _user_id = ANY(i.interviewer_ids)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_assigned_to_interview(
  _interview_id uuid,
  _user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.interviews i
    WHERE i.id = _interview_id
      AND _user_id = ANY(i.interviewer_ids)
  );
$$;

REVOKE ALL ON FUNCTION public.is_assigned_interviewer_for_candidate(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_assigned_interviewer_for_candidate(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_assigned_to_interview(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_assigned_to_interview(uuid, uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. Table Privileges & Row-Level Security (RLS) Policies
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE
  public.candidates,
  public.candidate_import_batches,
  public.candidate_activities,
  public.interviews,
  public.interview_feedback,
  public.email_templates,
  public.email_messages
FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.candidates,
  public.candidate_import_batches,
  public.candidate_activities,
  public.interviews,
  public.interview_feedback,
  public.email_templates,
  public.email_messages
TO authenticated;

GRANT ALL ON TABLE
  public.candidates,
  public.candidate_import_batches,
  public.candidate_activities,
  public.interviews,
  public.interview_feedback,
  public.email_templates,
  public.email_messages
TO service_role;

GRANT USAGE, SELECT ON SEQUENCE public.candidate_code_seq TO authenticated, service_role;

ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;

-- candidates
DROP POLICY IF EXISTS candidates_select ON public.candidates;
CREATE POLICY candidates_select ON public.candidates
  FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'recruitment:read:all')
    OR (
      public.has_permission(auth.uid(), 'interviews:feedback:assigned')
      AND public.is_assigned_interviewer_for_candidate(id, auth.uid())
    )
  );

DROP POLICY IF EXISTS candidates_insert ON public.candidates;
CREATE POLICY candidates_insert ON public.candidates
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'recruitment:manage:all'));

DROP POLICY IF EXISTS candidates_update ON public.candidates;
CREATE POLICY candidates_update ON public.candidates
  FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'recruitment:manage:all'))
  WITH CHECK (public.has_permission(auth.uid(), 'recruitment:manage:all'));

DROP POLICY IF EXISTS candidates_delete ON public.candidates;
CREATE POLICY candidates_delete ON public.candidates
  FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'recruitment:manage:all'));

-- candidate_import_batches
DROP POLICY IF EXISTS candidate_import_batches_select ON public.candidate_import_batches;
CREATE POLICY candidate_import_batches_select ON public.candidate_import_batches
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'recruitment:read:all'));

DROP POLICY IF EXISTS candidate_import_batches_write ON public.candidate_import_batches;
CREATE POLICY candidate_import_batches_write ON public.candidate_import_batches
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'recruitment:manage:all'))
  WITH CHECK (public.has_permission(auth.uid(), 'recruitment:manage:all'));

-- candidate_activities
DROP POLICY IF EXISTS candidate_activities_select ON public.candidate_activities;
CREATE POLICY candidate_activities_select ON public.candidate_activities
  FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'recruitment:read:all')
    OR (
      public.has_permission(auth.uid(), 'interviews:feedback:assigned')
      AND public.is_assigned_interviewer_for_candidate(candidate_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS candidate_activities_insert ON public.candidate_activities;
CREATE POLICY candidate_activities_insert ON public.candidate_activities
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission(auth.uid(), 'recruitment:manage:all')
    OR public.has_permission(auth.uid(), 'interviews:manage:all')
    OR public.has_permission(auth.uid(), 'emails:send:all')
    OR (
      activity_type = 'interview_feedback'
      AND actor_id = auth.uid()
      AND public.has_permission(auth.uid(), 'interviews:feedback:assigned')
      AND public.is_assigned_interviewer_for_candidate(candidate_id, auth.uid())
    )
  );

-- interviews
DROP POLICY IF EXISTS interviews_select ON public.interviews;
CREATE POLICY interviews_select ON public.interviews
  FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'interviews:read:all')
    OR (
      public.has_permission(auth.uid(), 'interviews:feedback:assigned')
      AND auth.uid() = ANY(interviewer_ids)
    )
  );

DROP POLICY IF EXISTS interviews_write ON public.interviews;
CREATE POLICY interviews_write ON public.interviews
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'interviews:manage:all'))
  WITH CHECK (public.has_permission(auth.uid(), 'interviews:manage:all'));

-- interview_feedback
DROP POLICY IF EXISTS interview_feedback_select ON public.interview_feedback;
CREATE POLICY interview_feedback_select ON public.interview_feedback
  FOR SELECT TO authenticated
  USING (
    public.has_permission(auth.uid(), 'interviews:read:all')
    OR interviewer_id = auth.uid()
  );

DROP POLICY IF EXISTS interview_feedback_insert ON public.interview_feedback;
CREATE POLICY interview_feedback_insert ON public.interview_feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission(auth.uid(), 'interviews:manage:all')
    OR (
      interviewer_id = auth.uid()
      AND public.has_permission(auth.uid(), 'interviews:feedback:assigned')
      AND public.is_assigned_to_interview(interview_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS interview_feedback_update ON public.interview_feedback;
CREATE POLICY interview_feedback_update ON public.interview_feedback
  FOR UPDATE TO authenticated
  USING (
    public.has_permission(auth.uid(), 'interviews:manage:all')
    OR (
      interviewer_id = auth.uid()
      AND public.has_permission(auth.uid(), 'interviews:feedback:assigned')
      AND public.is_assigned_to_interview(interview_id, auth.uid())
    )
  )
  WITH CHECK (
    public.has_permission(auth.uid(), 'interviews:manage:all')
    OR (
      interviewer_id = auth.uid()
      AND public.has_permission(auth.uid(), 'interviews:feedback:assigned')
      AND public.is_assigned_to_interview(interview_id, auth.uid())
    )
  );

-- email_templates
DROP POLICY IF EXISTS email_templates_select ON public.email_templates;
CREATE POLICY email_templates_select ON public.email_templates
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'emails:read:all'));

DROP POLICY IF EXISTS email_templates_write ON public.email_templates;
CREATE POLICY email_templates_write ON public.email_templates
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'emails:manage:all'))
  WITH CHECK (public.has_permission(auth.uid(), 'emails:manage:all'));

-- email_messages
DROP POLICY IF EXISTS email_messages_select ON public.email_messages;
CREATE POLICY email_messages_select ON public.email_messages
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'emails:read:all'));

DROP POLICY IF EXISTS email_messages_write ON public.email_messages;
CREATE POLICY email_messages_write ON public.email_messages
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'emails:send:all'))
  WITH CHECK (public.has_permission(auth.uid(), 'emails:send:all'));

-- ----------------------------------------------------------------------------
-- 9. Private Candidate Resumes Storage Bucket & Policies
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('candidate-resumes', 'candidate-resumes', false, 15728640)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS candidate_resumes_read ON storage.objects;
CREATE POLICY candidate_resumes_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'candidate-resumes'
    AND (
      public.has_permission(auth.uid(), 'recruitment:read:all')
      OR (
        public.has_permission(auth.uid(), 'interviews:feedback:assigned')
        AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND public.is_assigned_interviewer_for_candidate(((storage.foldername(name))[1])::uuid, auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS candidate_resumes_write ON storage.objects;
CREATE POLICY candidate_resumes_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'candidate-resumes'
    AND public.has_permission(auth.uid(), 'recruitment:manage:all')
  );

DROP POLICY IF EXISTS candidate_resumes_update ON storage.objects;
CREATE POLICY candidate_resumes_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'candidate-resumes'
    AND public.has_permission(auth.uid(), 'recruitment:manage:all')
  );

DROP POLICY IF EXISTS candidate_resumes_delete ON storage.objects;
CREATE POLICY candidate_resumes_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'candidate-resumes'
    AND public.has_permission(auth.uid(), 'recruitment:manage:all')
  );

-- ----------------------------------------------------------------------------
-- 10. Seed Default 12 HR Recruitment & Onboarding Email Templates
-- ----------------------------------------------------------------------------
INSERT INTO public.email_templates (slug, name, category, subject_template, body_html_template, body_text_template, variables)
VALUES
  (
    'application_received',
    'Application Received',
    'screening',
    'Application Received — {{designation}} | The AI School',
    '<p>Dear {{candidate_name}},</p><p>Thank you for applying for the <strong>{{designation}}</strong> role ({{department}}) at <strong>The AI School</strong>.</p><p>Our recruitment team has received your profile and will review your qualifications shortly. If your background aligns with our current requirements, we will reach out to schedule an initial conversation.</p><p>Warm regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>',
    'Dear {{candidate_name}},\n\nThank you for applying for the {{designation}} role ({{department}}) at The AI School.\n\nOur recruitment team has received your profile and will review your qualifications shortly.\n\nWarm regards,\n{{hr_contact}}\nHR Team · The AI School',
    ARRAY['candidate_name', 'designation', 'department', 'hr_contact']
  ),
  (
    'candidate_shortlisted',
    'Candidate Shortlisted',
    'screening',
    'Your Application Has Been Shortlisted — {{designation}} | The AI School',
    '<p>Dear {{candidate_name}},</p><p>We are pleased to share that your profile has been shortlisted for the <strong>{{designation}}</strong> position in our <strong>{{department}}</strong> team at The AI School.</p><p>Our HR team will contact you shortly to coordinate convenient slots for the upcoming interview round.</p><p>Best regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>',
    'Dear {{candidate_name}},\n\nYour profile has been shortlisted for the {{designation}} position ({{department}}) at The AI School. Our HR team will reach out shortly to coordinate interview slots.\n\nBest regards,\n{{hr_contact}}',
    ARRAY['candidate_name', 'designation', 'department', 'hr_contact']
  ),
  (
    'interview_invitation',
    'Interview Invitation',
    'interviews',
    'Interview Invitation: {{designation}} on {{interview_date}} | The AI School',
    '<p>Dear {{candidate_name}},</p><p>You are invited to an interview for the <strong>{{designation}}</strong> ({{department}}) role at <strong>The AI School</strong>.</p><ul><li><strong>Date:</strong> {{interview_date}}</li><li><strong>Time (IST):</strong> {{interview_time}}</li><li><strong>Mode / Link:</strong> {{meeting_link}}</li></ul><p>Please reply to confirm your availability or reach out to {{hr_contact}} if you need assistance.</p><p>Best regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>',
    'Dear {{candidate_name}},\n\nYou are invited to an interview for {{designation}} ({{department}}) at The AI School.\n- Date: {{interview_date}}\n- Time (IST): {{interview_time}}\n- Mode / Link: {{meeting_link}}\n\nBest regards,\n{{hr_contact}}',
    ARRAY['candidate_name', 'designation', 'department', 'interview_date', 'interview_time', 'meeting_link', 'hr_contact']
  ),
  (
    'interview_rescheduled',
    'Interview Rescheduled',
    'interviews',
    'Updated Schedule: Interview for {{designation}} on {{interview_date}} | The AI School',
    '<p>Dear {{candidate_name}},</p><p>Your interview for the <strong>{{designation}}</strong> ({{department}}) role at The AI School has been rescheduled. Please note the updated details below:</p><ul><li><strong>New Date:</strong> {{interview_date}}</li><li><strong>New Time (IST):</strong> {{interview_time}}</li><li><strong>Mode / Link:</strong> {{meeting_link}}</li></ul><p>If you have any questions, please contact {{hr_contact}}.</p><p>Warm regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>',
    'Dear {{candidate_name}},\n\nYour interview for {{designation}} ({{department}}) has been rescheduled:\n- New Date: {{interview_date}}\n- New Time (IST): {{interview_time}}\n- Mode / Link: {{meeting_link}}\n\nWarm regards,\n{{hr_contact}}',
    ARRAY['candidate_name', 'designation', 'department', 'interview_date', 'interview_time', 'meeting_link', 'hr_contact']
  ),
  (
    'interview_reminder',
    'Interview Reminder',
    'interviews',
    'Reminder: Upcoming Interview for {{designation}} ({{interview_date}}) | The AI School',
    '<p>Dear {{candidate_name}},</p><p>This is a friendly reminder regarding your upcoming interview for <strong>{{designation}}</strong> ({{department}}) at The AI School.</p><ul><li><strong>Date:</strong> {{interview_date}}</li><li><strong>Time (IST):</strong> {{interview_time}}</li><li><strong>Join / Location Details:</strong> {{meeting_link}}</li></ul><p>We look forward to speaking with you!</p><p>Best regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>',
    'Dear {{candidate_name}},\n\nReminder for your upcoming interview for {{designation}} ({{department}}):\n- Date: {{interview_date}}\n- Time (IST): {{interview_time}}\n- Join / Location Details: {{meeting_link}}\n\nBest regards,\n{{hr_contact}}',
    ARRAY['candidate_name', 'designation', 'department', 'interview_date', 'interview_time', 'meeting_link', 'hr_contact']
  ),
  (
    'candidate_rejection',
    'Candidate Rejection',
    'decisions',
    'Update on Your Application for {{designation}} | The AI School',
    '<p>Dear {{candidate_name}},</p><p>Thank you for taking the time to apply and speak with our team regarding the <strong>{{designation}}</strong> role in <strong>{{department}}</strong> at The AI School.</p><p>After careful evaluation, we have decided to move forward with other candidates whose experience more closely aligns with our immediate needs. We truly appreciate your interest in The AI School and wish you every success ahead.</p><p>Sincerely,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>',
    'Dear {{candidate_name}},\n\nThank you for applying for the {{designation}} ({{department}}) role at The AI School. After careful consideration, we have decided to move forward with other candidates at this time. We wish you the very best.\n\nSincerely,\n{{hr_contact}}',
    ARRAY['candidate_name', 'designation', 'department', 'hr_contact']
  ),
  (
    'candidate_selection',
    'Candidate Selection',
    'decisions',
    'Congratulations! Selected for {{designation}} | The AI School',
    '<p>Dear {{candidate_name}},</p><p>Congratulations! Following your interviews with our team, we are delighted to inform you that you have been selected for the <strong>{{designation}}</strong> role in <strong>{{department}}</strong> at <strong>The AI School</strong>.</p><p>Our HR team is preparing your formal offer details with a proposed joining date of <strong>{{joining_date}}</strong>. Please reach out to {{hr_contact}} if you need any clarification.</p><p>Warm regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>',
    'Dear {{candidate_name}},\n\nCongratulations! You have been selected for the {{designation}} ({{department}}) role at The AI School, with a proposed joining date of {{joining_date}}.\n\nWarm regards,\n{{hr_contact}}',
    ARRAY['candidate_name', 'designation', 'department', 'joining_date', 'hr_contact']
  ),
  (
    'offer_letter',
    'Offer Letter',
    'offers',
    'Offer of Engagement — {{designation}} | The AI School',
    '<p>Dear {{candidate_name}},</p><p>We are excited to extend an offer to join <strong>The AI School</strong> as <strong>{{designation}}</strong> in our <strong>{{department}}</strong> department, with an anticipated joining date of <strong>{{joining_date}}</strong>.</p><p>Please review your offer terms and reply to confirm your acceptance so we can initiate your HRM portal onboarding.</p><p>For any queries, please contact {{hr_contact}}.</p><p>Best regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>',
    'Dear {{candidate_name}},\n\nWe are excited to extend an offer to join The AI School as {{designation}} ({{department}}) starting {{joining_date}}. Please reply to confirm your acceptance.\n\nBest regards,\n{{hr_contact}}',
    ARRAY['candidate_name', 'designation', 'department', 'joining_date', 'hr_contact']
  ),
  (
    'offer_acceptance',
    'Offer Acceptance',
    'offers',
    'Offer Acceptance Confirmed — Welcome to Pre-Onboarding | The AI School',
    '<p>Dear {{candidate_name}},</p><p>Thank you for accepting our offer to join <strong>The AI School</strong> as <strong>{{designation}}</strong> ({{department}}) starting on <strong>{{joining_date}}</strong>!</p><p>We will shortly issue your HRM onboarding invitation so you can complete your profile and upload required verification documents ahead of Day 1.</p><p>Warm regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>',
    'Dear {{candidate_name}},\n\nThank you for accepting our offer for {{designation}} ({{department}}) starting {{joining_date}}. Your HRM onboarding invitation will follow shortly.\n\nWarm regards,\n{{hr_contact}}',
    ARRAY['candidate_name', 'designation', 'department', 'joining_date', 'hr_contact']
  ),
  (
    'onboarding_invitation',
    'Onboarding Invitation',
    'onboarding',
    'Complete Your Pre-Joining Onboarding — {{designation}} | The AI School',
    '<p>Dear {{candidate_name}},</p><p>Welcome to the onboarding stage for <strong>{{designation}}</strong> ({{department}}) at <strong>The AI School</strong> (Joining Date: <strong>{{joining_date}}</strong>).</p><p>Your HRM portal invitation has been queued. Once you receive your secure sign-in link, please complete your profile details and upload your mandatory KYC documents for HR verification.</p><p>Need help? Contact {{hr_contact}}.</p><p>Best regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>',
    'Dear {{candidate_name}},\n\nWelcome to onboarding for {{designation}} ({{department}}), joining {{joining_date}}. Please accept your HRM portal invite link and upload your KYC verification documents.\n\nBest regards,\n{{hr_contact}}',
    ARRAY['candidate_name', 'designation', 'department', 'joining_date', 'hr_contact']
  ),
  (
    'document_reminder',
    'Document Reminder',
    'onboarding',
    'Action Required: Pending Onboarding Documents | The AI School',
    '<p>Dear {{candidate_name}},</p><p>This is a gentle reminder to upload your pending onboarding &amp; KYC verification documents on The AI School HRM portal ahead of your joining date (<strong>{{joining_date}}</strong>) as <strong>{{designation}}</strong> ({{department}}).</p><p>Your employee account is activated once all required documents are verified by HR. Reach out to {{hr_contact}} if you face any issues.</p><p>Best regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>',
    'Dear {{candidate_name}},\n\nPlease complete uploading your pending onboarding & KYC documents on The AI School HRM portal ahead of {{joining_date}} ({{designation}}, {{department}}).\n\nBest regards,\n{{hr_contact}}',
    ARRAY['candidate_name', 'designation', 'department', 'joining_date', 'hr_contact']
  ),
  (
    'employee_welcome',
    'Employee Welcome',
    'onboarding',
    'Welcome to The AI School — Employee ID {{employee_id}}',
    '<p>Dear {{candidate_name}},</p><p>Welcome officially to <strong>The AI School</strong>! Your onboarding as <strong>{{designation}}</strong> in <strong>{{department}}</strong> (Joining Date: <strong>{{joining_date}}</strong>) is underway with Employee ID <strong>{{employee_id}}</strong>.</p><p>Sign in to the HRM portal to view your assigned projects, record daily attendance, log hourly tasks, and submit End-of-Day updates.</p><p>Warmest welcome,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>',
    'Dear {{candidate_name}},\n\nWelcome officially to The AI School! Role: {{designation}} ({{department}}), Employee ID: {{employee_id}}, Joining Date: {{joining_date}}.\n\nWarmest welcome,\n{{hr_contact}}',
    ARRAY['candidate_name', 'designation', 'department', 'joining_date', 'employee_id', 'hr_contact']
  )
ON CONFLICT (slug) DO NOTHING;

