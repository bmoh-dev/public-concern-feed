import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertGlobalAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "global_admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: global admin only");
}

export const getPlatformBootstrapState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin: any = supabaseAdmin;
    const { count, error } = await admin
      .from("user_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "global_admin");
    if (error) throw new Error(error.message);
    const { data: settings } = await admin
      .from("platform_settings")
      .select("initialized_at, initialized_by")
      .eq("id", true)
      .maybeSingle();
    return {
      hasGlobalAdmin: (count ?? 0) > 0,
      initializedAt: settings?.initialized_at ?? null,
      initializedBy: settings?.initialized_by ?? null,
    };
  });

export const bootstrapGlobalAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("bootstrap_global_admin");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const promoteGlobalAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ target_user: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("promote_global_admin", {
      target_user: data.target_user,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const promoteGlobalAdminByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ email: z.string().email() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertGlobalAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin: any = supabaseAdmin;
    const { data: prof, error: pErr } = await admin
      .from("profiles")
      .select("id, email")
      .ilike("email", data.email.trim())
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prof) throw new Error("لم يتم العثور على المستخدم");
    const { error } = await (supabase as any).rpc("promote_global_admin", {
      target_user: prof.id,
    });
    if (error) throw new Error(error.message);
    return { ok: true, user_id: prof.id };
  });

export const abandonGlobalAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("abandon_global_admin");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listGlobalAdmins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertGlobalAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin: any = supabaseAdmin;

    const { data: rows, error } = await admin
      .from("user_roles")
      .select("user_id, created_at")
      .eq("role", "global_admin")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r: any) => r.user_id);
    let profilesById: Record<string, { full_name: string | null; email: string | null }> = {};
    if (ids.length) {
      const { data: profs } = await admin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids);
      for (const p of profs ?? []) {
        profilesById[p.id] = { full_name: p.full_name, email: p.email };
      }
    }

    const { data: settings } = await admin
      .from("platform_settings")
      .select("initialized_at, initialized_by")
      .eq("id", true)
      .maybeSingle();

    let initializer: { full_name: string | null; email: string | null } | null = null;
    if (settings?.initialized_by) {
      const { data: initProf } = await admin
        .from("profiles")
        .select("id, full_name, email")
        .eq("id", settings.initialized_by)
        .maybeSingle();
      if (initProf) initializer = { full_name: initProf.full_name, email: initProf.email };
    }

    return {
      admins: (rows ?? []).map((r: any) => ({
        user_id: r.user_id,
        created_at: r.created_at,
        full_name: profilesById[r.user_id]?.full_name ?? null,
        email: profilesById[r.user_id]?.email ?? null,
        is_self: r.user_id === userId,
      })),
      initialized_at: settings?.initialized_at ?? null,
      initializer,
      self_user_id: userId,
    };
  });
