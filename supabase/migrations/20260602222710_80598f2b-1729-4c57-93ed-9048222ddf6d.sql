
-- 1. Attachments: restrict SELECT to owner or admin (no anon)
DROP POLICY IF EXISTS attachments_public_read ON public.attachments;
CREATE POLICY attachments_owner_or_admin_read ON public.attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.complaints c
            WHERE c.id = attachments.complaint_id AND c.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );
REVOKE SELECT ON public.attachments FROM anon;

-- 2. Storage: drop broad listing policy on the public bucket. Files remain
--    accessible via the public CDN URL (/storage/v1/object/public/...).
DROP POLICY IF EXISTS attachments_storage_public_read ON storage.objects;

-- 3. Hide complaints.internal_notes from authenticated users (owners).
--    Admin reads/writes happen via service_role (supabaseAdmin), which is unaffected.
REVOKE SELECT (internal_notes), UPDATE (internal_notes) ON public.complaints FROM authenticated;
REVOKE SELECT (internal_notes), UPDATE (internal_notes) ON public.complaints FROM anon;

-- 4. user_roles: explicit deny for client-side writes. Service role bypasses RLS.
CREATE POLICY user_roles_no_client_insert ON public.user_roles
  FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY user_roles_no_client_update ON public.user_roles
  FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY user_roles_no_client_delete ON public.user_roles
  FOR DELETE TO authenticated, anon USING (false);

-- 5. Drop unused public SECURITY DEFINER helpers; revoke EXECUTE on has_role from anon.
DROP FUNCTION IF EXISTS public.get_public_complaint(uuid);
DROP FUNCTION IF EXISTS public.list_public_complaints(public.complaint_category, text, integer, integer);
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;

-- 6. Realtime channel authorization: only let users subscribe to their own scoped topics.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS realtime_user_scoped_read ON realtime.messages;
CREATE POLICY realtime_user_scoped_read ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    -- Allow Postgres Changes subscriptions only on topics that include the user's id,
    -- or admin-only channels. App code uses generic topics ("notif-rt") today; gate by user.
    realtime.topic() = ('user:' || auth.uid()::text)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS realtime_user_scoped_write ON realtime.messages;
CREATE POLICY realtime_user_scoped_write ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    realtime.topic() = ('user:' || auth.uid()::text)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );
