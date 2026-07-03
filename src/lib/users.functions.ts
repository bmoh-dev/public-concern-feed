import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { AuthzError, requireMunicipalityAdmin } from "@/lib/authz.server";
import { enforceRateLimit, RateLimitError } from "@/lib/rate-limit.server";
import { RATE_LIMITS } from "@/lib/rate-limits";

/**
 * Municipality-scoped user management. Endpoints here ALWAYS verify the
 * acting user administrates the targeted municipality, and never touch
 * users outside it. Platform roles (global_admin) are handled separately
 * in platform.functions.ts.
 */

const admin: any = supabaseAdmin;

function formatAlgiersHHMM(d: Date): string {
  return new Intl.DateTimeFormat("ar-DZ", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Algiers",
  }).format(d);
}

/** Returns the verified-municipality IDs the acting user super-administers. */
async function getMySuperAdminMuniIds(userId: string): Promise<string[]> {
  const { data } = await admin
    .from("municipality_members")
    .select("municipality_id, role, municipalities:municipality_id(status)")
    .eq("user_id", userId)
    .eq("role", "super_admin");
  return (data ?? [])
    .filter((r: any) => r.municipalities?.status === "verified")
    .map((r: any) => r.municipality_id as string);
}

async function assertSuperAdminOf(userId: string, municipalityId: string): Promise<void> {
  const ids = await getMySuperAdminMuniIds(userId);
  if (!ids.includes(municipalityId)) throw new AuthzError();
}

