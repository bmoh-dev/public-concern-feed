import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { signAttachments } from "@/lib/complaints.functions";
import {
  AuthzError,
  getAdminMunicipalityIds,
  getMyDepartmentInfo,
  sanitizeSearchTerm,
} from "@/lib/authz.server";

const admin: any = supabaseAdmin;

/**
 * Department admin context.
 * Each department admin is bound to exactly one department, which belongs to
 * exactly one municipality. Municipality admins (admin/super_admin) may also
 * act on departments in the municipalities they administer.
 */
async function resolveActorScope(userId: string): Promise<{
  departmentId: string | null;
  municipalityIds: string[];
}> {
  const [dept, muniIds] = await Promise.all([
    getMyDepartmentInfo(userId),
    getAdminMunicipalityIds(userId),
  ]);
  const munis = new Set<string>(muniIds);
  if (dept?.municipality_id) munis.add(dept.municipality_id);
  return { departmentId: dept?.department_id ?? null, municipalityIds: Array.from(munis) };
}

export const listDepartments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ municipality_id: z.string().uuid().optional() })
      .partial()
      .optional()
      .transform((v) => v ?? {})
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { municipalityIds } = await resolveActorScope(context.userId);
    if (!municipalityIds.length) throw new AuthzError();
    const target = data.municipality_id;
    const muniFilter =
      target && municipalityIds.includes(target) ? [target] : municipalityIds;
    const { data: rows, error } = await admin
      .from("departments")
      .select("id, slug, name_ar, municipality_id")
      .in("municipality_id", muniFilter)
      .order("name_ar");
    if (error) {
      console.error("[listDepartments]", error);
      throw new Error("تعذّر تحميل الأقسام");
    }
    return rows ?? [];
  });

export const getMyDepartment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const info = await getMyDepartmentInfo(context.userId);
    if (!info) return null;
    const { data } = await admin
      .from("departments")
      .select("id, slug, name_ar, municipality_id")
      .eq("id", info.department_id)
      .maybeSingle();
    return data;
  });

export const listDepartmentComplaints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        search: z.string().max(200).nullable().optional(),
        status: z.enum(["pending", "in_progress", "resolved"]).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const info = await getMyDepartmentInfo(context.userId);
    if (!info) throw new AuthzError();

    let q = admin
      .from("complaints")
      .select(
        "id, complaint_number, title, category, status, address, description, internal_notes, created_at, user_id, assigned_department_id, municipality_id, attachments(id, storage_path, file_name, mime_type)",
      )
      .eq("assigned_department_id", info.department_id)
      // Defense in depth: department belongs to one municipality.
      .eq("municipality_id", info.municipality_id)
      .order("created_at", { ascending: false });
    if (data.status) q = q.eq("status", data.status);
    if (data.search) {
      const s = sanitizeSearchTerm(data.search);
      const uuid = /^[0-9a-f-]{36}$/i.test(data.search.trim())
        ? data.search.trim()
        : "00000000-0000-0000-0000-000000000000";
      if (s) {
        q = q.or(
          `title.ilike.%${s}%,description.ilike.%${s}%,complaint_number.ilike.%${s}%,id.eq.${uuid}`,
        );
      } else {
        q = q.eq("id", uuid);
      }
    }
    const { data: rows, error } = await q.limit(500);
    if (error) {
      console.error("[listDepartmentComplaints]", error);
      throw new Error("تعذّر تحميل الشكاوى");
    }
    return Promise.all(
      (rows ?? []).map(async (r: any) => ({
        ...r,
        attachments: await signAttachments(r.attachments ?? []),
      })),
    );
  });

