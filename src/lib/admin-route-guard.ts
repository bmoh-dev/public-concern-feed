import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getMyRole } from "@/lib/notifications.functions";

/**
 * Municipality Administration guard.
 *
 * Access rule: user MUST be a verified municipality admin/super_admin of at
 * least one municipality. Being global_admin alone does NOT grant access —
 * Platform Admin and Municipality Admin are separated surfaces.
 */
export async function requireAdminRoute(location: { href: string }) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw redirect({ to: "/login", search: { redirect: location.href } });
  }

  const role = await getMyRole();
  const municipalities = (role.municipalities ?? []).filter(
    (m: any) => m.role === "admin" || m.role === "super_admin",
  );
  if (municipalities.length === 0) {
    throw new Error("ليس لديك صلاحية إدارة هذه البلدية");
  }

  return { user: data.user, role, municipalities };
}
