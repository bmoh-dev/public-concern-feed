import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getMyRole } from "@/lib/notifications.functions";

export async function requireAdminRoute(location: { href: string }) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw redirect({ to: "/login", search: { redirect: location.href } });
  }

  const role = await getMyRole();
  const allowed =
    role.roles.includes("admin") ||
    role.roles.includes("super_admin") ||
    role.roles.includes("global_admin");
  if (!allowed) {
    throw new Error("Access denied: admin only");
  }

  return { user: data.user, role };
}
