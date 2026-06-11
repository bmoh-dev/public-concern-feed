
-- 1. Fix function search_path
CREATE OR REPLACE FUNCTION public.protect_complaint_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.complaint_number IS DISTINCT FROM OLD.complaint_number THEN
    RAISE EXCEPTION 'complaint_number is immutable';
  END IF;
  RETURN NEW;
END $$;

-- 2. Tighten municipalities INSERT policy (trigger already normalizes, but make policy explicit)
DROP POLICY IF EXISTS "Authenticated users can create municipalities" ON public.municipalities;
CREATE POLICY "Authenticated users can create municipalities"
ON public.municipalities
FOR INSERT
TO authenticated
WITH CHECK (
  owner_user_id = auth.uid()
  AND status = 'pending'::municipality_status
  AND verified_by IS NULL
  AND verified_at IS NULL
);

-- 3. Add SELECT policies on complaint_routing_history
DROP POLICY IF EXISTS "Complaint owner reads routing history" ON public.complaint_routing_history;
CREATE POLICY "Complaint owner reads routing history"
ON public.complaint_routing_history
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.complaints c
    WHERE c.id = complaint_routing_history.complaint_id
      AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Municipality admin reads routing history" ON public.complaint_routing_history;
CREATE POLICY "Municipality admin reads routing history"
ON public.complaint_routing_history
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.complaints c
    WHERE c.id = complaint_routing_history.complaint_id
      AND public.is_municipality_admin(auth.uid(), c.municipality_id)
  )
);

DROP POLICY IF EXISTS "Global admin reads routing history" ON public.complaint_routing_history;
CREATE POLICY "Global admin reads routing history"
ON public.complaint_routing_history
FOR SELECT
TO authenticated
USING (public.is_global_admin(auth.uid()));

DROP POLICY IF EXISTS "Department admin reads routing history" ON public.complaint_routing_history;
CREATE POLICY "Department admin reads routing history"
ON public.complaint_routing_history
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.complaints c
    WHERE c.id = complaint_routing_history.complaint_id
      AND c.assigned_department_id IS NOT NULL
      AND c.assigned_department_id = public.get_user_department(auth.uid())
  )
);

-- 4. Allow file owner to delete their own complaint attachments from storage
DROP POLICY IF EXISTS "attachments_storage_owner_delete" ON storage.objects;
CREATE POLICY "attachments_storage_owner_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'complaint-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 5. Revoke EXECUTE on SECURITY DEFINER helpers from anon/authenticated; only service_role calls them.
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.is_global_admin(uuid)',
    'public.is_municipality_member(uuid, uuid)',
    'public.is_municipality_super_admin(uuid, uuid)',
    'public.is_municipality_admin(uuid, uuid)',
    'public.list_public_complaints(integer, integer, public.complaint_category, public.complaint_status, text)',
    'public.get_public_complaint(uuid)',
    'public.assign_complaint_department()',
    'public.assign_complaint_number()',
    'public.protect_complaint_number()',
    'public.enforce_municipality_insert()',
    'public.protect_last_super_admin()',
    'public.handle_complaint_status_change()',
    'public.handle_new_user()',
    'public.touch_updated_at()'
  ]
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    EXCEPTION WHEN undefined_function THEN
      -- skip functions that don't exist with that signature
      NULL;
    END;
  END LOOP;
END $$;
