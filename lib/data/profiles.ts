import "server-only";

import { requireUser } from "@/lib/auth/session";
import { DataAccessError } from "@/lib/data/errors";
import { toProfile, toProfileInsert } from "@/lib/mappers/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile, ProfileInput } from "@/types/profile";

/**
 * Profile reads and writes.
 *
 * Every function derives the owner from the authenticated session. None of
 * them accepts a user ID from the caller, so a browser-supplied `user_id`
 * cannot reach the database.
 *
 * These run as the signed-in user through the normal server client, so RLS —
 * not application code — is the enforcement boundary. The service-role client
 * is deliberately not used anywhere here.
 */

/** The signed-in user's profile, or null if they have not created one. */
export async function getCurrentUserProfile(): Promise<Profile | null> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new DataAccessError("Could not load your profile.", {
      cause: error,
    });
  }

  return data ? toProfile(data) : null;
}

/**
 * Creates the signed-in user's profile, or updates it if one already exists.
 *
 * Uses a single upsert keyed on the `user_id` unique constraint rather than a
 * read-then-write, so concurrent submissions cannot produce two profiles for
 * one user. The database, not this function, guarantees the one-per-user rule.
 */
export async function upsertCurrentUserProfile(
  input: ProfileInput,
): Promise<Profile> {
  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("profiles")
    .upsert(toProfileInsert(input, user.id), { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) {
    throw new DataAccessError("Could not save your profile.", {
      cause: error,
    });
  }

  return toProfile(data);
}
