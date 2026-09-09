import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseEnv } from "@/lib/supabase/env";
import type { Database } from "@/lib/types/database";

/**
 * Browser client, for Client Components only.
 *
 * Never import this from a Server Component - use `lib/supabase/server.ts`
 * there, which reads the session from `await cookies()`.
 */
export function createClient() {
  const { url, anonKey } = getSupabaseEnv();
  return createBrowserClient<Database>(url, anonKey);
}
