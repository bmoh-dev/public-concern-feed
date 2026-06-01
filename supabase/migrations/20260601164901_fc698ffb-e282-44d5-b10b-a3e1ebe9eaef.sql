CREATE TABLE public.role_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_admin_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  previous_role app_role,
  new_role app_role,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.role_audit_log TO authenticated;
GRANT ALL ON public.role_audit_log TO service_role;

ALTER TABLE public.role_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_audit_admin_read ON public.role_audit_log
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_role_audit_target ON public.role_audit_log(target_user_id);
CREATE INDEX idx_profiles_email_lower ON public.profiles ((lower(email)));