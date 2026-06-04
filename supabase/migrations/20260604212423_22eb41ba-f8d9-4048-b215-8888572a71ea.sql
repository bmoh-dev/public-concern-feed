
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_lat_range CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90)),
  ADD CONSTRAINT complaints_lng_range CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180));
