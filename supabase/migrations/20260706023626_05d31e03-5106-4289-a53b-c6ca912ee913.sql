
REVOKE EXECUTE ON FUNCTION public.is_global_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_municipality_admin(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_department(uuid) FROM PUBLIC, anon;
