-- Migration: 20261118120000_break_architecture_and_personalized_approvals.sql
-- Enforces fixed break policies (Lunch 13:30-14:30, Short 16:45-17:00),
-- dedicated personalized break requests with HR approval, and concurrency safety.

-- 1. Create break_requests table for personalized breaks requiring HR approval
CREATE TABLE IF NOT EXISTS public.break_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_date date NOT NULL DEFAULT current_ist_date(),
  requested_minutes integer NOT NULL CHECK (requested_minutes > 0 AND requested_minutes <= 480),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'consumed', 'cancelled')),
  approved_minutes integer CHECK (approved_minutes IS NULL OR approved_minutes > 0),
  decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  consumed_break_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT check_no_self_approval CHECK (decided_by IS NULL OR decided_by <> user_id)
);

-- Index for lookup by user and date
CREATE INDEX IF NOT EXISTS idx_break_requests_user_date ON public.break_requests(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_break_requests_status ON public.break_requests(status);

-- 2. Alter break_logs to store policy snapshots, overtime and expected deadlines
ALTER TABLE public.break_logs
  ADD COLUMN IF NOT EXISTS expected_end_at timestamptz,
  ADD COLUMN IF NOT EXISTS allowed_minutes integer,
  ADD COLUMN IF NOT EXISTS overtime_seconds integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS return_status text DEFAULT 'on_time',
  ADD COLUMN IF NOT EXISTS break_request_id uuid REFERENCES public.break_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_legacy boolean DEFAULT false;

-- Add foreign key back to break_requests.consumed_break_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'break_requests_consumed_break_id_fkey'
  ) THEN
    ALTER TABLE public.break_requests
      ADD CONSTRAINT break_requests_consumed_break_id_fkey
      FOREIGN KEY (consumed_break_id) REFERENCES public.break_logs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Mark existing historical break records as legacy so they are not treated as violations
UPDATE public.break_logs
SET is_legacy = true
WHERE is_legacy IS NULL OR is_legacy = false;

-- 3. Concurrency Protection & Integrity Constraints
-- Partial unique index: exactly ONE open break allowed per user at any time
CREATE UNIQUE INDEX IF NOT EXISTS idx_break_logs_single_open_per_user
  ON public.break_logs(user_id)
  WHERE ended_at IS NULL;

-- Partial unique indexes: at most 1 fixed lunch break and 1 fixed short break per day (excluding legacy test rows)
CREATE UNIQUE INDEX IF NOT EXISTS idx_break_logs_single_lunch_per_day
  ON public.break_logs(day_id)
  WHERE category = 'lunch' AND is_legacy = false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_break_logs_single_short_break_per_day
  ON public.break_logs(day_id)
  WHERE category = 'short_break' AND is_legacy = false;

-- 4. RLS for break_requests
ALTER TABLE public.break_requests ENABLE ROW LEVEL SECURITY;

-- Select own requests
DROP POLICY IF EXISTS break_requests_select_self ON public.break_requests;
CREATE POLICY break_requests_select_self ON public.break_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- HR, Admin and Super Admin can select all break requests
DROP POLICY IF EXISTS break_requests_select_hr ON public.break_requests;
CREATE POLICY break_requests_select_hr ON public.break_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('hr', 'admin', 'super_admin')
    )
  );

-- Insert own requests (status must start as pending)
DROP POLICY IF EXISTS break_requests_insert_self ON public.break_requests;
CREATE POLICY break_requests_insert_self ON public.break_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    status = 'pending' AND
    decided_by IS NULL AND
    decided_at IS NULL AND
    consumed_break_id IS NULL
  );

-- User can cancel their own pending request
DROP POLICY IF EXISTS break_requests_update_cancel_self ON public.break_requests;
CREATE POLICY break_requests_update_cancel_self ON public.break_requests
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid() AND status = 'cancelled');

-- HR / Admin / Super Admin can decide (approve/reject) other employees' requests (NEVER their own)
DROP POLICY IF EXISTS break_requests_update_decide_hr ON public.break_requests;
CREATE POLICY break_requests_update_decide_hr ON public.break_requests
  FOR UPDATE TO authenticated
  USING (
    user_id <> auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('hr', 'admin', 'super_admin')
    )
  )
  WITH CHECK (
    user_id <> auth.uid() AND
    decided_by = auth.uid()
  );

-- Service role full access
GRANT ALL ON public.break_requests TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.break_requests TO authenticated;

-- 5. Harden break_logs RLS
-- Revoke delete for authenticated users (breaks are non-deletable audit records)
DROP POLICY IF EXISTS breaks_delete_self ON public.break_logs;

-- Restrict update so employees can only end an currently open break
DROP POLICY IF EXISTS breaks_update_self ON public.break_logs;
CREATE POLICY breaks_update_self ON public.break_logs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND ended_at IS NULL)
  WITH CHECK (user_id = auth.uid());
