
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'citizen');
CREATE TYPE public.complaint_status AS ENUM ('pending', 'in_progress', 'resolved');
CREATE TYPE public.complaint_category AS ENUM ('infrastructure', 'public_lighting', 'cleanliness', 'other');

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  avatar_url TEXT,
  google_sub TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_self_read" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_self_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- User roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_roles_self_read" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

-- has_role function
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Admin policies on profiles
CREATE POLICY "profiles_admin_read" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "user_roles_admin_read" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Complaints
CREATE TABLE public.complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category public.complaint_category NOT NULL,
  address TEXT NOT NULL,
  description TEXT NOT NULL,
  status public.complaint_status NOT NULL DEFAULT 'pending',
  internal_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX complaints_user_id_idx ON public.complaints(user_id);
CREATE INDEX complaints_status_idx ON public.complaints(status);
CREATE INDEX complaints_category_idx ON public.complaints(category);
CREATE INDEX complaints_created_at_idx ON public.complaints(created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.complaints TO authenticated;
GRANT ALL ON public.complaints TO service_role;
ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

-- citizens: insert their own
CREATE POLICY "complaints_owner_insert" ON public.complaints FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
-- citizens: read their own
CREATE POLICY "complaints_owner_read" ON public.complaints FOR SELECT TO authenticated USING (user_id = auth.uid());
-- admins: read all & update all
CREATE POLICY "complaints_admin_read" ON public.complaints FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "complaints_admin_update" ON public.complaints FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Attachments
CREATE TABLE public.attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX attachments_complaint_id_idx ON public.attachments(complaint_id);
GRANT SELECT, INSERT ON public.attachments TO authenticated;
GRANT SELECT ON public.attachments TO anon;
GRANT ALL ON public.attachments TO service_role;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

-- Public read of attachments metadata (public transparency feed)
CREATE POLICY "attachments_public_read" ON public.attachments FOR SELECT TO anon, authenticated USING (true);
-- Owner can insert when complaint is theirs
CREATE POLICY "attachments_owner_insert" ON public.attachments FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.complaints c WHERE c.id = complaint_id AND c.user_id = auth.uid())
);

-- Notifications
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  complaint_id UUID REFERENCES public.complaints(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_id_idx ON public.notifications(user_id, read, created_at DESC);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_owner_read" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifications_owner_update" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- Public view (excludes citizen identity and internal notes)
CREATE VIEW public.public_complaints
WITH (security_invoker = true)
AS
SELECT id, title, category, address, description, status, created_at
FROM public.complaints;

GRANT SELECT ON public.public_complaints TO anon, authenticated;

-- However, the view inherits RLS from complaints (security_invoker) which prevents anon reads.
-- Use security_definer view instead via wrapper function, OR add a permissive SELECT policy for non-private columns.
-- Simpler: drop the view and use a SECURITY DEFINER function for public listing.
DROP VIEW public.public_complaints;

CREATE OR REPLACE FUNCTION public.list_public_complaints(
  _category public.complaint_category DEFAULT NULL,
  _search TEXT DEFAULT NULL,
  _limit INT DEFAULT 20,
  _offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  category public.complaint_category,
  address TEXT,
  description TEXT,
  status public.complaint_status,
  created_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.title, c.category, c.address, c.description, c.status, c.created_at
  FROM public.complaints c
  WHERE (_category IS NULL OR c.category = _category)
    AND (_search IS NULL OR c.title ILIKE '%' || _search || '%')
  ORDER BY c.created_at DESC
  LIMIT LEAST(_limit, 100) OFFSET _offset;
$$;
GRANT EXECUTE ON FUNCTION public.list_public_complaints TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_complaint(_id UUID)
RETURNS TABLE (
  id UUID,
  title TEXT,
  category public.complaint_category,
  address TEXT,
  description TEXT,
  status public.complaint_status,
  created_at TIMESTAMPTZ
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.title, c.category, c.address, c.description, c.status, c.created_at
  FROM public.complaints c WHERE c.id = _id;
$$;
GRANT EXECUTE ON FUNCTION public.get_public_complaint TO anon, authenticated;

-- Trigger: auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url, google_sub)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url',
    NEW.raw_user_meta_data->>'sub'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    avatar_url = EXCLUDED.avatar_url,
    google_sub = EXCLUDED.google_sub,
    updated_at = now();

  -- Default citizen role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'citizen')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger: notify citizen when admin updates complaint status
CREATE OR REPLACE FUNCTION public.handle_complaint_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.notifications (user_id, complaint_id, title, body)
    VALUES (
      NEW.user_id,
      NEW.id,
      'تم تحديث حالة شكواك',
      'الحالة الجديدة: ' || NEW.status::text
    );
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_complaint_status_change
BEFORE UPDATE ON public.complaints
FOR EACH ROW EXECUTE FUNCTION public.handle_complaint_status_change();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.complaints;

-- Storage bucket for attachments (public read)
INSERT INTO storage.buckets (id, name, public) VALUES ('complaint-attachments', 'complaint-attachments', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "attachments_storage_public_read"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'complaint-attachments');

CREATE POLICY "attachments_storage_authenticated_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'complaint-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
