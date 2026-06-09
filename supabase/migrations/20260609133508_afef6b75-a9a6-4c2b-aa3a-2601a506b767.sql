
CREATE SEQUENCE IF NOT EXISTS public.complaint_number_seq START 1;

ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS complaint_number text;

-- Backfill existing rows in creation order
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.complaints
  WHERE complaint_number IS NULL
)
UPDATE public.complaints c
SET complaint_number = 'CMP-' || lpad(o.rn::text, 6, '0')
FROM ordered o
WHERE c.id = o.id;

-- Advance sequence past backfilled rows
SELECT setval(
  'public.complaint_number_seq',
  GREATEST(
    (SELECT COALESCE(MAX(NULLIF(regexp_replace(complaint_number, '\D', '', 'g'), '')::bigint), 0) FROM public.complaints),
    1
  )
);

CREATE OR REPLACE FUNCTION public.assign_complaint_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.complaint_number IS NULL OR NEW.complaint_number = '' THEN
    NEW.complaint_number := 'CMP-' || lpad(nextval('public.complaint_number_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS complaints_assign_number ON public.complaints;
CREATE TRIGGER complaints_assign_number
  BEFORE INSERT ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION public.assign_complaint_number();

-- Prevent updates to complaint_number after creation
CREATE OR REPLACE FUNCTION public.protect_complaint_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.complaint_number IS DISTINCT FROM OLD.complaint_number THEN
    RAISE EXCEPTION 'complaint_number is immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS complaints_protect_number ON public.complaints;
CREATE TRIGGER complaints_protect_number
  BEFORE UPDATE ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION public.protect_complaint_number();

ALTER TABLE public.complaints
  ALTER COLUMN complaint_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS complaints_complaint_number_key
  ON public.complaints (complaint_number);
