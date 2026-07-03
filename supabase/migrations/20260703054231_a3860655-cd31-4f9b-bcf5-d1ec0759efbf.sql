
CREATE OR REPLACE FUNCTION public.delete_department_atomic(p_caller uuid, p_department_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_muni uuid;
  v_is_super boolean;
BEGIN
  IF p_caller IS NULL OR p_department_id IS NULL THEN
    RAISE EXCEPTION 'arguments required';
  END IF;

  SELECT municipality_id INTO v_muni FROM public.departments WHERE id = p_department_id;
  IF v_muni IS NULL THEN
    RAISE EXCEPTION 'department not found';
  END IF;

  -- Caller must be super_admin of the department's municipality, and that
  -- municipality must be verified.
  SELECT EXISTS (
    SELECT 1 FROM public.municipality_members mm
    JOIN public.municipalities m ON m.id = mm.municipality_id
    WHERE mm.user_id = p_caller
      AND mm.municipality_id = v_muni
      AND mm.role = 'super_admin'
      AND m.status = 'verified'
  ) INTO v_is_super;

  IF NOT v_is_super THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Atomic: null out complaints, remove department-admin assignments
  -- (which auto-demotes those users back to citizen — role is derived
  -- from department_admins presence), then delete the department.
  UPDATE public.complaints
     SET assigned_department_id = NULL
   WHERE assigned_department_id = p_department_id;

  DELETE FROM public.department_admins
   WHERE department_id = p_department_id;

  DELETE FROM public.departments WHERE id = p_department_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_department_atomic(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_department_atomic(uuid, uuid) TO authenticated, service_role;
