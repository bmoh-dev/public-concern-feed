-- ============================================================
-- Generic rate limiting infrastructure
-- ============================================================

-- Counter table: one row per (subject, action, fixed-window-start)
CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  subject text NOT NULL,
  action text NOT NULL,
  window_start timestamptz NOT NULL,
  window_seconds integer NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (subject, action, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limit_counters_cleanup_idx
  ON public.rate_limit_counters (window_start);

GRANT ALL ON public.rate_limit_counters TO service_role;
ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
-- No policies: accessed only by SECURITY DEFINER RPCs / service_role.

-- Block log: minimal — user id (nullable), action, timestamp. No IPs persisted.
CREATE TABLE IF NOT EXISTS public.rate_limit_blocks_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action text NOT NULL,
  blocked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limit_blocks_log_blocked_at_idx
  ON public.rate_limit_blocks_log (blocked_at DESC);

GRANT ALL ON public.rate_limit_blocks_log TO service_role;
GRANT SELECT ON public.rate_limit_blocks_log TO authenticated;
ALTER TABLE public.rate_limit_blocks_log ENABLE ROW LEVEL SECURITY;

-- Only global admins may read the block log.
CREATE POLICY "Global admins read rate limit blocks"
  ON public.rate_limit_blocks_log
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'global_admin'
  ));

-- ============================================================
-- Atomic check-and-consume RPC. Fixed-window counter.
-- Returns: { allowed, count, max, retry_after_seconds }
-- ============================================================
CREATE OR REPLACE FUNCTION public.rl_check_and_consume(
  p_subject text,
  p_action text,
  p_max integer,
  p_window_seconds integer,
  p_user uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_count integer;
  v_retry integer;
BEGIN
  IF p_subject IS NULL OR p_action IS NULL OR p_max < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate limit parameters';
  END IF;

  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limit_counters(subject, action, window_start, window_seconds, count)
  VALUES (p_subject, p_action, v_window_start, p_window_seconds, 1)
  ON CONFLICT (subject, action, window_start)
  DO UPDATE SET count = public.rate_limit_counters.count + 1
  RETURNING count INTO v_count;

  IF v_count > p_max THEN
    v_retry := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_window_start + make_interval(secs => p_window_seconds) - now())))::int
    );
    INSERT INTO public.rate_limit_blocks_log(user_id, action) VALUES (p_user, p_action);
    RETURN jsonb_build_object(
      'allowed', false,
      'count', v_count,
      'max', p_max,
      'retry_after_seconds', v_retry
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'count', v_count,
    'max', p_max,
    'retry_after_seconds', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rl_check_and_consume(text, text, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rl_check_and_consume(text, text, integer, integer, uuid)
  TO service_role;

-- ============================================================
-- Cleanup helper (safe to call periodically; not user-callable)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rl_cleanup_old()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.rate_limit_counters
   WHERE window_start + make_interval(secs => window_seconds) < now() - interval '1 day';
  DELETE FROM public.rate_limit_blocks_log
   WHERE blocked_at < now() - interval '30 days';
$$;

REVOKE ALL ON FUNCTION public.rl_cleanup_old() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rl_cleanup_old() TO service_role;