export const departmentUpdateComplaint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["pending", "in_progress", "resolved"]).optional(),
        internal_notes: z.string().max(5000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { departmentId, municipalityIds } = await resolveActorScope(context.userId);
    if (!departmentId && municipalityIds.length === 0) throw new AuthzError();

    const { data: c } = await admin
      .from("complaints")
      .select("id, assigned_department_id, municipality_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!c) throw new Error("غير موجود");

    const isDeptMatch = departmentId && c.assigned_department_id === departmentId;
    const isMuniAdmin = municipalityIds.includes(c.municipality_id);
    if (!isDeptMatch && !isMuniAdmin) throw new AuthzError();

    const patch: any = {};
    if (data.status) patch.status = data.status;
    if (data.internal_notes !== undefined) patch.internal_notes = data.internal_notes;
    if (!Object.keys(patch).length) return { ok: true };
    const { error } = await admin.from("complaints").update(patch).eq("id", data.id);
    if (error) {
      console.error("[departmentUpdateComplaint]", error);
      throw new Error("تعذّر تحديث الشكوى");
    }
    return { ok: true };
  });

export const redirectComplaint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        complaint_id: z.string().uuid(),
        to_department_id: z.string().uuid(),
        reason: z.string().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const actorId = context.userId;
    const { departmentId, municipalityIds } = await resolveActorScope(actorId);
    if (!departmentId && municipalityIds.length === 0) throw new AuthzError();

    const { data: complaint } = await admin
      .from("complaints")
      .select("id, user_id, assigned_department_id, municipality_id, title")
      .eq("id", data.complaint_id)
      .maybeSingle();
    if (!complaint) throw new Error("غير موجود");

    // The actor must either own the source department of this complaint,
    // or be an admin of the complaint's municipality.
    const isDeptOrigin =
      departmentId && complaint.assigned_department_id === departmentId;
    const isMuniAdmin = municipalityIds.includes(complaint.municipality_id);
    if (!isDeptOrigin && !isMuniAdmin) throw new AuthzError();

    // Target department MUST belong to the SAME municipality as the complaint.
    const { data: toDept } = await admin
      .from("departments")
      .select("id, name_ar, municipality_id")
      .eq("id", data.to_department_id)
      .maybeSingle();
    if (!toDept) throw new Error("القسم غير موجود");
    if (toDept.municipality_id !== complaint.municipality_id) {
      throw new AuthzError("لا يمكن إحالة شكوى إلى قسم في بلدية أخرى");
    }
    if (complaint.assigned_department_id === data.to_department_id) {
      throw new Error("الشكوى محالة بالفعل إلى هذا القسم");
    }

    const fromDeptId = complaint.assigned_department_id;

    const { error: uErr } = await admin
      .from("complaints")
      .update({ assigned_department_id: data.to_department_id })
      .eq("id", data.complaint_id);
    if (uErr) {
      console.error("[redirectComplaint] update", uErr);
      throw new Error("تعذّر إحالة الشكوى");
    }

    await admin.from("complaint_routing_history").insert({
      complaint_id: data.complaint_id,
      from_department_id: fromDeptId,
      to_department_id: data.to_department_id,
      actor_user_id: actorId,
      reason: data.reason ?? null,
    });

    await admin.from("notifications").insert({
      user_id: complaint.user_id,
      complaint_id: data.complaint_id,
      title: "تمت إحالة شكواك",
      body: `تمت إحالة شكواك إلى ${toDept.name_ar}`,
    });

    const { data: targetAdmins } = await admin
      .from("department_admins")
      .select("user_id")
      .eq("department_id", data.to_department_id);
    if (targetAdmins?.length) {
      const rows = targetAdmins.map((a: any) => ({
        user_id: a.user_id,
        complaint_id: data.complaint_id,
        title: "شكوى جديدة محالة إلى قسمك",
        body: complaint.title,
      }));
      await admin.from("notifications").insert(rows);
    }

    return { ok: true };
  });

