-- ============================================================================
-- Migration: KYC review history, authoritative KYC state & notification outbox
-- ----------------------------------------------------------------------------
-- Additive and backward compatible. Does NOT send email by itself and does NOT
-- create notifications for decisions made before this migration (the backfill
-- writes state only — no outbox rows).
--
--   1. kyc_required_document_types()  — single SQL source for required KYC docs
--                                        (parity with REQUIRED_DOCUMENT_TYPES is
--                                        asserted by unit tests).
--   2. documents.revision              — version number per (employee, doc type).
--   3. document_review_events          — append-only history: every submission,
--                                        resubmission, verification, rejection
--                                        and replacement is preserved.
--   4. employee_kyc_state              — authoritative per-employee KYC status
--                                        with a completion "cycle" counter.
--   5. kyc_notification_outbox         — transactional outbox. Events are
--                                        written in the SAME transaction as the
--                                        HR decision; delivery (Hostinger SMTP)
--                                        happens afterwards, is retryable, and
--                                        can never roll back a KYC decision.
--   6. DB-level review guards          — no self-review, verifier role check,
--                                        mandatory rejection reason, reviewer
--                                        identity stamped server-side.
-- ============================================================================

-- 1. Required KYC document types ---------------------------------------------
CREATE OR REPLACE FUNCTION public.kyc_required_document_types()
RETURNS public.document_type[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['resume','identity_proof','pan','bank_details','education']::public.document_type[];
$$;

-- 2. Revision column -----------------------------------------------------------
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;

-- 3. Append-only review history ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid,                      -- no FK: current rows are replaced on resubmission
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doc_type public.document_type NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  event text NOT NULL
    CHECK (event IN ('submitted', 'resubmitted', 'verified', 'rejected', 'returned', 'replaced')),
  status_before public.document_status,
  status_after public.document_status,
  review_note text,
  file_path text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_review_events_user_type_idx
  ON public.document_review_events (user_id, doc_type, created_at DESC);

ALTER TABLE public.document_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_review_events FROM anon, authenticated;
GRANT SELECT ON public.document_review_events TO authenticated;
GRANT ALL ON public.document_review_events TO service_role;

DROP POLICY IF EXISTS document_review_events_select ON public.document_review_events;
CREATE POLICY document_review_events_select ON public.document_review_events
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR (
    public.has_permission(auth.uid(), 'documents:read:all')
    AND (public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'super_admin'))
  )
);

-- 4. Authoritative KYC state ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_kyc_state (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'incomplete', 'under_review', 'correction_required', 'verified')),
  required_count integer NOT NULL DEFAULT 0,
  verified_count integer NOT NULL DEFAULT 0,
  pending_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  missing_count integer NOT NULL DEFAULT 0,
  -- Incremented each time a previously complete KYC is invalidated, so a later,
  -- genuinely new completion can notify again (once per cycle).
  cycle integer NOT NULL DEFAULT 1,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employee_kyc_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_kyc_state FROM anon, authenticated;
GRANT SELECT ON public.employee_kyc_state TO authenticated;
GRANT ALL ON public.employee_kyc_state TO service_role;

DROP POLICY IF EXISTS employee_kyc_state_select ON public.employee_kyc_state;
CREATE POLICY employee_kyc_state_select ON public.employee_kyc_state
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR (
    public.has_permission(auth.uid(), 'documents:read:all')
    AND (public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'super_admin'))
  )
);

