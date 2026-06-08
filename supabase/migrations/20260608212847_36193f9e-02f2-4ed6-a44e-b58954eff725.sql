
-- ============================================================
-- 1. EXTEND app_role ENUM (rebuild because Postgres can't use
--    a newly added enum value in the same transaction)
-- ============================================================

-- Drop dependents on the type
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role) CASCADE;

ALTER TABLE public.user_roles      ALTER COLUMN role          TYPE text USING role::text;
ALTER TABLE public.role_audit_log  ALTER COLUMN previous_role TYPE text USING previous_role::text;
ALTER TABLE public.role_audit_log  ALTER COLUMN new_role      TYPE text USING new_role::text;

DROP TYPE public.app_role;
CREATE TYPE public.app_role AS ENUM ('citizen', 'admin', 'super_admin', 'global_admin');

ALTER TABLE public.user_roles      ALTER COLUMN role          TYPE public.app_role USING role::public.app_role;
ALTER TABLE public.role_audit_log  ALTER COLUMN previous_role TYPE public.app_role USING previous_role::public.app_role;
ALTER TABLE public.role_audit_log  ALTER COLUMN new_role      TYPE public.app_role USING new_role::public.app_role;

-- Recreate has_role
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon, service_role;

-- ============================================================
-- 2. MUNICIPALITY STATUS ENUM
-- ============================================================
CREATE TYPE public.municipality_status AS ENUM ('pending', 'verified', 'rejected');

-- ============================================================
-- 3. MUNICIPALITIES TABLE
-- ============================================================
CREATE TABLE public.municipalities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  wilaya          text NOT NULL,
  owner_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status          public.municipality_status NOT NULL DEFAULT 'pending',
  verified_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at     timestamptz,
  rejection_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX municipalities_name_wilaya_unique
  ON public.municipalities (lower(name), lower(wilaya));

GRANT SELECT, INSERT, UPDATE ON public.municipalities TO authenticated;
GRANT SELECT ON public.municipalities TO anon;
GRANT ALL ON public.municipalities TO service_role;

ALTER TABLE public.municipalities ENABLE ROW LEVEL SECURITY;

-- Trigger: force status='pending' on INSERT, restrict UPDATE columns
CREATE OR REPLACE FUNCTION public.enforce_municipality_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.status := 'pending';
  NEW.verified_by := NULL;
  NEW.verified_at := NULL;
  NEW.rejection_reason := NULL;
  NEW.owner_user_id := auth.uid();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_enforce_municipality_insert
  BEFORE INSERT ON public.municipalities
  FOR EACH ROW EXECUTE FUNCTION public.enforce_municipality_insert();

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER trg_municipalities_touch
  BEFORE UPDATE ON public.municipalities
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- 4. MUNICIPALITY_MEMBERS TABLE
-- ============================================================
CREATE TABLE public.municipality_members (
  municipality_id uuid NOT NULL REFERENCES public.municipalities(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            public.app_role NOT NULL DEFAULT 'citizen',
  joined_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (municipality_id, user_id),
  CHECK (role IN ('citizen', 'admin', 'super_admin'))
);

GRANT SELECT ON public.municipality_members TO authenticated;
GRANT ALL ON public.municipality_members TO service_role;

ALTER TABLE public.municipality_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. HELPER FUNCTIONS (SECURITY DEFINER)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_global_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'global_admin') $$;

CREATE OR REPLACE FUNCTION public.is_municipality_member(_user_id uuid, _municipality_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.municipality_members WHERE user_id = _user_id AND municipality_id = _municipality_id) $$;

CREATE OR REPLACE FUNCTION public.is_municipality_super_admin(_user_id uuid, _municipality_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.municipality_members WHERE user_id = _user_id AND municipality_id = _municipality_id AND role = 'super_admin') $$;