export const searchUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        q: z.string().trim().max(200).optional().default(""),
        municipality_id: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Rate limit: 20 searches / minute / user.
    try {
      await enforceRateLimit({
        ...RATE_LIMITS.userSearchPerMinute,
        userId: context.userId,
      });
    } catch (e) {
      if (e instanceof RateLimitError) {
        const reset = new Date(Date.now() + e.retryAfterSeconds * 1000);
        return {
          rows: [] as any[],
          rateLimitMessage:
            `لقد وصلت إلى الحد المسموح لعمليات البحث.\n` +
            `يمكنك البحث مرة أخرى ابتداءً من ${formatAlgiersHHMM(reset)}.`,
          rateLimitResetAt: reset.toISOString(),
        };
      }
      throw e;
    }

    // Autocomplete only — require at least 2 characters before querying.
    const term = data.q.trim();
    if (term.length < 2) return { rows: [], rateLimitMessage: null, rateLimitResetAt: null };

    // Verify the caller administers the target municipality, then scope
    // STRICTLY to members of that single municipality.
    const adminMuniIds = await requireMunicipalityAdmin(context.userId);
    const targetMuni = data.municipality_id ?? adminMuniIds[0];
    if (!targetMuni || !adminMuniIds.includes(targetMuni)) {
      throw new AuthzError();
    }
    const muniIds = [targetMuni];

    const { data: members } = await admin
      .from("municipality_members")
      .select("user_id")
      .eq("municipality_id", targetMuni);
    const memberIds: string[] = Array.from(
      new Set((members ?? []).map((m: any) => m.user_id as string)),
    );
    if (!memberIds.length)
      return { rows: [] as any[], rateLimitMessage: null, rateLimitResetAt: null };

    const query = (supabaseAdmin as any)
      .from("profiles")
      .select("id, full_name, email")
      .in("id", memberIds)
      .ilike("email", `%${term.replace(/[%_\\]/g, " ")}%`)
      .order("email", { ascending: true })
      .limit(10);
    const { data: profiles, error } = await query;
    if (error) {
      console.error("[searchUsers]", error);
      throw new Error("تعذّر البحث عن المستخدمين");
    }
    const ids: string[] = (profiles ?? []).map((p: any) => p.id);
    const roleMap = new Map<string, "global_admin" | "super_admin" | "admin" | "citizen">();
    const deptMap = new Map<string, { id: string; name: string }>();
    if (ids.length) {
      const [{ data: roles }, { data: deptRows }] = await Promise.all([
        supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
        (supabaseAdmin as any)
          .from("department_admins")
          .select("user_id, department_id, departments:department_id (name_ar, municipality_id)")
          .in("user_id", ids),
      ]);
      for (const r of roles ?? []) {
        const cur = roleMap.get(r.user_id);
        if (
          !cur ||
          r.role === "global_admin" ||
          (r.role === "super_admin" && cur !== "global_admin") ||
          (r.role === "admin" && cur === "citizen")
        ) {
          roleMap.set(r.user_id, r.role as "global_admin" | "super_admin" | "admin" | "citizen");
        }
      }
      for (const d of (deptRows ?? []) as any[]) {
        if (muniIds.includes(d.departments?.municipality_id)) {
          deptMap.set(d.user_id, { id: d.department_id, name: d.departments?.name_ar ?? "" });
        }
      }
    }
    const { data: memRoles } = await admin
      .from("municipality_members")
      .select("user_id, role, municipality_id")
      .in("municipality_id", muniIds)
      .in("user_id", ids);
    const muniRoleMap = new Map<string, "super_admin" | "admin" | "citizen">();
    const muniIdByUser = new Map<string, string>();
    for (const m of (memRoles ?? []) as any[]) {
      const cur = muniRoleMap.get(m.user_id);
      if (
        !cur ||
        m.role === "super_admin" ||
        (m.role === "admin" && cur === "citizen")
      ) {
        muniRoleMap.set(m.user_id, m.role);
        muniIdByUser.set(m.user_id, m.municipality_id);
      } else if (!muniIdByUser.has(m.user_id)) {
        muniIdByUser.set(m.user_id, m.municipality_id);
      }
    }
    const rows = (profiles ?? []).map((p: any) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      role: roleMap.get(p.id) ?? "citizen",
      municipality_role: muniRoleMap.get(p.id) ?? "citizen",
      municipality_id: muniIdByUser.get(p.id) ?? muniIds[0] ?? null,
      department_id: deptMap.get(p.id)?.id ?? null,
      department_name: deptMap.get(p.id)?.name ?? null,
    }));
    return { rows, rateLimitMessage: null as string | null, rateLimitResetAt: null as string | null };
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
    await requireMunicipalityAdmin(context.userId);
    const actorId = context.userId;
    const targetId = data.target_user_id;

    // Refuse to touch platform roles via this endpoint. Promotion to
    // global_admin is handled exclusively by platform.functions.ts.
    const { data: targetRoles, error: rErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", targetId);
    if (rErr) {
      console.error("[changeUserRole] read", rErr);
      throw new Error("تعذّر قراءة دور المستخدم");
    }
    const hasGlobal = (targetRoles ?? []).some((r) => r.role === "global_admin");
    const hasSuper = (targetRoles ?? []).some((r) => r.role === "super_admin");
    if (hasGlobal || hasSuper) {
      throw new AuthzError("لا يمكن تعديل أدوار المسؤولين عبر هذه الواجهة");
    }
    const isAdmin = (targetRoles ?? []).some((r) => r.role === "admin");
    const previousRole: "admin" | "citizen" = isAdmin ? "admin" : "citizen";

    if (data.action === "promote") {
      if (isAdmin) throw new Error("المستخدم مسؤول بالفعل");
      const { error } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: targetId, role: "admin" });
      if (error) {
        console.error("[changeUserRole] insert", error);
        throw new Error("تعذّر ترقية المستخدم");
      }
    } else {
      if (!isAdmin) throw new Error("المستخدم ليس مسؤولاً");
      const { count, error: cErr } = await supabaseAdmin
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "admin");
      if (cErr) {
        console.error("[changeUserRole] count", cErr);
        throw new Error("تعذّر تحديث الدور");
      }
      if ((count ?? 0) <= 1) throw new Error("لا يمكن إزالة آخر مسؤول في النظام");
      if (targetId === actorId && (count ?? 0) <= 1) {
        throw new Error("لا يمكنك تخفيض نفسك كآخر مسؤول");
      }
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", targetId)
        .eq("role", "admin");
      if (error) {
        console.error("[changeUserRole] delete", error);
        throw new Error("تعذّر تخفيض المستخدم");
      }
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

