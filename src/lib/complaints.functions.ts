import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CategoryEnum = z.enum(["infrastructure", "public_lighting", "cleanliness", "other"]);
const StatusEnum = z.enum(["pending", "in_progress", "resolved"]);

export const submitComplaint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      title: z.string().min(3).max(200),
      category: CategoryEnum,
      address: z.string().min(3).max(500),
      description: z.string().min(5).max(5000),
      attachments: z
        .array(
          z.object({
            storage_path: z.string().min(1).max(500),
            file_name: z.string().min(1).max(255),
            mime_type: z.string().min(1).max(120),
            size_bytes: z.number().int().min(0).max(8 * 1024 * 1024),
          }),
        )
        .max(5)
        .optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: complaint, error } = await supabase
      .from("complaints")
      .insert({
        user_id: userId,
        title: data.title,
        category: data.category,
        address: data.address,
        description: data.description,
      })
      .select("id")
      .single();
    if (error || !complaint) throw new Error(error?.message || "Failed to submit");

    if (data.attachments?.length) {
      const rows = data.attachments.map((a) => ({ complaint_id: complaint.id, ...a }));
      const { error: aErr } = await supabase.from("attachments").insert(rows);
      if (aErr) throw new Error(aErr.message);
    }
    return { id: complaint.id };
  });

export const listMyComplaints = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("complaints")
      .select("id, title, category, status, address, description, created_at, updated_at, attachments(id, storage_path, file_name, mime_type)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getMyComplaint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("complaints")
      .select("id, title, category, status, address, description, created_at, updated_at, internal_notes, user_id, attachments(id, storage_path, file_name, mime_type)")
      .eq("id", data.id)
      .single();
    if (error || !row) throw new Error("Not found");
    if (row.user_id !== userId) throw new Error("Forbidden");
    return row;
  });

// PUBLIC feed — anon-safe
export const listPublicComplaints = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({
      category: CategoryEnum.nullable().optional(),
      search: z.string().max(200).nullable().optional(),
      limit: z.number().int().min(1).max(50).default(12),
      offset: z.number().int().min(0).max(10000).default(0),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    let q = supabaseAdmin
      .from("complaints")
      .select("id, title, category, status, address, description, created_at, attachments(id, storage_path, file_name, mime_type)")
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (data.category) q = q.eq("category", data.category);
    if (data.search) q = q.ilike("title", `%${data.search}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ADMIN
async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

export const adminListComplaints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      search: z.string().max(200).nullable().optional(),
      status: StatusEnum.nullable().optional(),
      category: CategoryEnum.nullable().optional(),
      from: z.string().nullable().optional(),
      to: z.string().nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    let q = supabaseAdmin
      .from("complaints")
      .select("id, title, category, status, address, description, internal_notes, created_at, user_id")
      .order("created_at", { ascending: false });
    if (data.status) q = q.eq("status", data.status);
    if (data.category) q = q.eq("category", data.category);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    if (data.search) q = q.or(`title.ilike.%${data.search}%,description.ilike.%${data.search}%,id.eq.${/^[0-9a-f-]{36}$/i.test(data.search) ? data.search : "00000000-0000-0000-0000-000000000000"}`);
    const { data: rows, error } = await q.limit(500);
    if (error) throw new Error(error.message);
    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    let profilesMap = new Map<string, { full_name: string | null; email: string | null }>();
    if (userIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      profilesMap = new Map((profs ?? []).map((p) => [p.id, { full_name: p.full_name, email: p.email }]));
    }
    return (rows ?? []).map((r) => ({ ...r, profiles: profilesMap.get(r.user_id) ?? null }));
  });

export const adminMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await supabaseAdmin.from("complaints").select("status");
    if (error) throw new Error(error.message);
    const total = data.length;
    const pending = data.filter((r) => r.status === "pending").length;
    const in_progress = data.filter((r) => r.status === "in_progress").length;
    const resolved = data.filter((r) => r.status === "resolved").length;
    return { total, pending, in_progress, resolved };
  });

export const adminUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      ids: z.array(z.string().uuid()).min(1).max(200),
      status: StatusEnum.optional(),
      internal_notes: z.string().max(5000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const patch: { status?: "pending" | "in_progress" | "resolved"; internal_notes?: string } = {};
    if (data.status) patch.status = data.status;
    if (data.internal_notes !== undefined) patch.internal_notes = data.internal_notes;
    if (Object.keys(patch).length === 0) return { updated: 0 };
    const { error, count } = await supabaseAdmin
      .from("complaints")
      .update(patch, { count: "exact" })
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    return { updated: count ?? 0 };
  });
