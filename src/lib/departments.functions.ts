import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const admin = supabaseAdmin as any;

async function assertGeneralAdmin(userId: string) {
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: general admin only");
}

async function getMyDepartmentId(userId: string): Promise<string | null> {
  const { data } = await admin
    .from("department_admins")
    .select("department_id")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.department_id ?? null;
}

async function isGeneralAdmin(userId: string): Promise<boolean> {
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

export const listDepartments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data, error } = await admin
      .from("departments")
      .select("id, slug, name_ar")
      .order("name_ar");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getMyDepartment = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const deptId = await getMyDepartmentId(context.userId);
    if (!deptId) return null;
    const { data } = await admin
      .from("departments")
      .select("id, slug, name_ar")
      .eq("id", deptId)
      .maybeSingle();
    return data;
  });

export const listDepartmentComplaints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      search: z.string().max(200).nullable().optional(),
      status: z.enum(["pending", "in_progress", "resolved"]).nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const deptId = await getMyDepartmentId(context.userId);
    if (!deptId) throw new Error("Forbidden: department admin only");
    let q = admin
      .from("complaints")
      .select("id, title, category, status, address, description, internal_notes, created_at, user_id, assigned_department_id")
      .eq("assigned_department_id", deptId)
      .order("created_at", { ascending: false });
    if (data.status) q = q.eq("status", data.status);
    if (data.search) q = q.or(`title.ilike.%${data.search}%,description.ilike.%${data.search}%,id.eq.${/^[0-9a-f-]{36}$/i.test(data.search) ? data.search : "00000000-0000-0000-0000-000000000000"}`);
    const { data: rows, error } = await q.limit(500);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const departmentUpdateComplaint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["pending", "in_progress", "resolved"]).optional(),
      internal_notes: z.string().max(5000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const deptId = await getMyDepartmentId(context.userId);
    const general = await isGeneralAdmin(context.userId);
    if (!deptId && !general) throw new Error("Forbidden");
    // Verify ownership
    const { data: c } = await admin
      .from("complaints")
      .select("id, assigned_department_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!c) throw new Error("Not found");
    if (!general && c.assigned_department_id !== deptId) throw new Error("Forbidden: not in your department");
    const patch: any = {};
    if (data.status) patch.status = data.status;
    if (data.internal_notes !== undefined) patch.internal_notes = data.internal_notes;
    if (!Object.keys(patch).length) return { ok: true };
    const { error } = await admin.from("complaints").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const redirectComplaint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      complaint_id: z.string().uuid(),
      to_department_id: z.string().uuid(),
      reason: z.string().max(2000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const actorId = context.userId;
    const myDept = await getMyDepartmentId(actorId);
    const general = await isGeneralAdmin(actorId);
    if (!myDept && !general) throw new Error("Forbidden");

    const { data: complaint } = await admin
      .from("complaints")
      .select("id, user_id, assigned_department_id, title")
      .eq("id", data.complaint_id)
      .maybeSingle();
    if (!complaint) throw new Error("Not found");

    // Permission: general admin can redirect anything; dept admin only if it belongs to their dept
    if (!general && complaint.assigned_department_id !== myDept) {
      throw new Error("Forbidden: complaint not in your department");
    }
    if (complaint.assigned_department_id === data.to_department_id) {
      throw new Error("Complaint already assigned to this department");
    }

    const fromDeptId = complaint.assigned_department_id;

    // Update assignment
    const { error: uErr } = await admin
      .from("complaints")
      .update({ assigned_department_id: data.to_department_id })
      .eq("id", data.complaint_id);
    if (uErr) throw new Error(uErr.message);

    // Routing history
    await admin.from("complaint_routing_history").insert({
      complaint_id: data.complaint_id,
      from_department_id: fromDeptId,
      to_department_id: data.to_department_id,
      actor_user_id: actorId,
      reason: data.reason ?? null,
    });

    // Notifications: complaint owner
    const { data: toDept } = await admin
      .from("departments")
      .select("name_ar")
      .eq("id", data.to_department_id)
      .maybeSingle();
    const deptName = toDept?.name_ar ?? "قسم آخر";

    await admin.from("notifications").insert({
      user_id: complaint.user_id,
      complaint_id: data.complaint_id,
      title: "تمت إحالة شكواك",
      body: `تمت إحالة شكواك إلى ${deptName}`,
    });

    // Notify destination department admins
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
    const myDept = await getMyDepartmentId(context.userId);
    const general = await isGeneralAdmin(context.userId);
    if (!myDept && !general) throw new Error("Forbidden");

    const { data: rows, error } = await admin
      .from("complaint_routing_history")
      .select("id, from_department_id, to_department_id, actor_user_id, reason, created_at")
      .eq("complaint_id", data.complaint_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    // Resolve department names + actor names
    const deptIds = Array.from(new Set(rows?.flatMap((r: any) => [r.from_department_id, r.to_department_id]).filter(Boolean) ?? []));
    const actorIds = Array.from(new Set(rows?.map((r: any) => r.actor_user_id) ?? []));
    const [{ data: depts }, { data: profs }] = await Promise.all([
      deptIds.length ? admin.from("departments").select("id, name_ar").in("id", deptIds) : Promise.resolve({ data: [] }),
      actorIds.length ? admin.from("profiles").select("id, full_name, email").in("id", actorIds) : Promise.resolve({ data: [] }),
    ]);
    const dMap = new Map((depts ?? []).map((d: any) => [d.id, d.name_ar]));
    const pMap = new Map((profs ?? []).map((p: any) => [p.id, p.full_name || p.email || "—"]));
    return (rows ?? []).map((r: any) => ({
      ...r,
      from_department_name: r.from_department_id ? dMap.get(r.from_department_id) ?? "—" : null,
      to_department_name: dMap.get(r.to_department_id) ?? "—",
      actor_name: pMap.get(r.actor_user_id) ?? "—",
    }));
  });

// ============ General admin: manage department admins ============
export const setDepartmentAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      target_user_id: z.string().uuid(),
      department_id: z.string().uuid().nullable(), // null = remove
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertGeneralAdmin(context.userId);
    if (data.department_id === null) {
      const { error } = await admin.from("department_admins").delete().eq("user_id", data.target_user_id);
      if (error) throw new Error(error.message);
      return { ok: true, role: "citizen" as const };
    }
    const { data: dept } = await admin.from("departments").select("id").eq("id", data.department_id).maybeSingle();
    if (!dept) throw new Error("Department not found");

    // Cannot be both general admin and department admin
    const general = await isGeneralAdmin(data.target_user_id);
    if (general) throw new Error("لا يمكن تعيين مسؤول عام كمسؤول قسم");

    // Upsert
    const { error: dErr } = await admin.from("department_admins").delete().eq("user_id", data.target_user_id);
    if (dErr) throw new Error(dErr.message);
    const { error } = await admin.from("department_admins").insert({
      user_id: data.target_user_id,
      department_id: data.department_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true, role: "department_admin" as const };
  });
