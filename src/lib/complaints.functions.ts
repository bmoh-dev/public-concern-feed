import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  requireMunicipalityAdmin,
  sanitizeSearchTerm,
} from "@/lib/authz.server";
import { getPublicSupabaseClient } from "@/lib/supabase-public.server";
import { enforceRateLimit, enforceRateLimits } from "@/lib/rate-limit.server";
import { RATE_LIMITS } from "@/lib/rate-limits";
import {
  ALLOWED_MIME,
  validateAttachmentSet,
} from "@/lib/upload-validation";

const CategoryEnum = z.enum(["infrastructure", "public_lighting", "cleanliness", "other"]);
const StatusEnum = z.enum(["pending", "in_progress", "resolved"]);

const SIGNED_URL_TTL = 3600; // 1 hour

export async function signAttachments<T extends { storage_path: string }>(
  attachments: T[] | null | undefined,
): Promise<(T & { signed_url: string | null })[]> {
  if (!attachments?.length) return [];
  const paths = attachments.map((a) => a.storage_path);
  const { data } = await (supabaseAdmin as any).storage
    .from("complaint-attachments")
    .createSignedUrls(paths, SIGNED_URL_TTL);
  const urlByPath = new Map<string, string>();
  for (const s of (data ?? []) as Array<{ path: string; signedUrl: string }>) {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  }
  return attachments.map((a) => ({ ...a, signed_url: urlByPath.get(a.storage_path) ?? null }));
}

async function withSignedAttachments<R extends { attachments?: any[] | null }>(
  rows: R[],
): Promise<R[]> {
  return Promise.all(
    rows.map(async (r) => ({ ...r, attachments: await signAttachments(r.attachments ?? []) })),
  );
}


export const submitComplaint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        municipality_id: z.string().uuid(),
        title: z.string().min(3).max(200),
        category: CategoryEnum,
        address: z.string().min(3).max(500),
        description: z.string().min(5).max(5000),
        latitude: z.number().min(-90).max(90).nullable().optional(),
        longitude: z.number().min(-180).max(180).nullable().optional(),
        attachments: z
          .array(
            z.object({
              storage_path: z.string().min(1).max(500),
              file_name: z.string().min(1).max(255),
              mime_type: z
                .string()
                .min(1)
                .max(120)
                .refine((m) => (ALLOWED_MIME as readonly string[]).includes(m), {
                  message: "نوع الملف غير مسموح به",
                }),
              size_bytes: z
                .number()
                .int()
                .min(1)
                .max(10 * 1024 * 1024),
            }),
          )
          .max(6)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const admin: any = supabaseAdmin;

    // Rate limits: 5 / hour and 20 / day per user.
    await enforceRateLimits([
      { ...RATE_LIMITS.complaintSubmitHour, userId },
      { ...RATE_LIMITS.complaintSubmitDay, userId },
    ]);

    // Server-side attachment shape validation (mime / size / counts).
    if (data.attachments?.length) {
      const err = validateAttachmentSet(data.attachments);
      if (err) throw new Error(err);
    }

    // Backend enforcement: verified municipality + membership
    const { data: m } = await admin
      .from("municipalities")
      .select("id, status")
      .eq("id", data.municipality_id)
      .maybeSingle();
    if (!m || m.status !== "verified") throw new Error("بلدية غير موثّقة");
    const { data: mem } = await admin
      .from("municipality_members")
      .select("user_id")
      .eq("municipality_id", data.municipality_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!mem) throw new Error("لست عضواً في هذه البلدية");

    const { data: complaint, error } = await (supabase as any)
      .from("complaints")
      .insert({
        user_id: userId,
        municipality_id: data.municipality_id,
        title: data.title,
        category: data.category,
        address: data.address,
        description: data.description,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
      })
      .select("id")
      .single();
    if (error || !complaint) {
      console.error("[submitComplaint] insert error", error);
      throw new Error(error?.message || "Failed to submit complaint");
    }

    if (data.attachments?.length) {
      const rows = data.attachments.map((a) => ({ complaint_id: complaint.id, ...a }));
      const { error: aErr } = await supabase.from("attachments").insert(rows);
      if (aErr) {
        console.error("[submitComplaint] attachments insert error", aErr);
        throw new Error(aErr.message);
      }
    }
    return { id: complaint.id };
  });

export const listMyComplaints = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("complaints")
      .select(
        "id, complaint_number, title, category, status, address, latitude, longitude, description, created_at, updated_at, attachments(id, storage_path, file_name, mime_type)",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return withSignedAttachments(data ?? []);
  });


