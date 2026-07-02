
-- 1. Attach handle_new_user trigger to auth.users (was missing)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Backfill missing profiles from auth.users (idempotent; never overwrites)
INSERT INTO public.profiles (id, full_name, email, avatar_url, google_sub, created_at, updated_at)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', ''),
  u.email,
  u.raw_user_meta_data->>'avatar_url',
  u.raw_user_meta_data->>'sub',
  COALESCE(u.created_at, now()),
  now()
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- 3. Backfill default citizen role for any existing user missing one
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'citizen'::public.app_role
FROM auth.users u
ON CONFLICT DO NOTHING;
