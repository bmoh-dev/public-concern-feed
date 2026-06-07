-- Lock down SECURITY DEFINER helper functions: callable only by server code
-- (service_role) and database internals, never directly by signed-in clients.

REVOKE EXECUTE ON FUNCTION public.get_user_department(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_department_admin(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_user_department(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_department_admin(uuid) TO service_role;