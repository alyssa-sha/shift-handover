import type { UserRole } from "@/lib/types/database";

/** The only two roles in scope (requirement.md section 2). */
export const USER_ROLES = ["operator", "supervisor"] as const;

/**
 * Narrow untrusted input - a form field, or the `role` claim in Supabase
 * sign-up metadata - to a real role. Returns null rather than guessing, so a
 * caller has to decide what an unknown value means.
 */
export function parseUserRole(value: unknown): UserRole | null {
  if (typeof value !== "string") return null;
  const normalised = value.trim().toLowerCase();
  return (USER_ROLES as readonly string[]).includes(normalised)
    ? (normalised as UserRole)
    : null;
}

/** Human-readable role name for the header and the register form. */
export function roleLabel(role: UserRole): string {
  return role === "supervisor" ? "Supervisor" : "Operator";
}
