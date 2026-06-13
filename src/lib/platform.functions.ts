import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getPlatformBootstrapState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
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

export const abandonGlobalAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { error } = await (supabase as any).rpc("abandon_global_admin");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
