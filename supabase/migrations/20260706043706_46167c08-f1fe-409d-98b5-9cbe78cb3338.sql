
CREATE TABLE public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('bug','suggestion')),
  title text NOT NULL,
  description text NOT NULL,
  page text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','fixed')),
  screenshot_url text,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feedback_status_created_at_idx ON public.feedback (status, created_at DESC);
CREATE INDEX feedback_user_created_at_idx ON public.feedback (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback TO authenticated;
GRANT ALL ON public.feedback TO service_role;

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY feedback_insert_self ON public.feedback
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY feedback_select_own ON public.feedback
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY feedback_select_admin ON public.feedback
  FOR SELECT TO authenticated
  USING (public.is_global_admin(auth.uid()));

CREATE POLICY feedback_update_admin ON public.feedback
  FOR UPDATE TO authenticated
  USING (public.is_global_admin(auth.uid()))
  WITH CHECK (public.is_global_admin(auth.uid()));

CREATE POLICY feedback_delete_admin ON public.feedback
  FOR DELETE TO authenticated
  USING (public.is_global_admin(auth.uid()));

-- Storage policies for feedback-screenshots bucket
CREATE POLICY feedback_screens_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'feedback-screenshots'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY feedback_screens_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'feedback-screenshots'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY feedback_screens_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'feedback-screenshots'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY feedback_screens_admin_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'feedback-screenshots'
    AND public.is_global_admin(auth.uid())
  );

CREATE POLICY feedback_screens_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'feedback-screenshots'
    AND public.is_global_admin(auth.uid())
  );