export const listRoutingHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ complaint_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { departmentId, municipalityIds } = await resolveActorScope(context.userId);
    if (!departmentId && municipalityIds.length === 0) throw new AuthzError();

    const { data: complaint } = await admin
      .from("complaints")
      .select("id, municipality_id, assigned_department_id")
      .eq("id", data.complaint_id)
      .maybeSingle();
    if (!complaint) throw new Error("غير موجود");

    const isDept = departmentId && complaint.assigned_department_id === departmentId;
    const isMuni = municipalityIds.includes(complaint.municipality_id);
    if (!isDept && !isMuni) throw new AuthzError();

    const { data: rows, error } = await admin
      .from("complaint_routing_history")
      .select("id, from_department_id, to_department_id, actor_user_id, reason, created_at")
      .eq("complaint_id", data.complaint_id)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[listRoutingHistory]", error);
      throw new Error("تعذّر تحميل السجل");
    }

    const deptIds = Array.from(
      new Set(
        rows?.flatMap((r: any) => [r.from_department_id, r.to_department_id]).filter(Boolean) ?? [],
      ),
    );
    const actorIds = Array.from(new Set(rows?.map((r: any) => r.actor_user_id) ?? []));
    const [{ data: depts }, { data: profs }] = await Promise.all([
      deptIds.length
        ? admin.from("departments").select("id, name_ar").in("id", deptIds)
        : Promise.resolve({ data: [] }),
      actorIds.length
        ? admin.from("profiles").select("id, full_name, email").in("id", actorIds)
        : Promise.resolve({ data: [] }),
    ]);
    const dMap = new Map((depts ?? []).map((d: any) => [d.id, d.name_ar]));
    const pMap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name || p.email || "—"]));
    return (rows ?? []).map((r: any) => ({
      ...r,
      from_department_name: r.from_department_id ? (dMap.get(r.from_department_id) ?? "—") : null,
      to_department_name: dMap.get(r.to_department_id) ?? "—",
      actor_name: pMap.get(r.actor_user_id) ?? "—",
    }));
  });

// ============ Municipality super-admin: manage department admins ============
// Only a municipality super_admin may assign a department admin, and ONLY for
// departments inside their own municipality. Global Admin (platform role)
// does NOT have municipality data access here.
export const setDepartmentAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        target_user_id: z.string().uuid(),
        department_id: z.string().uuid().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Caller must be super_admin of some municipality.
    const { data: myMemberships } = await admin
      .from("municipality_members")
      .select("municipality_id, role, municipalities:municipality_id(status)")
      .eq("user_id", context.userId)
      .eq("role", "super_admin");
    const myMunis = (myMemberships ?? [])
      .filter((m: any) => m.municipalities?.status === "verified")
      .map((m: any) => m.municipality_id as string);
    if (myMunis.length === 0) throw new AuthzError();

    if (data.department_id === null) {
      // Removing — only allowed if the target's current department is in our munis.
      const { data: cur } = await admin
        .from("department_admins")
        .select("department_id, departments:department_id(municipality_id)")
        .eq("user_id", data.target_user_id)
        .maybeSingle();
      if (cur && !myMunis.includes((cur as any).departments?.municipality_id)) {
        throw new AuthzError();
      }
      const { error } = await admin
        .from("department_admins")
        .delete()
        .eq("user_id", data.target_user_id);
      if (error) {
        console.error("[setDepartmentAdmin] delete", error);
        throw new Error("تعذّر إزالة المسؤول");
      }
      return { ok: true, role: "citizen" as const };
    }

    const { data: dept } = await admin
      .from("departments")
      .select("id, municipality_id")
      .eq("id", data.department_id)
      .maybeSingle();
    if (!dept) throw new Error("القسم غير موجود");
    if (!myMunis.includes(dept.municipality_id)) throw new AuthzError();

    // A platform global admin cannot also become a department admin.
    const { data: globalRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.target_user_id)
      .eq("role", "global_admin")
      .maybeSingle();
    if (globalRow) throw new Error("لا يمكن تعيين مسؤول منصّة كمسؤول قسم");

    const { error: dErr } = await admin
      .from("department_admins")
      .delete()
      .eq("user_id", data.target_user_id);
    if (dErr) {
      console.error("[setDepartmentAdmin] reset", dErr);
      throw new Error("تعذّر تحديث المسؤول");
    }
    const { error } = await admin.from("department_admins").insert({
      user_id: data.target_user_id,
      department_id: data.department_id,
    });
    if (error) {
      console.error("[setDepartmentAdmin] insert", error);
      throw new Error("تعذّر تعيين المسؤول");
    }
    return { ok: true, role: "department_admin" as const };
  });
