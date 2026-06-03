import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("notifications")
      .select("id, title, body, read, created_at, complaint_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ ids: z.array(z.string().uuid()).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase.from("notifications").update({ read: true }).eq("user_id", userId);
    if (data.ids?.length) q = q.in("id", data.ids);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const admin: any = supabaseAdmin;
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roles = (data ?? []).map((r) => r.role);
    const isAdmin = roles.includes("admin");
    let departmentId: string | null = null;
    let departmentName: string | null = null;
    if (!isAdmin) {
      const { data: da } = await admin
        .from("department_admins")
        .select("department_id, departments:department_id (name_ar)")
        .eq("user_id", userId)
        .maybeSingle();
      if (da) {
        departmentId = da.department_id;
        departmentName = da.departments?.name_ar ?? null;
      }
    }
    const isDepartmentAdmin = !!departmentId;
    return { roles, isAdmin, isDepartmentAdmin, departmentId, departmentName };
  });
