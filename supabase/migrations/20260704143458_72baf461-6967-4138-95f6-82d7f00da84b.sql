
-- 1. Recreate missing guard helpers so complaint UPDATE stops crashing
CREATE OR REPLACE FUNCTION public.is_global_admin(p_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_uid AND role = 'global_admin');
$$;

CREATE OR REPLACE FUNCTION public.is_municipality_admin(p_uid uuid, p_muni uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.municipality_members
    WHERE user_id = p_uid AND municipality_id = p_muni AND role IN ('admin','super_admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_department(p_uid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT department_id FROM public.department_admins WHERE user_id = p_uid LIMIT 1;
$$;

-- 2. Add new platform-wide category enum values (idempotent)
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'roads','water_sewage','parks_green','markets',
    'traffic_transport','environment','public_health','public_buildings'
  ]
  LOOP
    BEGIN
      EXECUTE format('ALTER TYPE public.complaint_category ADD VALUE IF NOT EXISTS %L', v);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- 3. Update INSERT trigger to keep working when no department exists
--    (server also resolves; leave assigned_department_id NULL if no match).
CREATE OR REPLACE FUNCTION public.assign_complaint_department()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.assigned_department_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT id INTO NEW.assigned_department_id
    FROM public.departments
    WHERE municipality_id = NEW.municipality_id
      AND slug = NEW.category::text
      AND is_active = true
    LIMIT 1;
  RETURN NEW;
END $$;

-- 4. Historical auto-assignment: when a department is created whose slug
--    matches a category, assign unassigned, non-resolved complaints of
--    that category in the same municipality to it. Solved and already
--    assigned complaints are left untouched.
CREATE OR REPLACE FUNCTION public.assign_historical_complaints_to_department(
  p_caller uuid, p_department_id uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_muni uuid;
  v_slug text;
  v_is_super boolean;
  v_updated integer;
BEGIN
  IF p_caller IS NULL OR p_department_id IS NULL THEN RETURN 0; END IF;
  SELECT municipality_id, slug INTO v_muni, v_slug
    FROM public.departments WHERE id = p_department_id;
  IF v_muni IS NULL THEN RETURN 0; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.municipality_members mm
    JOIN public.municipalities m ON m.id = mm.municipality_id
    WHERE mm.user_id = p_caller AND mm.municipality_id = v_muni
      AND mm.role = 'super_admin' AND m.status = 'verified'
  ) INTO v_is_super;
  IF NOT v_is_super THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Only match if slug is a valid category enum value
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'complaint_category' AND e.enumlabel = v_slug
  ) THEN
    RETURN 0;
  END IF;

  WITH upd AS (
    UPDATE public.complaints
       SET assigned_department_id = p_department_id
     WHERE municipality_id = v_muni
       AND assigned_department_id IS NULL
       AND status <> 'resolved'
       AND category::text = v_slug
     RETURNING 1
  )
  SELECT count(*)::int INTO v_updated FROM upd;
  RETURN v_updated;
END $$;

-- 5. Bulk transfer: caller must be muni admin of every affected complaint.
--    Target may be NULL (unassign → back to Municipality General Admin) or
--    a department in the SAME municipality as each complaint.
CREATE OR REPLACE FUNCTION public.bulk_transfer_complaints(
  p_caller uuid, p_complaint_ids uuid[], p_to_department_id uuid
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_muni uuid;
  v_updated integer := 0;
  r record;
BEGIN
  IF p_caller IS NULL OR p_complaint_ids IS NULL THEN RETURN 0; END IF;
  IF p_to_department_id IS NOT NULL THEN
    SELECT municipality_id INTO v_muni FROM public.departments WHERE id = p_to_department_id;
    IF v_muni IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  END IF;

  FOR r IN
    SELECT id, municipality_id, assigned_department_id
      FROM public.complaints WHERE id = ANY (p_complaint_ids)
  LOOP
    -- Caller must be muni admin of this complaint's municipality.
    IF NOT public.is_municipality_admin(p_caller, r.municipality_id) THEN CONTINUE; END IF;
    -- If a target dept is provided, it must belong to the same municipality.
    IF p_to_department_id IS NOT NULL AND v_muni <> r.municipality_id THEN CONTINUE; END IF;
    IF r.assigned_department_id IS NOT DISTINCT FROM p_to_department_id THEN CONTINUE; END IF;

    UPDATE public.complaints
       SET assigned_department_id = p_to_department_id
     WHERE id = r.id;

    INSERT INTO public.complaint_routing_history
      (complaint_id, from_department_id, to_department_id, actor_user_id, reason)
    VALUES (r.id, r.assigned_department_id, p_to_department_id, p_caller, 'bulk transfer');

    v_updated := v_updated + 1;
  END LOOP;
  RETURN v_updated;
END $$;