CREATE OR REPLACE FUNCTION public.is_municipality_admin(_user_id uuid, _municipality_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.municipality_members WHERE user_id = _user_id AND municipality_id = _municipality_id AND role IN ('admin','super_admin')) $$;

REVOKE ALL ON FUNCTION public.is_global_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_municipality_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_municipality_super_admin(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_municipality_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_global_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_municipality_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_municipality_super_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_municipality_admin(uuid, uuid) TO authenticated;

-- ============================================================
-- 6. RLS POLICIES — municipalities
-- ============================================================
CREATE POLICY "Public can view verified municipalities"
  ON public.municipalities FOR SELECT TO anon, authenticated
  USING (status = 'verified');

CREATE POLICY "Owner can view own municipality"
  ON public.municipalities FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());

CREATE POLICY "Global admin can view all"
  ON public.municipalities FOR SELECT TO authenticated
  USING (public.is_global_admin(auth.uid()));

CREATE POLICY "Authenticated users can create municipalities"
  ON public.municipalities FOR INSERT TO authenticated
  WITH CHECK (true);  -- trigger forces owner=auth.uid(), status=pending

CREATE POLICY "Global admin can update municipalities"
  ON public.municipalities FOR UPDATE TO authenticated
  USING (public.is_global_admin(auth.uid()));

-- ============================================================
-- 7. RLS POLICIES — municipality_members
-- ============================================================
CREATE POLICY "User sees own memberships"
  ON public.municipality_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Super admin sees municipality memberships"
  ON public.municipality_members FOR SELECT TO authenticated
  USING (public.is_municipality_super_admin(auth.uid(), municipality_id));

CREATE POLICY "Global admin sees all memberships"
  ON public.municipality_members FOR SELECT TO authenticated
  USING (public.is_global_admin(auth.uid()));

-- All writes via service_role (server functions). No INSERT/UPDATE/DELETE policies for clients.

-- ============================================================
-- 8. PROTECT LAST SUPER ADMIN
-- ============================================================
CREATE OR REPLACE FUNCTION public.protect_last_super_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  was_super  boolean;
  is_super   boolean;
  remaining  integer;
  mid        uuid;
  m_status   public.municipality_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    was_super := (OLD.role = 'super_admin');
    is_super  := false;
    mid       := OLD.municipality_id;
  ELSIF TG_OP = 'UPDATE' THEN
    was_super := (OLD.role = 'super_admin');
    is_super  := (NEW.role = 'super_admin');
    mid       := OLD.municipality_id;
  ELSE
    RETURN NEW;
  END IF;

  IF was_super AND NOT is_super THEN
    SELECT status INTO m_status FROM public.municipalities WHERE id = mid;
    IF m_status = 'verified' THEN
      SELECT count(*) INTO remaining
        FROM public.municipality_members
        WHERE municipality_id = mid AND role = 'super_admin'
          AND user_id <> OLD.user_id;
      IF remaining = 0 THEN
        RAISE EXCEPTION 'You must assign another super admin before removing yourself.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_protect_last_super_admin
  BEFORE UPDATE OR DELETE ON public.municipality_members
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_super_admin();

-- ============================================================
-- 9. ADD municipality_id TO complaints & departments
-- ============================================================
ALTER TABLE public.complaints
  ADD COLUMN municipality_id  uuid REFERENCES public.municipalities(id) ON DELETE RESTRICT,
  ADD COLUMN legacy_imported  boolean NOT NULL DEFAULT false;

ALTER TABLE public.departments
  ADD COLUMN municipality_id  uuid REFERENCES public.municipalities(id) ON DELETE RESTRICT,
  ADD COLUMN legacy_imported  boolean NOT NULL DEFAULT false;

-- DB is empty, so we can enforce NOT NULL immediately
ALTER TABLE public.complaints   ALTER COLUMN municipality_id SET NOT NULL;
ALTER TABLE public.departments  ALTER COLUMN municipality_id SET NOT NULL;

