-- 1) Extend the generic rate-limit RPC with an optional p_amount parameter,
--    so the SAME mechanism can count bytes (or any other unit), not just calls.
--    Existing callers continue to pass +1; new callers pass byte counts.

CREATE OR REPLACE FUNCTION public.rl_check_and_consume(
  p_subject text,
  p_action text,
  p_max integer,
  p_window_seconds integer,
  p_user uuid DEFAULT NULL,
  p_amount integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_window_start timestamptz;
  v_count integer;
  v_retry integer;
BEGIN
  IF p_subject IS NULL OR p_action IS NULL OR p_max < 1 OR p_window_seconds < 1 OR p_amount < 1 THEN
    RAISE EXCEPTION 'invalid rate limit parameters';
  END IF;

  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limit_counters(subject, action, window_start, window_seconds, count)
  VALUES (p_subject, p_action, v_window_start, p_window_seconds, p_amount)
  ON CONFLICT (subject, action, window_start)
  DO UPDATE SET count = public.rate_limit_counters.count + p_amount
  RETURNING count INTO v_count;

  IF v_count > p_max THEN
    -- roll the increment back so we don't punish callers for being over by N
    UPDATE public.rate_limit_counters
       SET count = GREATEST(0, count - p_amount)
     WHERE subject = p_subject AND action = p_action AND window_start = v_window_start;

    v_retry := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (v_window_start + make_interval(secs => p_window_seconds) - now())))::int
    );
    INSERT INTO public.rate_limit_blocks_log(user_id, action) VALUES (p_user, p_action);
    RETURN jsonb_build_object(
      'allowed', false,
      'count', v_count - p_amount,
      'max', p_max,
      'retry_after_seconds', v_retry,
      'reset_at', (v_window_start + make_interval(secs => p_window_seconds))
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'count', v_count,
    'max', p_max,
    'retry_after_seconds', 0,
    'reset_at', (v_window_start + make_interval(secs => p_window_seconds))
  );
END;
$function$;

-- 2) Automatic cleanup of expired counters and old block logs.
--    pg_cron runs rl_cleanup_old() once per day at 03:15 UTC.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Replace any previous schedule with the same name (idempotent).
DO $$
BEGIN
  PERFORM cron.unschedule('rl_cleanup_old_daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rl_cleanup_old_daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'rl_cleanup_old_daily',
  '15 3 * * *',
  $$ SELECT public.rl_cleanup_old(); $$
);
