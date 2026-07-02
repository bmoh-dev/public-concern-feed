
CREATE OR REPLACE FUNCTION public.bootstrap_global_admin(p_caller uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_initialized timestamptz;
  v_existing_admins int;
BEGIN
  IF p_caller IS NULL THEN RAISE EXCEPTION 'caller required'; END IF;

  SELECT initialized_at INTO v_initialized FROM public.platform_settings WHERE id = true;
  IF v_initialized IS NOT NULL THEN
    RAISE EXCEPTION 'bootstrap already completed';
  END IF;

  SELECT COUNT(*) INTO v_existing_admins FROM public.user_roles WHERE role = 'global_admin';
  IF v_existing_admins > 0 THEN
    RAISE EXCEPTION 'bootstrap already completed';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_caller, 'global_admin')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.platform_settings (id, initialized_at, initialized_by)
  VALUES (true, now(), p_caller)
  ON CONFLICT (id) DO UPDATE
    SET initialized_at = EXCLUDED.initialized_at,
        initialized_by = EXCLUDED.initialized_by;
END;
$$;