-- Per-municipality unique slug for departments
ALTER TABLE public.departments DROP CONSTRAINT IF EXISTS departments_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS departments_municipality_slug_unique
  ON public.departments (municipality_id, slug);

CREATE INDEX IF NOT EXISTS complaints_municipality_idx  ON public.complaints (municipality_id);
CREATE INDEX IF NOT EXISTS departments_municipality_idx ON public.departments (municipality_id);

-- ============================================================
-- 10. UPDATE assign_complaint_department — scope to municipality
-- ============================================================
CREATE OR REPLACE FUNCTION public.assign_complaint_department()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_slug text;
BEGIN
  IF NEW.assigned_department_id IS NOT NULL THEN RETURN NEW; END IF;
  target_slug := CASE NEW.category
    WHEN 'infrastructure'    THEN 'infrastructure'
    WHEN 'public_lighting'   THEN 'public_lighting'
    WHEN 'cleanliness'       THEN 'cleaning_environment'
    ELSE 'general_administration'
  END;
  SELECT id INTO NEW.assigned_department_id
    FROM public.departments
    WHERE slug = target_slug AND municipality_id = NEW.municipality_id
    LIMIT 1;
  RETURN NEW;
END $$;

-- ============================================================
-- 11. UPDATE handle_new_user — auto-promote seed global admin
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url, google_sub)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.raw_user_meta_data->>'sub'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name  = EXCLUDED.full_name,
    email      = EXCLUDED.email,
    avatar_url = EXCLUDED.avatar_url,
    google_sub = EXCLUDED.google_sub,
    updated_at = now();

  -- Default citizen role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'citizen')
  ON CONFLICT DO NOTHING;

  -- Seed global admin (one-time, only if no global_admin exists yet)
  IF lower(NEW.email) = 'jelilebou@gmail.com'
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'global_admin') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'global_admin')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

-- ============================================================
-- 12. RLS update: complaints & departments scoped by municipality
-- ============================================================
-- Drop existing complaints policies so we can re-add municipality-aware ones
DROP POLICY IF EXISTS "Users can view own complaints"      ON public.complaints;
DROP POLICY IF EXISTS "Users can insert own complaints"    ON public.complaints;
DROP POLICY IF EXISTS "Users can update own complaints"    ON public.complaints;
DROP POLICY IF EXISTS "Admins can view all complaints"     ON public.complaints;
DROP POLICY IF EXISTS "Admins can update all complaints"   ON public.complaints;
DROP POLICY IF EXISTS "Department admins view department"  ON public.complaints;

CREATE POLICY "Owner sees own complaints"
  ON public.complaints FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Owner inserts own complaint in member municipality"
  ON public.complaints FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_municipality_member(auth.uid(), municipality_id)
    AND EXISTS (SELECT 1 FROM public.municipalities m
                WHERE m.id = municipality_id AND m.status = 'verified')
  );

CREATE POLICY "Owner updates own complaint"
  ON public.complaints FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Municipality admins view municipality complaints"
  ON public.complaints FOR SELECT TO authenticated
  USING (public.is_municipality_admin(auth.uid(), municipality_id));

CREATE POLICY "Municipality admins update municipality complaints"
  ON public.complaints FOR UPDATE TO authenticated
  USING (public.is_municipality_admin(auth.uid(), municipality_id));

CREATE POLICY "Global admin sees all complaints"
  ON public.complaints FOR SELECT TO authenticated
  USING (public.is_global_admin(auth.uid()));

-- Departments
DROP POLICY IF EXISTS "Anyone can read departments" ON public.departments;
CREATE POLICY "Members view municipality departments"
  ON public.departments FOR SELECT TO authenticated
  USING (public.is_municipality_member(auth.uid(), municipality_id));
CREATE POLICY "Public reads departments of verified municipalities"
  ON public.departments FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.municipalities m
                 WHERE m.id = municipality_id AND m.status = 'verified'));
