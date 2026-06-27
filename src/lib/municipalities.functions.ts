import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { enforceRateLimit } from "@/lib/rate-limit.server";
import { RATE_LIMITS } from "@/lib/rate-limits";

async function assertGlobalAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "global_admin" as any)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: global admin only");
}

// PUBLIC — list verified municipalities (browser/anonymous safe)
export const listVerifiedMunicipalities = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await (supabaseAdmin as any)
    .from("municipalities")
    .select("id, name, wilaya")
    .eq("status", "verified")
    .order("name");
  if (error) throw new Error(error.message);
  return data as Array<{ id: string; name: string; wilaya: string }>;
});

// AUTH — get my onboarding state + memberships
export const getMyOnboardingState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const admin: any = supabaseAdmin;

    const [{ data: memberships }, { data: pending }, { data: roles }, { count: verifiedCount }] = await Promise.all([
      admin
        .from("municipality_members")
        .select("municipality_id, role, joined_at, municipalities:municipality_id(id,name,wilaya,status)")
        .eq("user_id", userId)
        .order("joined_at", { ascending: false }),
      admin
        .from("municipalities")
        .select("id, name, wilaya, status, rejection_reason")
        .eq("owner_user_id", userId)
        .in("status", ["pending", "rejected"]),
      admin.from("user_roles").select("role").eq("user_id", userId),
      admin
        .from("municipalities")
        .select("id", { count: "exact", head: true })
        .eq("status", "verified"),
    ]);

    const isGlobalAdmin = (roles ?? []).some((r: any) => r.role === "global_admin");
    const verifiedMemberships = (memberships ?? []).filter(
      (m: any) => m.municipalities?.status === "verified",
    );
    const list = verifiedMemberships.map((m: any) => ({
      id: m.municipality_id,
      name: m.municipalities.name,
      wilaya: m.municipalities.wilaya,
      role: m.role as "citizen" | "admin" | "super_admin",
    }));

    return {
      isGlobalAdmin,
      municipalities: list,
      currentMunicipalityId: list[0]?.id ?? null,
      verifiedMunicipalityCount: verifiedCount ?? 0,
      pendingOwned: (pending ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        wilaya: p.wilaya,
        status: p.status as "pending" | "rejected",
        rejection_reason: p.rejection_reason,
      })),
      needsOnboarding: !isGlobalAdmin && list.length === 0,
    };
  });


export const createMunicipality = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().trim().min(2).max(120),
        wilaya: z.string().trim().min(2).max(120),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const admin: any = supabaseAdmin;

    // Uniqueness check (case-insensitive) — also enforced by index
    const { data: existing } = await admin
      .from("municipalities")
      .select("id, status")
      .ilike("name", data.name)
      .ilike("wilaya", data.wilaya)
      .maybeSingle();
    if (existing) {
      throw new Error("هذه البلدية مسجّلة بالفعل");
    }

    // Block users who already own a pending municipality
    const { data: existingPending } = await admin
      .from("municipalities")
      .select("id")
      .eq("owner_user_id", userId)
      .eq("status", "pending")
      .maybeSingle();
    if (existingPending) {
      throw new Error("لديك طلب بلدية قيد المراجعة بالفعل");
    }

    const { data: row, error } = await admin
      .from("municipalities")
      .insert({
        name: data.name,
        wilaya: data.wilaya,
        owner_user_id: userId, // trigger forces this anyway
      })
      .select("id, name, wilaya, status")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const joinMunicipality = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ municipality_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const admin: any = supabaseAdmin;

    // Verify the municipality is verified
    const { data: m } = await admin
      .from("municipalities")
      .select("id, status")
      .eq("id", data.municipality_id)
      .maybeSingle();
    if (!m || m.status !== "verified") {
      throw new Error("البلدية غير موجودة أو غير موثّقة");
    }

    const { error } = await admin
      .from("municipality_members")
      .insert({ municipality_id: data.municipality_id, user_id: userId, role: "citizen" })
      .select()
      .single();
    if (error && !String(error.message).includes("duplicate")) {
      throw new Error(error.message);
    }
    return { ok: true };
  });

// ---- Platform admin ----
export const platformAdminListMunicipalities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertGlobalAdmin(context.userId);
    const { data, error } = await (supabaseAdmin as any)
      .from("municipalities")
      .select(
        "id, name, wilaya, status, owner_user_id, verified_by, verified_at, rejection_reason, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ownerIds = Array.from(new Set((data ?? []).map((m: any) => m.owner_user_id)));
    let ownerMap = new Map<string, { email: string | null; full_name: string | null }>();
    if (ownerIds.length) {
      const { data: profs } = await (supabaseAdmin as any)
        .from("profiles")
        .select("id, email, full_name")
        .in("id", ownerIds);
      ownerMap = new Map(
        (profs ?? []).map((p: any) => [p.id, { email: p.email, full_name: p.full_name }]),
      );
    }
    return (data ?? []).map((m: any) => ({
      ...m,
      owner: ownerMap.get(m.owner_user_id) ?? null,
    }));
  });

export const platformAdminApprove = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ municipality_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertGlobalAdmin(context.userId);
    const admin: any = supabaseAdmin;

    const { data: m, error: mErr } = await admin
      .from("municipalities")
      .select("id, status, owner_user_id")
      .eq("id", data.municipality_id)
      .single();
    if (mErr || !m) throw new Error("البلدية غير موجودة");
    if (m.status === "verified") throw new Error("معتمدة بالفعل");

    // 1. Update municipality
    const { error: uErr } = await admin
      .from("municipalities")
      .update({
        status: "verified",
        verified_by: context.userId,
        verified_at: new Date().toISOString(),
        rejection_reason: null,
      })
      .eq("id", data.municipality_id);
    if (uErr) throw new Error(uErr.message);

    // 2. Create super_admin membership for the owner
    const { error: memErr } = await admin
      .from("municipality_members")
      .upsert(
        {
          municipality_id: data.municipality_id,
          user_id: m.owner_user_id,
          role: "super_admin",
        },
        { onConflict: "municipality_id,user_id" },
      );
    if (memErr) throw new Error(memErr.message);

    // 3. Ensure owner has super_admin role in user_roles
    await admin
      .from("user_roles")
      .upsert(
        { user_id: m.owner_user_id, role: "super_admin" },
        { onConflict: "user_id,role" },
      );

    return { ok: true };
  });

export const platformAdminReject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        municipality_id: z.string().uuid(),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertGlobalAdmin(context.userId);
    const { error } = await (supabaseAdmin as any)
      .from("municipalities")
      .update({
        status: "rejected",
        rejection_reason: data.reason,
        verified_by: context.userId,
        verified_at: new Date().toISOString(),
      })
      .eq("id", data.municipality_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
