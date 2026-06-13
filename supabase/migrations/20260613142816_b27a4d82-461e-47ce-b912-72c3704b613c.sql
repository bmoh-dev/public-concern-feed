
-- Singleton settings table
CREATE TABLE public.platform_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  initialized_at timestamptz,
  initialized_by uuid
);

GRANT SELECT ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read platform settings"
  ON public.platform_settings FOR SELECT
  TO authenticated USING (true);

INSERT INTO public.platform_settings (id) VALUES (true);

-- Bootstrap: first global admin
CREATE OR REPLACE FUNCTION public.bootstrap_global_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  existing_count int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Lock the settings row for the transaction
  PERFORM 1 FROM public.platform_settings WHERE id = true FOR UPDATE;

  SELECT count(*) INTO existing_count
    FROM public.user_roles WHERE role = 'global_admin';

  IF existing_count > 0 THEN
    RAISE EXCEPTION 'Platform already initialized' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (uid, 'global_admin')
  ON CONFLICT DO NOTHING;

  UPDATE public.platform_settings
    SET initialized_at = now(), initialized_by = uid
    WHERE id = true;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_global_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_global_admin() TO authenticated;

-- Promote another user
CREATE OR REPLACE FUNCTION public.promote_global_admin(target_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = uid AND role = 'global_admin'
  ) THEN
    RAISE EXCEPTION 'Forbidden: caller is not a global admin' USING ERRCODE = '42501';
  END IF;

  IF target_user IS NULL THEN
    RAISE EXCEPTION 'target_user is required';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user, 'global_admin')
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_global_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_global_admin(uuid) TO authenticated;

-- Abandon role (self only, not if last)
CREATE OR REPLACE FUNCTION public.abandon_global_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  remaining int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.platform_settings WHERE id = true FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = uid AND role = 'global_admin'
  ) THEN
    RAISE EXCEPTION 'You are not a global admin' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO remaining
    FROM public.user_roles
    WHERE role = 'global_admin' AND user_id <> uid;

  IF remaining = 0 THEN
    RAISE EXCEPTION 'Cannot abandon: you are the last global admin' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = uid AND role = 'global_admin';
END;
$$;

REVOKE ALL ON FUNCTION public.abandon_global_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abandon_global_admin() TO authenticated;
