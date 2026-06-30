// Central registry of rate-limit policies used across the platform.
// Adding a new limit is a one-line change here; no DB migration required.
//
// Shared (client + server safe): contains only constants.

export type RateLimitPolicy = {
  action: string;
  max: number;
  windowSeconds: number;
};

export const RATE_LIMITS = {
  complaintSubmitHour:   { action: "complaint:submit:hour", max: 5,  windowSeconds: 60 * 60 },
  complaintSubmitDay:    { action: "complaint:submit:day",  max: 20, windowSeconds: 60 * 60 * 24 },
  municipalityCreateDay: { action: "municipality:create:day", max: 3,  windowSeconds: 60 * 60 * 24 },
  municipalityJoinDay:   { action: "municipality:join:day",  max: 20, windowSeconds: 60 * 60 * 24 },
  searchPerMinute:       { action: "search:query:minute",   max: 60, windowSeconds: 60 },
  userSearchPerMinute:   { action: "search:users:minute",   max: 20, windowSeconds: 60 },
  // Total bytes of successfully uploaded attachments per user per hour.
  // `max` is in bytes; we pass byte counts as the amount to consume.
  uploadBandwidthHour:   { action: "upload:bytes:hour", max: 100 * 1024 * 1024, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitPolicy>;