// ===== Municipality Super-Admin management =====

/** List super_admins of a municipality the caller administers. */
export const muniListSuperAdmins = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ municipality_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Both super_admins and regular admins can VIEW the list.
    const muniIds = await requireMunicipalityAdmin(context.userId);
    if (!muniIds.includes(data.municipality_id)) throw new AuthzError();
    const { data: rows } = await admin
      .from("municipality_members")
      .select("user_id, role, joined_at")
      .eq("municipality_id", data.municipality_id)
      .eq("role", "super_admin")
      .order("joined_at", { ascending: true });
    const ids = (rows ?? []).map((r: any) => r.user_id);
    let profilesMap = new Map<string, { full_name: string | null; email: string | null }>();
    if (ids.length) {
      const { data: profs } = await admin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", ids);
      profilesMap = new Map(
        (profs ?? []).map((p: any) => [p.id, { full_name: p.full_name, email: p.email }]),
      );
    }
    return {
      admins: (rows ?? []).map((r: any) => ({
        user_id: r.user_id,
        joined_at: r.joined_at,
        full_name: profilesMap.get(r.user_id)?.full_name ?? null,
        email: profilesMap.get(r.user_id)?.email ?? null,
        is_self: r.user_id === context.userId,
      })),
      self_user_id: context.userId,
    };
  });

async function findMemberByEmail(municipalityId: string, email: string) {
  const trimmed = email.trim();
  if (!trimmed) throw new Error("أدخل بريداً إلكترونياً");
  const { data: prof } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .ilike("email", trimmed)
    .maybeSingle();
  if (!prof) throw new Error("لم يتم العثور على المستخدم");
  const { data: mem } = await admin
    .from("municipality_members")
    .select("user_id, role")
    .eq("municipality_id", municipalityId)
    .eq("user_id", prof.id)
    .maybeSingle();
  if (!mem) throw new Error("هذا المستخدم ليس عضواً في هذه البلدية");
  return { profile: prof, member: mem };
}

async function countSuperAdmins(municipalityId: string): Promise<number> {
  const { count } = await admin
    .from("municipality_members")
    .select("user_id", { count: "exact", head: true })
    .eq("municipality_id", municipalityId)
    .eq("role", "super_admin");
  return count ?? 0;
}

/** Promote a citizen of the municipality to Municipality Super Admin. */
export const muniPromoteSuperAdminByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        municipality_id: z.string().uuid(),
        email: z.string().email().max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdminOf(context.userId, data.municipality_id);
    const { profile, member } = await findMemberByEmail(data.municipality_id, data.email);
    if (member.role === "super_admin") throw new Error("المستخدم مسؤول أعلى بالفعل");

    const { error } = await admin
      .from("municipality_members")
      .update({ role: "super_admin" })
      .eq("municipality_id", data.municipality_id)
      .eq("user_id", profile.id);
    if (error) {
      console.error("[muniPromoteSuperAdminByEmail]", error);
      throw new Error("تعذّر الترقية");
    }
    await admin
      .from("user_roles")
      .upsert({ user_id: profile.id, role: "super_admin" }, { onConflict: "user_id,role" });
    return { ok: true, user_id: profile.id };
  });

