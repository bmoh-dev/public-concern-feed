
ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Municipality super_admin: create a department (name + slug) for their municipality.
CREATE OR REPLACE FUNCTION public.create_department(
  p_caller uuid,
  p_municipality_id uuid,
  p_slug text,
  p_name_ar text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_super boolean;
  v_id uuid;
  v_slug text;
  v_name text;
BEGIN
  IF p_caller IS NULL OR p_municipality_id IS NULL THEN
    RAISE EXCEPTION 'arguments required';
  END IF;
  v_slug := lower(regexp_replace(coalesce(p_slug, ''), '[^a-z0-9_-]+', '_', 'g'));
  v_name := btrim(coalesce(p_name_ar, ''));
  IF v_slug = '' OR v_name = '' THEN
    RAISE EXCEPTION 'invalid input';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.municipality_members mm
    JOIN public.municipalities m ON m.id = mm.municipality_id
    WHERE mm.user_id = p_caller
      AND mm.municipality_id = p_municipality_id
      AND mm.role = 'super_admin'
      AND m.status = 'verified'
  ) INTO v_is_super;
  IF NOT v_is_super THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF EXISTS (SELECT 1 FROM public.departments
             WHERE municipality_id = p_municipality_id AND slug = v_slug) THEN
    RAISE EXCEPTION 'duplicate';
  END IF;

  INSERT INTO public.departments (municipality_id, slug, name_ar, is_active)
  VALUES (p_municipality_id, v_slug, v_name, true)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Municipality super_admin: rename a department in their municipality.
CREATE OR REPLACE FUNCTION public.rename_department(
  p_caller uuid,
  p_department_id uuid,
  p_name_ar text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_muni uuid;
  v_is_super boolean;
  v_name text;
BEGIN
  v_name := btrim(coalesce(p_name_ar, ''));
  IF p_caller IS NULL OR p_department_id IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'arguments required';
  END IF;
  SELECT municipality_id INTO v_muni FROM public.departments WHERE id = p_department_id;
  IF v_muni IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.municipality_members mm
    JOIN public.municipalities m ON m.id = mm.municipality_id
    WHERE mm.user_id = p_caller
      AND mm.municipality_id = v_muni
      AND mm.role = 'super_admin'
      AND m.status = 'verified'
  ) INTO v_is_super;
  IF NOT v_is_super THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.departments SET name_ar = v_name WHERE id = p_department_id;
END;
$$;

-- Municipality super_admin: toggle active/disabled.
CREATE OR REPLACE FUNCTION public.set_department_active(
  p_caller uuid,
  p_department_id uuid,
  p_is_active boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_muni uuid;
  v_is_super boolean;
BEGIN
  IF p_caller IS NULL OR p_department_id IS NULL OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'arguments required';
  END IF;
  SELECT municipality_id INTO v_muni FROM public.departments WHERE id = p_department_id;
  IF v_muni IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.municipality_members mm
    JOIN public.municipalities m ON m.id = mm.municipality_id
    WHERE mm.user_id = p_caller
      AND mm.municipality_id = v_muni
      AND mm.role = 'super_admin'
      AND m.status = 'verified'
  ) INTO v_is_super;
  IF NOT v_is_super THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.departments SET is_active = p_is_active WHERE id = p_department_id;
END;
$$;