export const getMyComplaint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("complaints")
      .select(
        "id, complaint_number, title, category, status, address, description, created_at, updated_at, user_id, attachments(id, storage_path, file_name, mime_type)",
      )

      .eq("id", data.id)
      .single();
    if (error || !row) throw new Error("Not found");
    if (row.user_id !== userId) throw new Error("Forbidden");
    return { ...row, attachments: await signAttachments(row.attachments ?? []) };
  });

// PUBLIC feed — anon-safe, requires a verified municipality_id
export const listPublicComplaints = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        municipality_id: z.string().uuid(),
        category: CategoryEnum.nullable().optional(),
        search: z.string().max(200).nullable().optional(),
        limit: z.number().int().min(1).max(50).default(12),
        offset: z.number().int().min(0).max(10000).default(0),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    // Use publishable client + RLS. The public-feed RLS policies and the
    // verified-municipality filter together gate what anon can read.
    const pub: any = getPublicSupabaseClient();
    const { data: m } = await pub
      .from("municipalities")
      .select("status")
      .eq("id", data.municipality_id)
      .maybeSingle();
    if (!m || m.status !== "verified") return [];

    let q = pub
      .from("complaints")
      .select(
        "id, complaint_number, title, category, status, address, latitude, longitude, description, created_at, attachments(id, storage_path, file_name, mime_type)",
      )
      .eq("municipality_id", data.municipality_id)
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (data.category) q = q.eq("category", data.category);
    if (data.search) {
      // Per-IP search rate limit for the anonymous public feed.
      await enforceRateLimit({ ...RATE_LIMITS.searchPerMinute });
      const s = sanitizeSearchTerm(data.search);
      if (s) q = q.ilike("title", `%${s}%`);
    }
    const { data: rows, error } = await q;
    if (error) {
      console.error("[listPublicComplaints]", error);
      return [];
    }
    return withSignedAttachments(rows ?? []);
  });


// ADMIN — municipality-scoped. Global admin is platform-only and does NOT
// have municipality data access here.
async function assertMunicipalityAdmin(userId: string): Promise<string[]> {
  return requireMunicipalityAdmin(userId);
}

export const adminListComplaints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        search: z.string().max(200).nullable().optional(),
        status: StatusEnum.nullable().optional(),
        category: CategoryEnum.nullable().optional(),
        from: z.string().nullable().optional(),
        to: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const muniIds = await assertMunicipalityAdmin(context.userId);
    if (data.search) {
      await enforceRateLimit({ ...RATE_LIMITS.searchPerMinute, userId: context.userId });
    }
    let q = supabaseAdmin
      .from("complaints")
      .select(
        "id, complaint_number, title, category, status, address, description, internal_notes, created_at, user_id, municipality_id, attachments(id, storage_path, file_name, mime_type)",
      )
      .in("municipality_id", muniIds)
      .order("created_at", { ascending: false });
    if (data.status) q = q.eq("status", data.status);
    if (data.category) q = q.eq("category", data.category);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
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
      console.error("[adminListComplaints]", error);
      throw new Error("تعذّر تحميل الشكاوى");
    }
    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    let profilesMap = new Map<string, { full_name: string | null; email: string | null }>();
    if (userIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      profilesMap = new Map(
        (profs ?? []).map((p) => [p.id, { full_name: p.full_name, email: p.email }]),
      );
    }
    const enriched = await withSignedAttachments(rows ?? []);
    return enriched.map((r) => ({ ...r, profiles: profilesMap.get(r.user_id) ?? null }));
  });

export const adminMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const muniIds = await assertMunicipalityAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("complaints")
      .select("status")
      .in("municipality_id", muniIds);
    if (error) {
      console.error("[adminMetrics]", error);
      throw new Error("تعذّر تحميل الإحصائيات");
    }
    const total = data.length;
    const pending = data.filter((r) => r.status === "pending").length;
    const in_progress = data.filter((r) => r.status === "in_progress").length;
    const resolved = data.filter((r) => r.status === "resolved").length;
    return { total, pending, in_progress, resolved };
  });

export const adminUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(200),
        status: StatusEnum.optional(),
        internal_notes: z.string().max(5000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const muniIds = await assertMunicipalityAdmin(context.userId);
    const patch: { status?: "pending" | "in_progress" | "resolved"; internal_notes?: string } = {};
    if (data.status) patch.status = data.status;
    if (data.internal_notes !== undefined) patch.internal_notes = data.internal_notes;
    if (Object.keys(patch).length === 0) return { updated: 0 };
    // Scope: only update complaints whose municipality the caller administers.
    const { error, count } = await supabaseAdmin
      .from("complaints")
      .update(patch, { count: "exact" })
      .in("id", data.ids)
      .in("municipality_id", muniIds);
    if (error) {
      console.error("[adminUpdate]", error);
      throw new Error("تعذّر تحديث الشكاوى");
    }
    return { updated: count ?? 0 };
  });
