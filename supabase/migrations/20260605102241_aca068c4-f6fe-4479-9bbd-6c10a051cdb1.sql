GRANT EXECUTE ON FUNCTION public.get_user_department(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_department_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;