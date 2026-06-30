
-- 1) Hide sensitive municipality identifiers from anonymous viewers.
REVOKE SELECT (owner_user_id, verified_by, verified_at, rejection_reason)
  ON public.municipalities FROM anon;

-- 2) Hide complaint internal_notes from all client roles.
--    Only service_role (used by trusted server functions) may read or write it.
REVOKE SELECT (internal_notes), UPDATE (internal_notes)
  ON public.complaints FROM anon, authenticated;

-- 3) Lock down rate-limit infrastructure tables. Only the SECURITY DEFINER
--    rl_* helpers (owned by postgres) need access; no client role does.
REVOKE ALL ON public.rate_limit_counters FROM anon, authenticated;
REVOKE ALL ON public.rate_limit_blocks_log FROM anon, authenticated;

-- 4) Move admin SECURITY DEFINER functions off authenticated-callable surface.
--    They now require an explicit caller uuid and are only callable via
--    service_role (used by trusted server functions).
CREATE OR REPLACE FUNCTION public.bootstrap_global_admin(p_caller uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  existing_count int;
BEGIN
  IF p_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.platform_settings WHERE id = true FOR UPDATE;
  SELECT count(*) INTO existing_count FROM public.user_roles WHERE role = 'global_admin';
  IF existing_count > 0 THEN
    RAISE EXCEPTION 'Platform already initialized' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (p_caller, 'global_admin')
    ON CONFLICT DO NOTHING;
  UPDATE public.platform_settings
    SET initialized_at = now(), initialized_by = p_caller
    WHERE id = true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.abandon_global_admin(p_caller uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE remaining int;
BEGIN
  IF p_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.platform_settings WHERE id = true FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_caller AND role = 'global_admin') THEN
    RAISE EXCEPTION 'You are not a global admin' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO remaining FROM public.user_roles WHERE role = 'global_admin' AND user_id <> p_caller;
  IF remaining = 0 THEN
    RAISE EXCEPTION 'Cannot abandon: you are the last global admin' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = p_caller AND role = 'global_admin';
END;
$function$;

CREATE OR REPLACE FUNCTION public.promote_global_admin(p_caller uuid, target_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_caller AND role = 'global_admin') THEN
    RAISE EXCEPTION 'Forbidden: caller is not a global admin' USING ERRCODE = '42501';
  END IF;
  IF target_user IS NULL THEN
    RAISE EXCEPTION 'target_user is required';
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (target_user, 'global_admin')
    ON CONFLICT DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.transfer_global_admin(p_caller uuid, target_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF target_user IS NULL THEN
    RAISE EXCEPTION 'target_user is required';
  END IF;
  IF target_user = p_caller THEN
    RAISE EXCEPTION 'لا يمكن نقل المسؤولية إلى نفسك' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.platform_settings WHERE id = true FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_caller AND role = 'global_admin') THEN
    RAISE EXCEPTION 'Forbidden: caller is not a global admin' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user) THEN
    RAISE EXCEPTION 'لم يتم العثور على المستخدم';
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (target_user, 'global_admin')
    ON CONFLICT DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id = p_caller AND role = 'global_admin';
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'global_admin') THEN
    RAISE EXCEPTION 'Transfer would leave platform without a global admin';
  END IF;
END;
$function$;

-- Drop the old auth.uid()-based variants and lock execute to service_role only.
DROP FUNCTION IF EXISTS public.bootstrap_global_admin();
DROP FUNCTION IF EXISTS public.abandon_global_admin();
DROP FUNCTION IF EXISTS public.promote_global_admin(uuid);
DROP FUNCTION IF EXISTS public.transfer_global_admin(uuid);

REVOKE ALL ON FUNCTION public.bootstrap_global_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abandon_global_admin(uuid)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.promote_global_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_global_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_global_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.abandon_global_admin(uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_global_admin(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.transfer_global_admin(uuid, uuid) TO service_role;