/** Demote any super_admin / admin in this municipality back to citizen. */
export const muniDemoteToCitizen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        municipality_id: z.string().uuid(),
        target_user_id: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdminOf(context.userId, data.municipality_id);

    const { data: mem } = await admin
      .from("municipality_members")
      .select("role")
      .eq("municipality_id", data.municipality_id)
      .eq("user_id", data.target_user_id)
      .maybeSingle();
    if (!mem) throw new Error("المستخدم ليس عضواً في هذه البلدية");
    if (mem.role === "citizen") throw new Error("المستخدم مواطن بالفعل");

    if (mem.role === "super_admin") {
      const count = await countSuperAdmins(data.municipality_id);
      if (count <= 1) throw new Error("لا يمكن إزالة آخر مسؤول أعلى للبلدية");
    }

    const { error } = await admin
      .from("municipality_members")
      .update({ role: "citizen" })
      .eq("municipality_id", data.municipality_id)
      .eq("user_id", data.target_user_id);
    if (error) {
      console.error("[muniDemoteToCitizen]", error);
      throw new Error("تعذّر التخفيض");
    }

    // If the user no longer holds super_admin in any municipality, drop the
    // platform-wide super_admin role row (kept consistent with promote flow).
    const remainingSuper = await admin
      .from("municipality_members")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", data.target_user_id)
      .eq("role", "super_admin");
    if ((remainingSuper.count ?? 0) === 0) {
      await admin
        .from("user_roles")
        .delete()
        .eq("user_id", data.target_user_id)
        .eq("role", "super_admin");
    }

    // Also drop any department-admin assignment in this municipality.
    const { data: depts } = await admin
      .from("departments")
      .select("id")
      .eq("municipality_id", data.municipality_id);
    const deptIds = (depts ?? []).map((d: any) => d.id);
    if (deptIds.length) {
      await admin
        .from("department_admins")
        .delete()
        .eq("user_id", data.target_user_id)
        .in("department_id", deptIds);
    }
    return { ok: true };
  });

/** Transfer "primary" responsibility: promote target + demote actor in one step. */
export const muniTransferSuperAdminByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        municipality_id: z.string().uuid(),
        email: z.string().email().max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdminOf(context.userId, data.municipality_id);
    const { profile, member } = await findMemberByEmail(data.municipality_id, data.email);
    if (profile.id === context.userId)
      throw new Error("لا يمكن نقل المسؤولية إلى نفسك");

    if (member.role !== "super_admin") {
      const { error } = await admin
        .from("municipality_members")
        .update({ role: "super_admin" })
        .eq("municipality_id", data.municipality_id)
        .eq("user_id", profile.id);
      if (error) throw new Error("تعذّر ترقية المستلم");
      await admin
        .from("user_roles")
        .upsert({ user_id: profile.id, role: "super_admin" }, { onConflict: "user_id,role" });
    }

    // After ensuring at least 2 super_admins exist, demote actor.
    const count = await countSuperAdmins(data.municipality_id);
    if (count < 2) throw new Error("تعذّر إكمال النقل");

    const { error: dErr } = await admin
      .from("municipality_members")
      .update({ role: "citizen" })
      .eq("municipality_id", data.municipality_id)
      .eq("user_id", context.userId);
    if (dErr) throw new Error("تعذّر تخفيض المسؤول الحالي");

    const remainingSuper = await admin
      .from("municipality_members")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("role", "super_admin");
    if ((remainingSuper.count ?? 0) === 0) {
      await admin
        .from("user_roles")
        .delete()
        .eq("user_id", context.userId)
        .eq("role", "super_admin");
    }
    return { ok: true };
  });

/** Acting super_admin abandons own role; only allowed if another super_admin exists. */
export const muniAbandonSuperAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ municipality_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdminOf(context.userId, data.municipality_id);
    const count = await countSuperAdmins(data.municipality_id);
    if (count <= 1)
      return { ok: false as const, message: "لا يمكنك التخلي عن دورك لأنك آخر مسؤول أعلى للبلدية" };


    const { error } = await admin
      .from("municipality_members")
      .update({ role: "citizen" })
      .eq("municipality_id", data.municipality_id)
      .eq("user_id", context.userId);
    if (error) throw new Error("تعذّر التخلي عن المسؤولية");

    const remainingSuper = await admin
      .from("municipality_members")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .eq("role", "super_admin");
    if ((remainingSuper.count ?? 0) === 0) {
      await admin
        .from("user_roles")
        .delete()
        .eq("user_id", context.userId)
        .eq("role", "super_admin");
    }
    return { ok: true };
  });
