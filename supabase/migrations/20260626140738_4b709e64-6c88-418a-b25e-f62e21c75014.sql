
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_global_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_municipality_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_municipality_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_municipality_super_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_department_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_department(uuid) TO authenticated;
