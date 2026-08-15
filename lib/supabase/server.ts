import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getClientEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 *
 * Uses the anon key and forwards the request's cookies, so queries run as the
 * signed-in user and Row Level Security applies. A fresh client is created per
 * request — never hoist this to a module-level singleton, since that would
 * share one user's session across requests.
 */
export async function createSupabaseServerClient() {
  // Awaited first, on purpose. Reading cookies marks the route as dynamic, so
  // Next.js stops trying to prerender it at build time. If env validation ran
  // first, a build without credentials would fail while prerendering a page
  // that is inherently per-request anyway.
  const cookieStore = await cookies();

  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } =
    getClientEnv();

  return createServerClient<Database>(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
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
            // Server Components cannot write cookies. This is expected and
            // safe to ignore once session refresh is handled in middleware,
            // which is part of the authentication work package.
          }
        },
      },
    },
  );
}
