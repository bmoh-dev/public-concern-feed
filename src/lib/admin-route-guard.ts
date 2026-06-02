import { redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getMyRole } from "@/lib/notifications.functions";

export async function requireAdminRoute(location: { href: string }) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw redirect({ to: "/login", search: { redirect: location.href } });
  }

  const role = await getMyRole();
  if (!role.isAdmin || !role.roles.includes("admin")) {
    throw new Error("Access denied: admin only");
  }

  return { user: data.user, role };
}