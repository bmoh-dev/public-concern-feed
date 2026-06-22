CREATE OR REPLACE FUNCTION public.transfer_global_admin(target_user uuid)
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
  IF target_user IS NULL THEN
    RAISE EXCEPTION 'target_user is required';
  END IF;
  IF target_user = uid THEN
    RAISE EXCEPTION 'لا يمكن نقل المسؤولية إلى نفسك' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.platform_settings WHERE id = true FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role = 'global_admin') THEN
    RAISE EXCEPTION 'Forbidden: caller is not a global admin' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = target_user) THEN
    RAISE EXCEPTION 'لم يتم العثور على المستخدم';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (target_user, 'global_admin')
  ON CONFLICT DO NOTHING;

  DELETE FROM public.user_roles WHERE user_id = uid AND role = 'global_admin';

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'global_admin') THEN
    RAISE EXCEPTION 'Transfer would leave platform without a global admin';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.transfer_global_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_global_admin(uuid) TO authenticated;
