REVOKE EXECUTE ON FUNCTION public.get_user_department(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_department_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_complaint_department() FROM PUBLIC, anon, authenticated;
