
-- =====================================================================
-- 1. Create private schema for RLS helpers (not exposed via PostgREST)
-- =====================================================================
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO postgres, service_role, anon, authenticated;

-- Recreate helpers in private schema
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE OR REPLACE FUNCTION private.is_global_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'global_admin') $$;

CREATE OR REPLACE FUNCTION private.is_municipality_admin(_user_id uuid, _municipality_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.municipality_members WHERE user_id = _user_id AND municipality_id = _municipality_id AND role IN ('admin','super_admin')) $$;

CREATE OR REPLACE FUNCTION private.is_municipality_member(_user_id uuid, _municipality_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.municipality_members WHERE user_id = _user_id AND municipality_id = _municipality_id) $$;

CREATE OR REPLACE FUNCTION private.is_municipality_super_admin(_user_id uuid, _municipality_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.municipality_members WHERE user_id = _user_id AND municipality_id = _municipality_id AND role = 'super_admin') $$;

CREATE OR REPLACE FUNCTION private.is_department_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.department_admins WHERE user_id = _user_id) $$;

CREATE OR REPLACE FUNCTION private.get_user_department(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT department_id FROM public.department_admins WHERE user_id = _user_id LIMIT 1 $$;

-- Grant EXECUTE on private helpers to roles that may evaluate policies
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  private.has_role(uuid, public.app_role),
  private.is_global_admin(uuid),
  private.is_municipality_admin(uuid, uuid),
  private.is_municipality_member(uuid, uuid),
  private.is_municipality_super_admin(uuid, uuid),
  private.is_department_admin(uuid),
  private.get_user_department(uuid)
TO anon, authenticated, service_role;

-- =====================================================================
-- 2. Rewrite all policies that reference the old public helpers
-- =====================================================================

-- attachments
DROP POLICY IF EXISTS attachments_dept_admin_read ON public.attachments;
CREATE POLICY attachments_dept_admin_read ON public.attachments FOR SELECT
USING (EXISTS (SELECT 1 FROM public.complaints c
  WHERE c.id = attachments.complaint_id
    AND c.assigned_department_id = private.get_user_department(auth.uid())));

-- complaint_routing_history
DROP POLICY IF EXISTS "Municipality admin reads routing history" ON public.complaint_routing_history;
CREATE POLICY "Municipality admin reads routing history" ON public.complaint_routing_history FOR SELECT
USING (EXISTS (SELECT 1 FROM public.complaints c
  WHERE c.id = complaint_routing_history.complaint_id
    AND private.is_municipality_admin(auth.uid(), c.municipality_id)));

DROP POLICY IF EXISTS "Department admin reads routing history" ON public.complaint_routing_history;
CREATE POLICY "Department admin reads routing history" ON public.complaint_routing_history FOR SELECT
USING (EXISTS (SELECT 1 FROM public.complaints c
  WHERE c.id = complaint_routing_history.complaint_id
    AND c.assigned_department_id = private.get_user_department(auth.uid())));

DROP POLICY IF EXISTS "Global admin reads routing history" ON public.complaint_routing_history;
CREATE POLICY "Global admin reads routing history" ON public.complaint_routing_history FOR SELECT
USING (private.is_global_admin(auth.uid()));

-- complaints
DROP POLICY IF EXISTS "Municipality admins update municipality complaints" ON public.complaints;
CREATE POLICY "Municipality admins update municipality complaints" ON public.complaints FOR UPDATE
USING (private.is_municipality_admin(auth.uid(), municipality_id))
WITH CHECK (private.is_municipality_admin(auth.uid(), municipality_id));

DROP POLICY IF EXISTS "Global admin sees all complaints" ON public.complaints;
CREATE POLICY "Global admin sees all complaints" ON public.complaints FOR SELECT
USING (private.is_global_admin(auth.uid()));

DROP POLICY IF EXISTS "Municipality admins view municipality complaints" ON public.complaints;
CREATE POLICY "Municipality admins view municipality complaints" ON public.complaints FOR SELECT
USING (private.is_municipality_admin(auth.uid(), municipality_id));

DROP POLICY IF EXISTS "Owner inserts own complaint in member municipality" ON public.complaints;
CREATE POLICY "Owner inserts own complaint in member municipality" ON public.complaints FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND private.is_municipality_member(auth.uid(), municipality_id)
  AND EXISTS (SELECT 1 FROM public.municipalities m
    WHERE m.id = complaints.municipality_id AND m.status = 'verified')
);

DROP POLICY IF EXISTS complaints_dept_admin_read ON public.complaints;
CREATE POLICY complaints_dept_admin_read ON public.complaints FOR SELECT
USING (assigned_department_id = private.get_user_department(auth.uid()));

DROP POLICY IF EXISTS complaints_dept_admin_update ON public.complaints;
CREATE POLICY complaints_dept_admin_update ON public.complaints FOR UPDATE
USING (assigned_department_id = private.get_user_department(auth.uid()))
WITH CHECK (assigned_department_id = private.get_user_department(auth.uid()));

