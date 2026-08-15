"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getClientEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Supabase client for the browser.
 *
 * Authenticated by the anon key, so every query is subject to Row Level
 * Security. The `"use client"` directive above is load-bearing: it makes an
 * accidental import from a Server Component a build-time error rather than a
 * subtle runtime failure.
 *
 * Call this inside a component or event handler rather than at module scope so
 * the client is created in the browser, where cookies are readable.
 */
export function createSupabaseBrowserClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } =
    getClientEnv();

  return createBrowserClient<Database>(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
