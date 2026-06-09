CREATE OR REPLACE FUNCTION public.enforce_municipality_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.status := 'pending';
  NEW.verified_by := NULL;
  NEW.verified_at := NULL;
  NEW.rejection_reason := NULL;
  NEW.owner_user_id := COALESCE(auth.uid(), NEW.owner_user_id);
  IF NEW.owner_user_id IS NULL THEN
    RAISE EXCEPTION 'owner_user_id is required';
  END IF;
  RETURN NEW;
END $function$;