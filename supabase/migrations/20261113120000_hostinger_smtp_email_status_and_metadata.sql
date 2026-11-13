-- ============================================================================
-- Migration: Hostinger SMTP Email Transport, Delivery Statuses & HR Comm Templates
-- Additive, backward-compatible migration — preserves all existing email_messages
-- history, custom email_templates, accounts, and RBAC rules.
-- ============================================================================

-- 1. Add sanitized SMTP response metadata column and update default provider
ALTER TABLE public.email_messages
  ADD COLUMN IF NOT EXISTS smtp_response text;

ALTER TABLE public.email_messages
  ALTER COLUMN provider SET DEFAULT 'hostinger_smtp';

-- 2. Replace status CHECK constraint safely so both legacy ('sent') and
--    accurate SMTP statuses ('accepted_by_smtp', 'canceled') are permitted.
DO $$
DECLARE
  _constraint_name text;
BEGIN
  FOR _constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'email_messages'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.email_messages DROP CONSTRAINT IF EXISTS %I', _constraint_name);
  END LOOP;

  ALTER TABLE public.email_messages
    ADD CONSTRAINT email_messages_status_check
    CHECK (status IN (
      'draft',
      'queued',
      'sending',
      'accepted_by_smtp',
      'sent',
      'delivered',
      'failed',
      'canceled'
    ));
END $$;

-- 3. Seed additional HR Communication templates without overwriting custom edits
INSERT INTO public.email_templates (slug, name, category, subject_template, body_html_template, body_text_template, variables)
VALUES
  (
    'document_correction_request',
    'Document Correction Request',
    'onboarding',
    'Action Needed: Document Correction for Onboarding — {{candidate_name}} | The AI School',
    '<p>Dear {{candidate_name}},</p><p>Thank you for submitting your onboarding documents for <strong>{{designation}}</strong> ({{department}}) ahead of your joining date (<strong>{{joining_date}}</strong>).</p><p>During HR verification, one or more uploaded documents require a clearer copy or updated details. Please sign in to the HRM portal to re-upload the requested document(s).</p><p>For any assistance, reply to {{hr_contact}}.</p><p>Best regards,<br/>{{hr_contact}}<br/>The AI School HR</p>',
    'Dear {{candidate_name}},\n\nThank you for submitting your onboarding documents for {{designation}} ({{department}}) ahead of {{joining_date}}.\n\nOne or more uploaded documents require a clearer copy or updated details. Please sign in to The AI School HRM portal to upload the corrected document(s).\n\nFor assistance, contact {{hr_contact}}.\n\nBest regards,\n{{hr_contact}}',
    ARRAY['candidate_name', 'designation', 'department', 'joining_date', 'hr_contact']
  ),
  (
    'hr_announcement',
    'HR Announcement',
    'communications',
    'Important HR Announcement — {{department}} | The AI School',
    '<p>Dear {{candidate_name}},</p><p>Please review the latest HR update shared for the <strong>{{department}}</strong> team at <strong>The AI School</strong> via the HRM portal.</p><p>Sign in at <a href="{{portal_url}}" style="color:#e11d48;">{{portal_url}}</a> to view any action items or updated workplace guidelines.</p><p>Regards,<br/>{{hr_contact}}<br/>The AI School HR</p>',
    'Dear {{candidate_name}},\n\nPlease review the latest HR announcement shared for the {{department}} team at The AI School.\n\nSign in to the HRM portal ({{portal_url}}) for full details and any required follow-up.\n\nRegards,\n{{hr_contact}}',
    ARRAY['candidate_name', 'department', 'portal_url', 'hr_contact']
  ),
  (
    'work_notice',
    'Work-Related Notice',
    'communications',
    'Workforce Notice: {{designation}} ({{department}}) | The AI School',
    '<p>Dear {{candidate_name}},</p><p>This is an official work-related notice regarding your assignment as <strong>{{designation}}</strong> in the <strong>{{department}}</strong> department at <strong>The AI School</strong>.</p><p>Please review your schedule and updates in the HRM portal (<a href="{{portal_url}}" style="color:#e11d48;">{{portal_url}}</a>) and reply to {{hr_contact}} if clarification is needed.</p><p>Sincerely,<br/>{{hr_contact}}<br/>The AI School HR</p>',
    'Dear {{candidate_name}},\n\nThis is an official work-related notice regarding your assignment as {{designation}} ({{department}}) at The AI School.\n\nPlease review your updates at {{portal_url}} or reply to {{hr_contact}} with any questions.\n\nSincerely,\n{{hr_contact}}',
    ARRAY['candidate_name', 'designation', 'department', 'portal_url', 'hr_contact']
  )
ON CONFLICT (slug) DO NOTHING;

