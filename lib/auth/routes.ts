/**
 * Route protection rules (FR-1.3).
 *
 * Pure functions, no Next.js imports, so proxy.ts stays a thin shell and the
 * interesting decisions are unit-testable. Nothing here is a security control
 * on its own - RLS is (FR-2.4). This only decides where a browser is sent.
 */

/** Landing route after a successful sign-in (FR-4.1). */
export const DEFAULT_SIGNED_IN_PATH = "/";

/** Where unauthenticated traffic goes. */
export const SIGN_IN_PATH = "/login";

/** Query parameter carrying the originally requested path. */
export const NEXT_PARAM = "next";

/**
 * Routes reachable without a session. `/confirm` is where Supabase's
 * confirmation link lands; it must stay public or the emailed link would
 * bounce off the redirect before it could create a session.
 */
export const PUBLIC_PATHS = ["/login", "/register", "/confirm"] as const;

/** Routes a signed-in user has no reason to see. */
const AUTH_ONLY_PATHS = ["/login", "/register"] as const;

function matches(pathname: string, paths: readonly string[]): boolean {
  return paths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function isPublicPath(pathname: string): boolean {
  return matches(pathname, PUBLIC_PATHS);
}

/**
 * Accept a `?next=` value only if it is a path on this site. Anything absolute,
 * protocol-relative (`//evil.example`) or backslash-smuggled (`/\evil`) is
 * discarded in favour of the default landing route, so the login form cannot be
 * turned into an open redirect.
 */
export function safeRedirectTarget(
  next: string | null | undefined,
  fallback: string = DEFAULT_SIGNED_IN_PATH,
): string {
  if (typeof next !== "string" || next.length === 0) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

export type AuthRedirectInput = {
  pathname: string;
  /** Query string including the leading `?`, or an empty string. */
  search?: string;
  isAuthenticated: boolean;
};

/**
 * The path to redirect to, or null to let the request through.
 *
 * - No session on a protected route -> `/login?next=<where they were going>`.
 * - A session on `/login` or `/register` -> the landing route.
 */
export function resolveAuthRedirect({
  pathname,
  search = "",
  isAuthenticated,
}: AuthRedirectInput): string | null {
  if (!isAuthenticated) {
    if (isPublicPath(pathname)) return null;
    const target = `${pathname}${search}`;
    if (target === DEFAULT_SIGNED_IN_PATH) return SIGN_IN_PATH;
    return `${SIGN_IN_PATH}?${NEXT_PARAM}=${encodeURIComponent(target)}`;
  }

  if (matches(pathname, AUTH_ONLY_PATHS)) return DEFAULT_SIGNED_IN_PATH;
  return null;
}
