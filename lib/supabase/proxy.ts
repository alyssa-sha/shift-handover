import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { resolveAuthRedirect } from "@/lib/auth/routes";
import { getSupabaseEnv } from "@/lib/supabase/env";
import type { Database } from "@/lib/types/database";

/**
 * Session refresh helper used by the root `proxy.ts` (FR-1.4).
 *
 * Two jobs, in this order:
 *   1. Refresh the Supabase session and write any rotated auth cookies onto the
 *      outgoing response, so every Server Component downstream sees a valid
 *      session.
 *   2. Redirect unauthenticated traffic to /login (FR-1.3).
 *
 * `supabase.auth.getUser()` is what performs the refresh, and it must be called
 * on every request - dropping it is the usual cause of random sign-outs.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Responses that set auth cookies must not be cached.
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirectTo = resolveAuthRedirect({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    isAuthenticated: Boolean(user),
  });

  if (redirectTo) {
    const redirect = NextResponse.redirect(new URL(redirectTo, request.url));
    // Carry the refreshed cookies over, or the redirect would discard them.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    // ...and the no-cache headers @supabase/ssr asks for alongside them.
    // Copied by name rather than wholesale: `response.headers` also carries
    // Set-Cookie, which `redirect.cookies.set` has already handled.
    for (const key of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(key);
      if (value !== null) redirect.headers.set(key, value);
    }
    return redirect;
  }

  return response;
}
