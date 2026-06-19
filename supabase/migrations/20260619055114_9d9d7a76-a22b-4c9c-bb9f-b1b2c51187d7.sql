
-- 1) Restrict citizen updates on complaints to safe fields only
CREATE OR REPLACE FUNCTION public.guard_complaint_owner_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  is_admin boolean;
BEGIN
  -- Admin paths (municipality / department / global) may freely update
  is_admin :=
    public.is_global_admin(caller)
    OR public.is_municipality_admin(caller, OLD.municipality_id)
    OR (OLD.assigned_department_id IS NOT NULL
        AND OLD.assigned_department_id = public.get_user_department(caller));

  IF is_admin THEN
    RETURN NEW;
  END IF;

  -- Owner path: lock down sensitive columns
  IF NEW.user_id = caller AND OLD.user_id = caller THEN
    NEW.status                 := OLD.status;
    NEW.internal_notes         := OLD.internal_notes;
    NEW.assigned_department_id := OLD.assigned_department_id;
    NEW.municipality_id        := OLD.municipality_id;
    NEW.user_id                := OLD.user_id;
    NEW.complaint_number       := OLD.complaint_number;
    NEW.legacy_imported        := OLD.legacy_imported;
    NEW.created_at             := OLD.created_at;
    RETURN NEW;
  END IF;

  -- Other paths blocked by RLS already
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS complaints_guard_owner_update ON public.complaints;
CREATE TRIGGER complaints_guard_owner_update
  BEFORE UPDATE ON public.complaints
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_complaint_owner_update();

-- 2) Drop overly permissive departments policy
DROP POLICY IF EXISTS "departments_auth_read" ON public.departments;

-- 3) role_audit_log: add admin read policy
DROP POLICY IF EXISTS "role_audit_log_global_admin_read" ON public.role_audit_log;
CREATE POLICY "role_audit_log_global_admin_read"
  ON public.role_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_global_admin(auth.uid()));

GRANT SELECT ON public.role_audit_log TO authenticated;

-- 4) department_admins: add read access for global + municipality admins
DROP POLICY IF EXISTS "department_admins_global_admin_read" ON public.department_admins;
CREATE POLICY "department_admins_global_admin_read"
  ON public.department_admins
  FOR SELECT
  TO authenticated
  USING (public.is_global_admin(auth.uid()));

DROP POLICY IF EXISTS "department_admins_municipality_admin_read" ON public.department_admins;
CREATE POLICY "department_admins_municipality_admin_read"
  ON public.department_admins
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.departments d
      WHERE d.id = department_admins.department_id
        AND public.is_municipality_admin(auth.uid(), d.municipality_id)
    )
  );

DROP POLICY IF EXISTS "department_admins_self_read" ON public.department_admins;
CREATE POLICY "department_admins_self_read"
  ON public.department_admins
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 5) Storage policies for complaint-attachments
DROP POLICY IF EXISTS "complaint_attachments_select" ON storage.objects;
CREATE POLICY "complaint_attachments_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'complaint-attachments'
    AND (
      (storage.foldername(name))[1] = (auth.uid())::text
      OR public.is_global_admin(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.attachments a
        JOIN public.complaints c ON c.id = a.complaint_id
        WHERE a.storage_path = storage.objects.name
          AND (
            public.is_municipality_admin(auth.uid(), c.municipality_id)
            OR (c.assigned_department_id IS NOT NULL
                AND c.assigned_department_id = public.get_user_department(auth.uid()))
          )
      )
    )
  );

DROP POLICY IF EXISTS "complaint_attachments_no_update" ON storage.objects;
CREATE POLICY "complaint_attachments_no_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'complaint-attachments' AND false)
  WITH CHECK (bucket_id = 'complaint-attachments' AND false);

-- 6) Lock down SECURITY DEFINER functions from direct client calls.
-- Trigger / internal helpers: revoke from anon AND authenticated (triggers don't need caller EXECUTE).
REVOKE EXECUTE ON FUNCTION public.assign_complaint_department()      FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.assign_complaint_number()          FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.enforce_municipality_insert()      FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_complaint_status_change()   FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                  FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.protect_complaint_number()         FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.protect_last_super_admin()         FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at()                 FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.guard_complaint_owner_update()     FROM anon, authenticated, public;

-- Helpers used by RLS policies: keep authenticated EXECUTE (needed for policy evaluation), revoke anon.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role)           FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_global_admin(uuid)              FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_department_admin(uuid)          FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_municipality_admin(uuid, uuid)  FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_municipality_member(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_municipality_super_admin(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_user_department(uuid)          FROM anon, public;

-- Platform admin RPCs: must be callable by authenticated users; block anon.
REVOKE EXECUTE ON FUNCTION public.bootstrap_global_admin()           FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.promote_global_admin(uuid)         FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.abandon_global_admin()             FROM anon, public;
