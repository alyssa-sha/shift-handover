import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/**
 * Proxy - what earlier Next.js versions called Middleware (Next 16 rename; the
 * file must be `proxy.ts` at the project root and export `proxy`). Runs on the
 * Node.js runtime, which cannot be changed to edge.
 *
 * Refreshes the Supabase session on every matched request (FR-1.4) and sends
 * unauthenticated traffic to /login (FR-1.3). This is an optimistic check for
 * navigation only; RLS is the actual access control (FR-2.4).
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except:
     * - _next/static and _next/image (build output and the image optimizer)
     * - favicon.ico and the files in public/
     * Without this, the redirect above would also intercept CSS, JS and images.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf|txt|xml)$).*)",
  ],
};