-- department_admins
DROP POLICY IF EXISTS department_admins_global_admin_read ON public.department_admins;
CREATE POLICY department_admins_global_admin_read ON public.department_admins FOR SELECT
USING (private.is_global_admin(auth.uid()));

DROP POLICY IF EXISTS department_admins_municipality_admin_read ON public.department_admins;
CREATE POLICY department_admins_municipality_admin_read ON public.department_admins FOR SELECT
USING (EXISTS (SELECT 1 FROM public.departments d
  WHERE d.id = department_admins.department_id
    AND private.is_municipality_admin(auth.uid(), d.municipality_id)));

-- departments
DROP POLICY IF EXISTS "Members view municipality departments" ON public.departments;
CREATE POLICY "Members view municipality departments" ON public.departments FOR SELECT
USING (private.is_municipality_member(auth.uid(), municipality_id));

-- municipalities
DROP POLICY IF EXISTS "Global admin can view all" ON public.municipalities;
CREATE POLICY "Global admin can view all" ON public.municipalities FOR SELECT
USING (private.is_global_admin(auth.uid()));

DROP POLICY IF EXISTS "Global admin can update municipalities" ON public.municipalities;
CREATE POLICY "Global admin can update municipalities" ON public.municipalities FOR UPDATE
USING (private.is_global_admin(auth.uid()))
WITH CHECK (private.is_global_admin(auth.uid()));

-- municipality_members
DROP POLICY IF EXISTS "Super admin sees municipality memberships" ON public.municipality_members;
CREATE POLICY "Super admin sees municipality memberships" ON public.municipality_members FOR SELECT
USING (private.is_municipality_super_admin(auth.uid(), municipality_id));

DROP POLICY IF EXISTS "Global admin sees all memberships" ON public.municipality_members;
CREATE POLICY "Global admin sees all memberships" ON public.municipality_members FOR SELECT
USING (private.is_global_admin(auth.uid()));

-- role_audit_log
DROP POLICY IF EXISTS role_audit_log_global_admin_read ON public.role_audit_log;
CREATE POLICY role_audit_log_global_admin_read ON public.role_audit_log FOR SELECT
USING (private.is_global_admin(auth.uid()));

-- storage.objects (complaint-attachments bucket)
DROP POLICY IF EXISTS complaint_attachments_select ON storage.objects;
CREATE POLICY complaint_attachments_select ON storage.objects FOR SELECT
USING (
  bucket_id = 'complaint-attachments'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR private.is_global_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.attachments a
      JOIN public.complaints c ON c.id = a.complaint_id
      WHERE a.storage_path = storage.objects.name
        AND (
          private.is_municipality_admin(auth.uid(), c.municipality_id)
          OR c.assigned_department_id = private.get_user_department(auth.uid())
        )
    )
  )
);

-- =====================================================================
-- 3. Drop old public helper functions (no longer referenced)
-- =====================================================================
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.is_global_admin(uuid);
DROP FUNCTION IF EXISTS public.is_municipality_admin(uuid, uuid);
DROP FUNCTION IF EXISTS public.is_municipality_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.is_municipality_super_admin(uuid, uuid);
DROP FUNCTION IF EXISTS public.is_department_admin(uuid);
DROP FUNCTION IF EXISTS public.get_user_department(uuid);

-- =====================================================================
-- 4. Revoke EXECUTE on trigger-only SECURITY DEFINER functions
-- =====================================================================
REVOKE EXECUTE ON FUNCTION public.assign_complaint_department()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_complaint_number()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_municipality_insert()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_complaint_owner_update()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_complaint_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_last_super_admin()      FROM PUBLIC, anon, authenticated;

-- Admin RPCs: revoke from anon and PUBLIC, keep authenticated (intentional, callers re-verified inside)
REVOKE EXECUTE ON FUNCTION public.bootstrap_global_admin()        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.promote_global_admin(uuid)      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.abandon_global_admin()          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transfer_global_admin(uuid)     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.bootstrap_global_admin()        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.promote_global_admin(uuid)      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.abandon_global_admin()          TO authenticated;
GRANT  EXECUTE ON FUNCTION public.transfer_global_admin(uuid)     TO authenticated;

-- =====================================================================
-- 5. Tighten complaint owner UPDATE policy (defense in depth alongside
--    the existing complaints_guard_owner_update trigger that strips
--    sensitive columns for non-admin owners)
-- =====================================================================
DROP POLICY IF EXISTS "Owner updates own complaint" ON public.complaints;
CREATE POLICY "Owner updates own complaint" ON public.complaints FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- =====================================================================
-- 6. Add missing SELECT policies on attachments for owner / muni / global
-- =====================================================================
CREATE POLICY attachments_owner_read ON public.attachments FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.complaints c
  WHERE c.id = attachments.complaint_id AND c.user_id = auth.uid()
));

CREATE POLICY attachments_municipality_admin_read ON public.attachments FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.complaints c
  WHERE c.id = attachments.complaint_id
    AND private.is_municipality_admin(auth.uid(), c.municipality_id)
));

CREATE POLICY attachments_global_admin_read ON public.attachments FOR SELECT
USING (private.is_global_admin(auth.uid()));
