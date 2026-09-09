/**
 * Supabase connection settings, read lazily.
 *
 * Read at call time rather than at module scope so that `next build` does not
 * need real credentials: nothing here runs until a client is actually created
 * during a request. Only the anon/publishable key is ever used - there is no
 * service-role key in this project (requirement.md section 9.2).
 */

export type SupabaseEnv = {
  url: string;
  anonKey: string;
};

export function getSupabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase configuration. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  return { url, anonKey };
}
