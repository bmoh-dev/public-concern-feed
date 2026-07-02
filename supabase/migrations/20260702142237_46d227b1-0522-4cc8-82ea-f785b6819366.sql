-- Recreate trigger (handle_new_user already exists)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill profiles
INSERT INTO public.profiles (id, full_name, email, avatar_url, google_sub)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', ''),
  u.email,
  u.raw_user_meta_data->>'avatar_url',
  u.raw_user_meta_data->>'sub'
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  full_name = COALESCE(NULLIF(EXCLUDED.full_name,''), public.profiles.full_name),
  avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
  google_sub = COALESCE(EXCLUDED.google_sub, public.profiles.google_sub),
  updated_at = now();

-- Backfill default citizen role
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'citizen'::app_role
FROM auth.users u
LEFT JOIN public.user_roles r ON r.user_id = u.id
WHERE r.user_id IS NULL
ON CONFLICT DO NOTHING;
