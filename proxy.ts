import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy-session";

/**
 * Next.js 16 renamed Middleware to Proxy; the file convention is `proxy.ts` at
 * the project root. Its only job here is refreshing the Supabase session.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  /*
   * Run on everything except static assets and image files. Auth cookies need
   * refreshing on document requests, not on every icon fetch.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};
