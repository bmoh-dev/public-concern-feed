// Generic rate-limiting helper. Backed by public.rl_check_and_consume.
//
// Usage (inside a server function handler):
//   await enforceRateLimit({ action: "complaint:submit:hour", max: 5, windowSeconds: 3600, userId });
//
// To register a new limited action, simply call enforceRateLimit with the
// action name + max + window — no new tables, no new SQL, no per-action code.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getRequest, getRequestHeader } from "@tanstack/react-start/server";

export class RateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type RateLimitInput = {
  /** Stable action name, e.g. "complaint:submit:hour". */
  action: string;
  /** Maximum allowed requests per window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Authenticated user id, if any. Used as subject when present. */
  userId?: string | null;
  /**
   * Subject override. Defaults to `user:<userId>` when userId is set,
   * else a best-effort IP-derived subject `ip:<addr>` from request headers.
   */
  subject?: string;
  /**
   * Units to consume in this call. Defaults to 1 (i.e. count of requests).
   * Pass a byte count for bandwidth-style limits.
   */
  amount?: number;
};

function clientIp(): string | null {
  try {
    const req = getRequest();
    const fwd = getRequestHeader("x-forwarded-for") || req?.headers.get("x-forwarded-for");
    if (fwd) return String(fwd).split(",")[0]?.trim() || null;
    const cf = getRequestHeader("cf-connecting-ip") || req?.headers.get("cf-connecting-ip");
    if (cf) return String(cf);
    const real = getRequestHeader("x-real-ip") || req?.headers.get("x-real-ip");
    if (real) return String(real);
  } catch {
    // outside a request context
  }
  return null;
}

function formatRetryArabic(seconds: number): string {
  if (seconds < 60) return `حاول مجدداً بعد ${seconds} ثانية`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `حاول مجدداً بعد ${minutes} دقيقة`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `حاول مجدداً بعد ${hours} ساعة`;
  const days = Math.ceil(hours / 24);
  return `حاول مجدداً بعد ${days} يوم`;
}

/**
 * Atomically increments the counter for (subject, action) within a fixed
 * window. Throws RateLimitError with a clear Arabic message if exceeded.
 */
export async function enforceRateLimit(input: RateLimitInput): Promise<void> {
  const subject =
    input.subject ??
    (input.userId ? `user:${input.userId}` : `ip:${clientIp() ?? "unknown"}`);

  const { data, error } = await (supabaseAdmin as any).rpc("rl_check_and_consume", {
    p_subject: subject,
    p_action: input.action,
    p_max: input.max,
    p_window_seconds: input.windowSeconds,
    p_user: input.userId ?? null,
    p_amount: input.amount ?? 1,
  });

  if (error) {
    // Fail open on infra error rather than blocking everyone, but log it.
    console.error("[rate-limit] rpc error", { action: input.action, error });
    return;
  }

  const allowed = data?.allowed === true;
  if (!allowed) {
    const retry = Number(data?.retry_after_seconds ?? 60);
    throw new RateLimitError(
      `تم تجاوز الحد المسموح به (${input.max} طلبات). ${formatRetryArabic(retry)}.`,
      retry,
    );
  }
}

/**
 * Format an absolute clock time in `Africa/Algiers` (the platform's primary
 * locale) as `HH:MM`. Used for upload-bandwidth errors that must show the
 * exact time uploads become available again.
 */
function formatLocalHHMM(date: Date): string {
  return new Intl.DateTimeFormat("ar-DZ", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Algiers",
  }).format(date);
}

/**
 * Bandwidth-style rate limit for attachment uploads: 100 MB per user per hour
 * by default. `bytes` is the size that just finished uploading successfully.
 * On limit, throws with a clear Arabic message naming the exact local time
 * when uploads will become available again (e.g. "ابتداءً من 14:35").
 */
export async function enforceUploadBandwidth(input: {
  userId: string;
  bytes: number;
  /** Optional override of the policy (action / max / window). */
  policy?: { action: string; max: number; windowSeconds: number };
}): Promise<void> {
  if (input.bytes <= 0) return;
  const policy = input.policy ?? {
    action: "upload:bytes:hour",
    max: 100 * 1024 * 1024,
    windowSeconds: 60 * 60,
  };
  try {
    await enforceRateLimit({
      ...policy,
      userId: input.userId,
      amount: Math.ceil(input.bytes),
    });
  } catch (e) {
    if (e instanceof RateLimitError) {
      const availableAt = new Date(Date.now() + e.retryAfterSeconds * 1000);
      const hhmm = formatLocalHHMM(availableAt);
      throw new RateLimitError(
        `تم تجاوز الحد المسموح به لحجم الملفات المرفوعة. يمكنك رفع الملفات مرة أخرى ابتداءً من ${hhmm}.`,
        e.retryAfterSeconds,
      );
    }
    throw e;
  }
}

/**
 * Convenience: enforce several limits in order (e.g. per-hour AND per-day).
 * Stops at the first failure.
 */
export async function enforceRateLimits(limits: RateLimitInput[]): Promise<void> {
  for (const l of limits) {
    await enforceRateLimit(l);
  }
}
