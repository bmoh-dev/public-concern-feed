import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const searchUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ q: z.string().trim().max(200).optional().default("") }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    let query = supabaseAdmin
      .from("profiles")
      .select("id, full_name, email")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data.q) query = query.ilike("email", `%${data.q}%`);
    const { data: profiles, error } = await query;
    if (error) throw new Error(error.message);
    const ids = (profiles ?? []).map((p) => p.id);
    const roleMap = new Map<string, "admin" | "citizen">();
    const deptMap = new Map<string, { id: string; name: string }>();
    if (ids.length) {
      const [{ data: roles }, { data: deptRows }] = await Promise.all([
        supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
        (supabaseAdmin as any)
          .from("department_admins")
          .select("user_id, department_id, departments:department_id (name_ar)")
          .in("user_id", ids),
      ]);
      for (const r of roles ?? []) {
        const cur = roleMap.get(r.user_id);
        if (r.role === "admin" || !cur) roleMap.set(r.user_id, r.role as any);
      }
      for (const d of (deptRows ?? []) as any[]) {
        deptMap.set(d.user_id, { id: d.department_id, name: d.departments?.name_ar ?? "" });
      }
    }
    return (profiles ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      role: (roleMap.get(p.id) ?? "citizen") as "admin" | "citizen",
      department_id: deptMap.get(p.id)?.id ?? null,
      department_name: deptMap.get(p.id)?.name ?? null,
    }));
  });

export const changeUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        target_user_id: z.string().uuid(),
        action: z.enum(["promote", "demote"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const actorId = context.userId;
    const targetId = data.target_user_id;

    const { data: targetRoles, error: rErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", targetId);
    if (rErr) throw new Error(rErr.message);
    const isAdmin = (targetRoles ?? []).some((r) => r.role === "admin");
    const previousRole: "admin" | "citizen" = isAdmin ? "admin" : "citizen";

    if (data.action === "promote") {
      if (isAdmin) throw new Error("المستخدم مسؤول بالفعل");
      const { error } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: targetId, role: "admin" });
      if (error) throw new Error(error.message);
    } else {
      if (!isAdmin) throw new Error("المستخدم ليس مسؤولاً");
      // Count remaining admins
      const { count, error: cErr } = await supabaseAdmin
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "admin");
      if (cErr) throw new Error(cErr.message);
      if ((count ?? 0) <= 1) throw new Error("لا يمكن إزالة آخر مسؤول في النظام");
      if (targetId === actorId && (count ?? 0) <= 1) {
        throw new Error("لا يمكنك تخفيض نفسك كآخر مسؤول");
      }
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", targetId)
        .eq("role", "admin");
      if (error) throw new Error(error.message);
    }

    const newRole: "admin" | "citizen" = data.action === "promote" ? "admin" : "citizen";
    await supabaseAdmin.from("role_audit_log").insert({
      actor_admin_id: actorId,
      target_user_id: targetId,
      previous_role: previousRole,
      new_role: newRole,
    });

    return { ok: true, role: newRole };
  });