-- 5. Transactional outbox ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kyc_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'kyc.all_required_documents_verified',
    'kyc.correction_requested',
    'kyc.document_rejected',
    'kyc.correction_resubmitted'
  )),
  dedupe_key text NOT NULL UNIQUE,
  kyc_cycle integer NOT NULL DEFAULT 1,
  source text NOT NULL DEFAULT 'automatic' CHECK (source IN ('automatic', 'manual')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error text,
  skip_reason text,
  email_message_id uuid REFERENCES public.email_messages(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kyc_notification_outbox_due_idx
  ON public.kyc_notification_outbox (status, available_at);
CREATE INDEX IF NOT EXISTS kyc_notification_outbox_user_idx
  ON public.kyc_notification_outbox (user_id, created_at DESC);

ALTER TABLE public.kyc_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kyc_notification_outbox FROM anon, authenticated;
GRANT SELECT ON public.kyc_notification_outbox TO authenticated;
GRANT ALL ON public.kyc_notification_outbox TO service_role;

-- Correction reasons live in the outbox context: HR / Super Admin only.
DROP POLICY IF EXISTS kyc_notification_outbox_select ON public.kyc_notification_outbox;
CREATE POLICY kyc_notification_outbox_select ON public.kyc_notification_outbox
FOR SELECT TO authenticated
USING (
  public.has_permission(auth.uid(), 'documents:read:all')
  AND (public.has_role(auth.uid(), 'hr') OR public.has_role(auth.uid(), 'super_admin'))
);

-- 6. State recomputation (emits outbox events on real transitions only) ----------
CREATE OR REPLACE FUNCTION public.recompute_employee_kyc_state(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req public.document_type[] := public.kyc_required_document_types();
  _total integer := coalesce(array_length(_req, 1), 0);
  _old public.employee_kyc_state;
  _verified integer := 0;
  _pending integer := 0;
  _rejected integer := 0;
  _missing integer := 0;
  _status text;
  _cycle integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.employee_kyc_state (user_id, status, required_count)
  VALUES (_user_id, 'not_started', _total)
  ON CONFLICT (user_id) DO NOTHING;

  -- Row lock serialises concurrent reviews of the same employee, so two HR
  -- members verifying the last two documents at once still emit exactly one
  -- completion event (the second waits, then counts committed data).
  SELECT * INTO _old FROM public.employee_kyc_state WHERE user_id = _user_id FOR UPDATE;

  SELECT
    count(*) FILTER (WHERE d.status = 'verified'),
    count(*) FILTER (WHERE d.status = 'pending'),
    count(*) FILTER (WHERE d.status = 'rejected')
  INTO _verified, _pending, _rejected
  FROM (
    SELECT DISTINCT ON (doc_type) doc_type, status
    FROM public.documents
    WHERE user_id = _user_id AND doc_type = ANY (_req)
    ORDER BY doc_type, created_at DESC
  ) d;

  _missing := greatest(_total - (_verified + _pending + _rejected), 0);

  _status := CASE
    WHEN _total > 0 AND _verified = _total THEN 'verified'
    WHEN _rejected > 0 THEN 'correction_required'
    WHEN _missing = _total THEN 'not_started'
    WHEN _missing > 0 THEN 'incomplete'
    ELSE 'under_review'
  END;

  _cycle := _old.cycle;
  IF _old.status = 'verified' AND _status <> 'verified' THEN
    _cycle := _cycle + 1;
  END IF;

  UPDATE public.employee_kyc_state
  SET status = _status,
      required_count = _total,
      verified_count = _verified,
      pending_count = _pending,
      rejected_count = _rejected,
      missing_count = _missing,
      cycle = _cycle,
      completed_at = CASE
        WHEN _status = 'verified' THEN coalesce(CASE WHEN _old.status = 'verified' THEN _old.completed_at END, now())
        ELSE NULL
      END,
      updated_at = now()
  WHERE user_id = _user_id;

  IF _status = 'verified' AND _old.status IS DISTINCT FROM 'verified' THEN
    INSERT INTO public.kyc_notification_outbox (user_id, event_type, dedupe_key, kyc_cycle, available_at)
    VALUES (
      _user_id,
      'kyc.all_required_documents_verified',
      'kyc_verified:' || _user_id::text || ':' || _cycle::text,
      _cycle,
      now()
    )
    ON CONFLICT (dedupe_key) DO NOTHING;

    -- Undelivered correction emails are now stale and must not be sent.
    UPDATE public.kyc_notification_outbox
    SET status = 'skipped',
        skip_reason = 'Superseded: KYC became fully verified before delivery.',
        processed_at = now(),
        updated_at = now()
    WHERE user_id = _user_id
      AND event_type = 'kyc.correction_requested'
      AND status = 'pending';
  END IF;

  RETURN _status;
END;
$$;

-- Groups rejections made within a short window into ONE correction email.
CREATE OR REPLACE FUNCTION public.enqueue_kyc_correction(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cycle integer;
BEGIN
  SELECT cycle INTO _cycle FROM public.employee_kyc_state WHERE user_id = _user_id;

  IF EXISTS (
    SELECT 1 FROM public.kyc_notification_outbox
    WHERE user_id = _user_id
      AND event_type = 'kyc.correction_requested'
      AND status = 'pending'
  ) THEN
    RETURN; -- an undelivered correction email exists; it is rendered from live state at send time
  END IF;

  INSERT INTO public.kyc_notification_outbox (user_id, event_type, dedupe_key, kyc_cycle, available_at)
  VALUES (
    _user_id,
    'kyc.correction_requested',
    'kyc_correction:' || _user_id::text || ':' || gen_random_uuid()::text,
    coalesce(_cycle, 1),
    now() + interval '3 minutes'
  );
END;
$$;

-- 7. Review guards (BEFORE UPDATE) ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.documents_enforce_review_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  NEW.revision := OLD.revision; -- immutable once assigned

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('verified', 'rejected') THEN
    IF _uid IS NOT NULL THEN
      IF NEW.user_id = _uid THEN
        RAISE EXCEPTION 'You cannot review your own KYC documents.' USING ERRCODE = '42501';
      END IF;
      IF NOT (
        public.has_permission(_uid, 'documents:verify:all')
        AND (public.has_role(_uid, 'hr') OR public.has_role(_uid, 'super_admin'))
      ) THEN
        RAISE EXCEPTION 'Only HR or Super Admin can verify KYC documents.' USING ERRCODE = '42501';
      END IF;
      NEW.reviewed_by := _uid;
    END IF;
    NEW.reviewed_at := now();
    IF NEW.status = 'rejected' AND coalesce(btrim(NEW.review_note), '') = '' THEN
      RAISE EXCEPTION 'A correction reason is required when rejecting a document.' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documents_enforce_review_rules ON public.documents;
CREATE TRIGGER trg_documents_enforce_review_rules
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_enforce_review_rules();

-- 8. Revision assignment (BEFORE INSERT) -----------------------------------------
CREATE OR REPLACE FUNCTION public.documents_assign_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT coalesce(max(revision), 0) + 1
  INTO NEW.revision
  FROM public.document_review_events
  WHERE user_id = NEW.user_id AND doc_type = NEW.doc_type;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documents_assign_revision ON public.documents;
CREATE TRIGGER trg_documents_assign_revision
  BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_assign_revision();

-- 9. History + state + outbox (AFTER INSERT/UPDATE/DELETE) -----------------------
CREATE OR REPLACE FUNCTION public.documents_after_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _last_replaced public.document_status;
  _required boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status_before INTO _last_replaced
    FROM public.document_review_events
    WHERE user_id = NEW.user_id AND doc_type = NEW.doc_type AND event = 'replaced'
    ORDER BY created_at DESC
    LIMIT 1;

    INSERT INTO public.document_review_events
      (document_id, user_id, doc_type, revision, event, status_before, status_after, file_path, actor_id)
    VALUES
      (NEW.id, NEW.user_id, NEW.doc_type, NEW.revision,
       CASE WHEN NEW.revision > 1 THEN 'resubmitted' ELSE 'submitted' END,
       NULL, NEW.status, NEW.file_path, coalesce(_uid, NEW.user_id));

    PERFORM public.recompute_employee_kyc_state(NEW.user_id);

    IF _last_replaced = 'rejected' AND NEW.doc_type = ANY (public.kyc_required_document_types()) THEN
      INSERT INTO public.kyc_notification_outbox (user_id, event_type, dedupe_key, kyc_cycle)
      SELECT NEW.user_id, 'kyc.correction_resubmitted', 'kyc_resubmitted:' || NEW.id::text, s.cycle
      FROM public.employee_kyc_state s WHERE s.user_id = NEW.user_id
      ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.document_review_events
        (document_id, user_id, doc_type, revision, event, status_before, status_after, review_note, file_path, actor_id)
      VALUES
        (NEW.id, NEW.user_id, NEW.doc_type, NEW.revision,
         CASE NEW.status WHEN 'verified' THEN 'verified' WHEN 'rejected' THEN 'rejected' ELSE 'returned' END,
         OLD.status, NEW.status, NEW.review_note, NEW.file_path, coalesce(_uid, NEW.reviewed_by));

      PERFORM public.recompute_employee_kyc_state(NEW.user_id);

      _required := NEW.doc_type = ANY (public.kyc_required_document_types());
      IF NEW.status = 'rejected' AND _required THEN
        PERFORM public.enqueue_kyc_correction(NEW.user_id);
      END IF;
    END IF;
    RETURN NULL;
  END IF;

  -- DELETE (employee replacing a non-verified document, or profile removal)
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.user_id) THEN
    INSERT INTO public.document_review_events
      (document_id, user_id, doc_type, revision, event, status_before, status_after, review_note, file_path, actor_id)
    VALUES
      (OLD.id, OLD.user_id, OLD.doc_type, OLD.revision, 'replaced',
       OLD.status, NULL, OLD.review_note, OLD.file_path, coalesce(_uid, OLD.user_id));
    PERFORM public.recompute_employee_kyc_state(OLD.user_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_documents_after_change ON public.documents;
CREATE TRIGGER trg_documents_after_change
  AFTER INSERT OR UPDATE OR DELETE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_after_change();

-- 10. Outbox claim (service role only) -------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_kyc_notifications(
  _limit integer DEFAULT 20,
  _user_id uuid DEFAULT NULL,
  _ids uuid[] DEFAULT NULL
)
RETURNS SETOF public.kyc_notification_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.kyc_notification_outbox o
  SET status = 'processing',
      attempts = o.attempts + 1,
      locked_until = now() + interval '5 minutes',
      updated_at = now()
  WHERE o.id IN (
    SELECT q.id
    FROM public.kyc_notification_outbox q
    WHERE (
        (q.status = 'pending' AND q.available_at <= now())
        OR (q.status = 'processing' AND q.locked_until < now())
      )
      AND (_user_id IS NULL OR q.user_id = _user_id)
      AND (_ids IS NULL OR q.id = ANY (_ids))
    ORDER BY q.available_at
    LIMIT greatest(1, least(coalesce(_limit, 20), 100))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING o.*;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_employee_kyc_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_kyc_correction(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_kyc_notifications(integer, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_employee_kyc_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_kyc_correction(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_kyc_notifications(integer, uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.kyc_required_document_types() TO authenticated, service_role;

-- 11. Backfill state ONLY (no outbox rows → no retroactive emails) ----------------
INSERT INTO public.employee_kyc_state
  (user_id, status, required_count, verified_count, pending_count, rejected_count, missing_count, cycle, completed_at)
SELECT
  c.user_id,
  CASE
    WHEN c.verified = c.total THEN 'verified'
    WHEN c.rejected > 0 THEN 'correction_required'
    WHEN (c.total - c.verified - c.pending - c.rejected) = c.total THEN 'not_started'
    WHEN (c.total - c.verified - c.pending - c.rejected) > 0 THEN 'incomplete'
    ELSE 'under_review'
  END,
  c.total, c.verified, c.pending, c.rejected,
  greatest(c.total - c.verified - c.pending - c.rejected, 0),
  1,
  CASE WHEN c.verified = c.total THEN now() END
FROM (
  SELECT
    d.user_id,
    array_length(public.kyc_required_document_types(), 1) AS total,
    count(*) FILTER (WHERE d.status = 'verified') AS verified,
    count(*) FILTER (WHERE d.status = 'pending') AS pending,
    count(*) FILTER (WHERE d.status = 'rejected') AS rejected
  FROM (
    SELECT DISTINCT ON (user_id, doc_type) user_id, doc_type, status
    FROM public.documents
    WHERE doc_type = ANY (public.kyc_required_document_types())
    ORDER BY user_id, doc_type, created_at DESC
  ) d
  JOIN public.profiles p ON p.id = d.user_id
  GROUP BY d.user_id
) c
ON CONFLICT (user_id) DO NOTHING;
