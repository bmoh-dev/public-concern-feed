REVOKE EXECUTE ON FUNCTION public.rl_check_and_consume(text, text, integer, integer, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rl_check_and_consume(text, text, integer, integer, uuid, integer) TO service_role;
