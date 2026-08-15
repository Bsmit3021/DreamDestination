import "server-only";

import type { User } from "@supabase/supabase-js";

import { NotAuthenticatedError } from "@/lib/data/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Authenticated identity, resolved server-side.
 *
 * Everything that needs to know "who is this?" goes through here, so user IDs
 * always originate from a verified session and never from form input.
 */

/**
 * The signed-in user, or null.
 *
 * Uses `getUser()`, which verifies the token with Supabase Auth. `getSession()`
 * would merely decode the cookie, which a client can forge.
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

/** The signed-in user, or throws. Use in mutations. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();

  if (!user) {
    throw new NotAuthenticatedError();
  }

  return user;
}
