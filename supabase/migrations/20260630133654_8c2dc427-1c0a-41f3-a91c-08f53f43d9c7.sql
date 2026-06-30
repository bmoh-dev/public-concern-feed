DROP FUNCTION IF EXISTS public.bootstrap_global_admin();
DROP FUNCTION IF EXISTS public.bootstrap_global_admin(uuid);
DROP FUNCTION IF EXISTS public.promote_global_admin(uuid);
DROP FUNCTION IF EXISTS public.promote_global_admin(uuid, uuid);
DROP FUNCTION IF EXISTS public.abandon_global_admin();
DROP FUNCTION IF EXISTS public.abandon_global_admin(uuid);
DROP FUNCTION IF EXISTS public.transfer_global_admin(uuid);
DROP FUNCTION IF EXISTS public.transfer_global_admin(uuid, uuid);

CREATE OR REPLACE FUNCTION public.bootstrap_global_admin(p_caller uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done boolean;
BEGIN
  IF p_caller IS NULL THEN RAISE EXCEPTION 'caller required'; END IF;
  SELECT bootstrap_done INTO v_done FROM public.platform_settings WHERE id = 1;
  IF v_done THEN RAISE EXCEPTION 'bootstrap already completed'; END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_caller, 'global_admin')
  ON CONFLICT DO NOTHING;

  UPDATE public.platform_settings
  SET bootstrap_done = true,
      bootstrapped_by = p_caller,
      bootstrapped_at = now()
  WHERE id = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_global_admin(p_caller uuid, target_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_caller IS NULL OR target_user IS NULL THEN RAISE EXCEPTION 'arguments required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_caller AND role = 'global_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user, 'global_admin')
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.abandon_global_admin(p_caller uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  IF p_caller IS NULL THEN RAISE EXCEPTION 'caller required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_caller AND role = 'global_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT COUNT(*) INTO v_count FROM public.user_roles WHERE role = 'global_admin';
  IF v_count <= 1 THEN
    RAISE EXCEPTION 'cannot abandon: you are the only global admin';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = p_caller AND role = 'global_admin';
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_global_admin(p_caller uuid, target_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_caller IS NULL OR target_user IS NULL THEN RAISE EXCEPTION 'arguments required'; END IF;
  IF p_caller = target_user THEN RAISE EXCEPTION 'cannot transfer to self'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_caller AND role = 'global_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user, 'global_admin')
  ON CONFLICT DO NOTHING;
  DELETE FROM public.user_roles WHERE user_id = p_caller AND role = 'global_admin';
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_global_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.promote_global_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.abandon_global_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_global_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_global_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_global_admin(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.abandon_global_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.transfer_global_admin(uuid, uuid) TO service_role;

REVOKE SELECT (internal_notes) ON public.complaints FROM anon, authenticated;
REVOKE UPDATE (internal_notes) ON public.complaints FROM anon, authenticated;

REVOKE SELECT (owner_user_id, verified_by, verified_at, rejection_reason)
  ON public.municipalities FROM anon;

REVOKE ALL ON public.rate_limit_counters FROM anon, authenticated;
REVOKE ALL ON public.rate_limit_blocks_log FROM anon, authenticated;