// Server-only authorization helpers.
// Centralizes role + municipality scoping so routes can't accidentally widen access.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const admin: any = supabaseAdmin;

export type MuniRole = "admin" | "super_admin";

/** Generic safe error — never leak DB/internal details to the client. */
export class AuthzError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "AuthzError";
  }
}

export async function isGlobalAdmin(userId: string): Promise<boolean> {
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "global_admin")
    .maybeSingle();
  return !!data;
}

/**
 * Returns the list of municipality IDs the user administrates (admin / super_admin
 * via municipality_members on a VERIFIED municipality). Does NOT include
 * global_admin: platform role does not grant municipality data access.
 */
export async function getAdminMunicipalityIds(userId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("municipality_members")
    .select("municipality_id, role, municipalities:municipality_id(status)")
    .eq("user_id", userId)
    .in("role", ["admin", "super_admin"]);
  if (error) return [];
  return (data ?? [])
    .filter((r: any) => r.municipalities?.status === "verified")
    .map((r: any) => r.municipality_id as string);
}

/** Throws if the user doesn't administer at least one municipality. */
export async function requireMunicipalityAdmin(userId: string): Promise<string[]> {
  const ids = await getAdminMunicipalityIds(userId);
  if (ids.length === 0) throw new AuthzError();
  return ids;
}

/** Throws unless the user administers the specified municipality. */
export async function requireMunicipalityAdminFor(
  userId: string,
  municipalityId: string,
): Promise<void> {
  const ids = await getAdminMunicipalityIds(userId);
  if (!ids.includes(municipalityId)) throw new AuthzError();
}

/** Department admin's department id, scoped by their municipality. */
export async function getMyDepartmentInfo(
  userId: string,
): Promise<{ department_id: string; municipality_id: string } | null> {
  const { data } = await admin
    .from("department_admins")
    .select("department_id, departments:department_id(municipality_id)")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return {
    department_id: data.department_id,
    municipality_id: (data as any).departments?.municipality_id ?? null,
  };
}

/**
 * Escape a user-supplied search term for safe inclusion inside a PostgREST
 * `.or()` filter string. PostgREST splits filters on `,` and treats `()` as
 * group syntax — unescaped input there is a query-logic injection vector.
 * We strip those plus `*` (LIKE wildcard control char) and the percent sign.
 */
export function sanitizeSearchTerm(input: string): string {
  return input.replace(/[,()*\\%"']/g, " ").trim();
}
