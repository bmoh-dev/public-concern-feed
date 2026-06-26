
-- 1) Lock down SECURITY DEFINER functions: revoke broad EXECUTE, grant only what's needed
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_global_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_municipality_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_municipality_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_municipality_super_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_department_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_department(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_complaint_department() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_complaint_number() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_municipality_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_complaint_owner_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_complaint_status_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_last_super_admin() FROM PUBLIC, anon, authenticated;

-- Keep the four platform admin RPCs callable by signed-in users (they perform their own auth checks)
REVOKE EXECUTE ON FUNCTION public.bootstrap_global_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_global_admin() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.promote_global_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_global_admin(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.transfer_global_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_global_admin(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.abandon_global_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abandon_global_admin() TO authenticated;

-- 2) Drop duplicate, looser RLS policies on public.complaints
DROP POLICY IF EXISTS "complaints_owner_insert" ON public.complaints;
DROP POLICY IF EXISTS "complaints_owner_read" ON public.complaints;

-- 3) Tighten storage.objects INSERT policy on complaint-attachments
DROP POLICY IF EXISTS "attachments_storage_authenticated_insert" ON storage.objects;
CREATE POLICY "attachments_storage_authenticated_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'complaint-attachments'
    AND (storage.foldername(name))[1] = (auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.municipality_members mm
      JOIN public.municipalities m ON m.id = mm.municipality_id
      WHERE mm.user_id = auth.uid() AND m.status = 'verified'
    )
  );

-- 4) Tighten storage.objects DELETE policy: require ownership via attachments+complaints
DROP POLICY IF EXISTS "attachments_storage_owner_delete" ON storage.objects;
CREATE POLICY "attachments_storage_owner_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'complaint-attachments'
    AND (storage.foldername(name))[1] = (auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.attachments a
      JOIN public.complaints c ON c.id = a.complaint_id
      WHERE a.storage_path = storage.objects.name
        AND c.user_id = auth.uid()
    )
  );
