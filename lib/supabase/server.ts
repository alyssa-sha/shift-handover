import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { getSupabaseEnv } from "@/lib/supabase/env";
import type { Database } from "@/lib/types/database";

/**
 * Server client, for Server Components, Server Actions and Route Handlers.
 *
 * `cookies()` is async in Next 16 with no synchronous fallback, so this factory
 * is async too. Create a new client per request; never share one.
 *
 * A Server Component cannot set cookies, so `setAll` may throw there. That is
 * expected and safe to swallow: proxy.ts refreshes the session on every request
 * and writes the refreshed cookies onto the response.
 */
export async function createClient() {
  // `cookies()` first, deliberately. It marks the caller dynamic, so a route
  // that uses this client is never prerendered at build time and `next build`
  // does not need real Supabase credentials to succeed.
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, which may not set cookies.
          // proxy.ts has already refreshed the session for this request.
        }
      },
    },
  });
}
