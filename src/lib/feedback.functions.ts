import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { detectSpam } from "@/lib/spam-detection";
import { enforceRateLimit } from "@/lib/rate-limit.server";
import type { RateLimitPolicy } from "@/lib/rate-limits";

const FEEDBACK_TYPES = ["bug", "suggestion"] as const;
const FEEDBACK_STATUSES = ["open", "fixed"] as const;

const SCREENSHOT_BUCKET = "feedback-screenshots";
const SIGNED_URL_TTL = 3600;

const feedbackSubmitLimit: RateLimitPolicy = {
  action: "feedback:submit:hour",
  max: 10,
  windowSeconds: 60 * 60,
};

async function assertGlobalAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "global_admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: global admin only");
}

/** Submit feedback (any authenticated user). */
export const submitFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        type: z.enum(FEEDBACK_TYPES),
        title: z.string().trim().min(1).max(200),
        description: z.string().trim().min(1).max(4000),
        page: z.string().trim().max(500).optional().nullable(),
        screenshot_path: z.string().trim().max(500).optional().nullable(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    await enforceRateLimit({ ...feedbackSubmitLimit, userId });

    const titleErr = detectSpam(data.title, { minLength: 5 });
    if (titleErr) return { error: `العنوان: ${titleErr}` } as const;
    const descErr = detectSpam(data.description, {
      minLength: 15,
      requireMultipleWords: true,
      minDistinctWords: 3,
    });
    if (descErr) return { error: `الوصف: ${descErr}` } as const;

    // If a screenshot path was provided, ensure it belongs to this user.
    if (data.screenshot_path) {
      const first = data.screenshot_path.split("/")[0];
      if (first !== userId) {
        return { error: "مسار الصورة غير صالح" } as const;
      }
    }

    const { data: row, error } = await (supabase as any)
      .from("feedback")
      .insert({
        user_id: userId,
        type: data.type,
        title: data.title,
        description: data.description,
        page: data.page ?? null,
        screenshot_url: data.screenshot_path ?? null,
        status: "open",
      })
      .select("id")
      .single();
    if (error || !row) {
      return { error: "تعذّر إرسال الملاحظة" } as const;
    }
    return { id: row.id as string };
  });

const listInput = z
  .object({
    status: z.enum([...FEEDBACK_STATUSES, "all"] as const).default("all"),
    type: z.enum([...FEEDBACK_TYPES, "all"] as const).default("all"),
    q: z.string().trim().max(200).optional().default(""),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).default(0),
  })
  .default({});

/** Admin-only: list feedback with filters + search + pagination. */
export const listAllFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => listInput.parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin: any = supabaseAdmin;
    await assertGlobalAdmin(admin, context.userId);

    let q = admin
      .from("feedback")
      .select(
        "id, user_id, type, title, description, page, status, screenshot_url, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.type !== "all") q = q.eq("type", data.type);
    if (data.q) {
      const term = data.q.replace(/[%_]/g, (m) => `\\${m}`);
      q = q.or(
        `title.ilike.%${term}%,description.ilike.%${term}%`,
      );
    }

    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);

    // Attach reporter profile info (email/name).
    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
    let profileMap = new Map<string, { email: string | null; full_name: string | null }>();
    if (userIds.length) {
      const { data: profs } = await admin
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds);
      for (const p of (profs ?? []) as any[]) {
        profileMap.set(p.id, { email: p.email ?? null, full_name: p.full_name ?? null });
      }
    }

    let filtered = (rows ?? []).map((r: any) => ({
      ...r,
      reporter_email: profileMap.get(r.user_id)?.email ?? null,
      reporter_name: profileMap.get(r.user_id)?.full_name ?? null,
    }));

    // Reporter email search is applied post-fetch (small admin dataset).
    if (data.q) {
      const needle = data.q.toLowerCase();
      const rowMatches = (r: any) =>
        (r.title ?? "").toLowerCase().includes(needle) ||
        (r.description ?? "").toLowerCase().includes(needle) ||
        (r.reporter_email ?? "").toLowerCase().includes(needle);
      filtered = filtered.filter(rowMatches);
    }

    return { rows: filtered, total: count ?? filtered.length };
  });

/** Admin-only: single feedback detail with signed screenshot URL. */
export const getFeedbackDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin: any = supabaseAdmin;
    await assertGlobalAdmin(admin, context.userId);

    const { data: row, error } = await admin
      .from("feedback")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("not found");

    let reporter: { email: string | null; full_name: string | null } = {
      email: null,
      full_name: null,
    };
    const { data: prof } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("id", row.user_id)
      .maybeSingle();
    if (prof) reporter = { email: prof.email ?? null, full_name: prof.full_name ?? null };

    let signed_url: string | null = null;
    if (row.screenshot_url) {
      const { data: signed } = await admin.storage
        .from(SCREENSHOT_BUCKET)
        .createSignedUrl(row.screenshot_url, SIGNED_URL_TTL);
      signed_url = signed?.signedUrl ?? null;
    }

    return { ...row, reporter_email: reporter.email, reporter_name: reporter.full_name, signed_url };
  });

/** Admin-only: update status. */
export const updateFeedbackStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(FEEDBACK_STATUSES),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin: any = supabaseAdmin;
    await assertGlobalAdmin(admin, context.userId);
    const { error } = await admin.from("feedback").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin-only: update admin_notes. */
export const updateFeedbackAdminNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        id: z.string().uuid(),
        admin_notes: z.string().max(4000).nullable(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin: any = supabaseAdmin;
    await assertGlobalAdmin(admin, context.userId);
    const { error } = await admin
      .from("feedback")
      .update({ admin_notes: data.admin_notes })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin-only: delete feedback (+ screenshot if any). */
export const deleteFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin: any = supabaseAdmin;
    await assertGlobalAdmin(admin, context.userId);

    const { data: row } = await admin
      .from("feedback")
      .select("screenshot_url")
      .eq("id", data.id)
      .maybeSingle();

    const { error } = await admin.from("feedback").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    if (row?.screenshot_url) {
      await admin.storage.from(SCREENSHOT_BUCKET).remove([row.screenshot_url]);
    }
    return { ok: true };
  });
