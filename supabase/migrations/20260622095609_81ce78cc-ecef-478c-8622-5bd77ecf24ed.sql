
-- =========================================================
-- 1) complaints: restrict citizen UPDATE to safe columns
-- =========================================================
-- Trigger guard_complaint_owner_update already resets sensitive
-- columns; add column-level grant as defense-in-depth. Admin paths
-- run via service_role (supabaseAdmin) and are not affected.
REVOKE UPDATE ON public.complaints FROM authenticated;
GRANT UPDATE (title, description, address, latitude, longitude)
  ON public.complaints TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.complaints TO authenticated;
GRANT ALL ON public.complaints TO service_role;

-- =========================================================
-- 2) storage: tighten complaint-attachments SELECT to require
--    actual complaint ownership (not just folder-name match)
-- =========================================================
DROP POLICY IF EXISTS complaint_attachments_select ON storage.objects;
CREATE POLICY complaint_attachments_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'complaint-attachments'
  AND (
    public.is_global_admin(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.attachments a
      JOIN public.complaints c ON c.id = a.complaint_id
      WHERE a.storage_path = storage.objects.name
        AND (
          c.user_id = auth.uid()
          OR public.is_municipality_admin(auth.uid(), c.municipality_id)
          OR (c.assigned_department_id IS NOT NULL
              AND c.assigned_department_id = public.get_user_department(auth.uid()))
        )
    )
  )
);

-- =========================================================
-- 3) municipality_members: explicit deny for client writes
-- =========================================================
DROP POLICY IF EXISTS municipality_members_no_insert ON public.municipality_members;
DROP POLICY IF EXISTS municipality_members_no_update ON public.municipality_members;
DROP POLICY IF EXISTS municipality_members_no_delete ON public.municipality_members;

CREATE POLICY municipality_members_no_insert
ON public.municipality_members
FOR INSERT
TO authenticated, anon
WITH CHECK (false);

CREATE POLICY municipality_members_no_update
ON public.municipality_members
FOR UPDATE
TO authenticated, anon
USING (false)
WITH CHECK (false);

CREATE POLICY municipality_members_no_delete
ON public.municipality_members
FOR DELETE
TO authenticated, anon
USING (false);

-- =========================================================
-- 4) Revoke broad EXECUTE on SECURITY DEFINER functions
-- =========================================================
-- Trigger-only functions: no direct caller should invoke
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_complaint_status_change()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_complaint_department()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_complaint_number()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_complaint_owner_update()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_last_super_admin()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_municipality_insert()      FROM PUBLIC, anon, authenticated;

-- RLS helper functions: revoke from anon; authenticated needs EXECUTE
-- for RLS policy evaluation, so it is retained intentionally.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role)                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_global_admin(uuid)                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_municipality_admin(uuid, uuid)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_municipality_member(uuid, uuid)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_municipality_super_admin(uuid, uuid)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_department_admin(uuid)                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_department(uuid)                FROM PUBLIC, anon;

-- Platform admin RPCs: revoke from anon. Authenticated keeps EXECUTE
-- because the functions self-authorize via auth.uid() + role check.
REVOKE EXECUTE ON FUNCTION public.bootstrap_global_admin()  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.promote_global_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.abandon_global_admin()    FROM PUBLIC, anon;
