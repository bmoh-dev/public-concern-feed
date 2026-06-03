-- ============== Departments ==============
CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name_ar text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY departments_auth_read ON public.departments FOR SELECT TO authenticated USING (true);

INSERT INTO public.departments (slug, name_ar) VALUES
  ('infrastructure', 'البنية التحتية'),
  ('public_lighting', 'الإنارة العامة'),
  ('cleaning_environment', 'النظافة والبيئة'),
  ('water_sanitation', 'المياه والصرف الصحي'),
  ('green_areas', 'المساحات الخضراء'),
  ('general_administration', 'الإدارة العامة');

-- ============== Department Admins mapping ==============
CREATE TABLE public.department_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.department_admins TO authenticated;
GRANT ALL ON public.department_admins TO service_role;
ALTER TABLE public.department_admins ENABLE ROW LEVEL SECURITY;
-- General admins can read all; users can read their own row
CREATE POLICY dept_admins_general_read ON public.department_admins FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR user_id = auth.uid());
-- No client writes; service role only
CREATE POLICY dept_admins_no_client_write_i ON public.department_admins FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY dept_admins_no_client_write_u ON public.department_admins FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY dept_admins_no_client_write_d ON public.department_admins FOR DELETE TO authenticated USING (false);

-- ============== Helpers ==============
CREATE OR REPLACE FUNCTION public.get_user_department(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT department_id FROM public.department_admins WHERE user_id = _user_id LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.is_department_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.department_admins WHERE user_id = _user_id) $$;

-- ============== Complaints assigned_department_id ==============
ALTER TABLE public.complaints ADD COLUMN assigned_department_id uuid REFERENCES public.departments(id);

CREATE OR REPLACE FUNCTION public.assign_complaint_department()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE target_slug text;
BEGIN
  IF NEW.assigned_department_id IS NOT NULL THEN RETURN NEW; END IF;
  target_slug := CASE NEW.category
    WHEN 'infrastructure' THEN 'infrastructure'
    WHEN 'public_lighting' THEN 'public_lighting'
    WHEN 'cleanliness' THEN 'cleaning_environment'
    ELSE 'general_administration'
  END;
  SELECT id INTO NEW.assigned_department_id FROM public.departments WHERE slug = target_slug LIMIT 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER complaints_assign_department
  BEFORE INSERT ON public.complaints
  FOR EACH ROW EXECUTE FUNCTION public.assign_complaint_department();

-- Backfill existing complaints
UPDATE public.complaints SET assigned_department_id = d.id
FROM public.departments d
WHERE complaints.assigned_department_id IS NULL
  AND d.slug = CASE complaints.category
    WHEN 'infrastructure' THEN 'infrastructure'
    WHEN 'public_lighting' THEN 'public_lighting'
    WHEN 'cleanliness' THEN 'cleaning_environment'
    ELSE 'general_administration'
  END;

-- ============== RLS additions for department admins on complaints ==============
CREATE POLICY complaints_dept_admin_read ON public.complaints FOR SELECT TO authenticated
  USING (assigned_department_id IS NOT NULL AND assigned_department_id = public.get_user_department(auth.uid()));
CREATE POLICY complaints_dept_admin_update ON public.complaints FOR UPDATE TO authenticated
  USING (assigned_department_id IS NOT NULL AND assigned_department_id = public.get_user_department(auth.uid()));

-- Attachments: department admins of the owning complaint can read
CREATE POLICY attachments_dept_admin_read ON public.attachments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.complaints c
    WHERE c.id = attachments.complaint_id
      AND c.assigned_department_id = public.get_user_department(auth.uid())
  ));

-- ============== Routing history ==============
CREATE TABLE public.complaint_routing_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES public.complaints(id) ON DELETE CASCADE,
  from_department_id uuid REFERENCES public.departments(id),
  to_department_id uuid NOT NULL REFERENCES public.departments(id),
  actor_user_id uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.complaint_routing_history TO authenticated;
GRANT ALL ON public.complaint_routing_history TO service_role;
ALTER TABLE public.complaint_routing_history ENABLE ROW LEVEL SECURITY;
-- General admins read all; department admins read rows that involve their dept
CREATE POLICY routing_history_read ON public.complaint_routing_history FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR from_department_id = public.get_user_department(auth.uid())
    OR to_department_id = public.get_user_department(auth.uid())
  );
CREATE POLICY routing_history_no_client_write_i ON public.complaint_routing_history FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY routing_history_no_client_write_u ON public.complaint_routing_history FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY routing_history_no_client_write_d ON public.complaint_routing_history FOR DELETE TO authenticated USING (false);

CREATE INDEX idx_complaints_assigned_dept ON public.complaints(assigned_department_id);
CREATE INDEX idx_routing_history_complaint ON public.complaint_routing_history(complaint_id);
