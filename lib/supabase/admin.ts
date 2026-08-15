import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getClientEnv, getServerEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Supabase client authenticated with the service-role key.
 *
 * This client **bypasses Row Level Security**. It exists so that trusted
 * server-side work — seeding city reference data, writing recommendations on a
 * user's behalf — can run against tables whose RLS policies intentionally deny
 * user-initiated writes (see `supabase/migrations`).
 *
 * Rules for using it:
 * - Never import this module from a Client Component. `server-only` turns that
 *   into a build error.
 * - Always scope queries by the caller's identity yourself; RLS will not do it
 *   for you here.
 *
 * Session persistence is disabled because this client represents the service,
 * not a user, and must never pick up or write a session cookie.
 */
export function createSupabaseAdminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getClientEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();

  return createClient<Database>(
    NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
