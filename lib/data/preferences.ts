import "server-only";

import { DataAccessError, MissingProfileError } from "@/lib/data/errors";
import { getCurrentUserProfile } from "@/lib/data/profiles";
import { toPreferences, toPreferencesUpsert } from "@/lib/mappers/preferences";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PreferenceWeights, Preferences } from "@/types/profile";

/**
 * Preference reads and writes.
 *
 * Preferences hang off a profile, and the profile is always resolved from the
 * authenticated session first. That means the `profile_id` written here can
 * only ever be the caller's own — there is no code path that accepts one from
 * the client. RLS enforces the same rule independently.
 */

/** The signed-in user's saved weights, or null if they have not set any. */
export async function getCurrentUserPreferences(): Promise<Preferences | null> {
  const profile = await getCurrentUserProfile();

  if (!profile) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("preferences")
    .select("*")
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (error) {
    throw new DataAccessError("Could not load your preferences.", {
      cause: error,
    });
  }

  return data ? toPreferences(data) : null;
}

/**
 * Saves the signed-in user's weights, creating the row on first save.
 *
 * Keyed on the `profile_id` unique constraint so repeated saves update in
 * place instead of accumulating rows.
 */
export async function upsertCurrentUserPreferences(
  weights: PreferenceWeights,
): Promise<Preferences> {
  const profile = await getCurrentUserProfile();

  if (!profile) {
    throw new MissingProfileError();
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("preferences")
    .upsert(toPreferencesUpsert(weights, profile.id), {
      onConflict: "profile_id",
    })
    .select("*")
    .single();

  if (error) {
    throw new DataAccessError("Could not save your preferences.", {
      cause: error,
    });
  }

  return toPreferences(data);
}

/** Completion state used to drive onboarding progression. */
export interface OnboardingStatus {
  hasProfile: boolean;
  hasPreferences: boolean;
}

/** Resolves both onboarding steps in one place. */
export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const preferences = await getCurrentUserPreferences();

  if (preferences) {
    return { hasProfile: true, hasPreferences: true };
  }

  const profile = await getCurrentUserProfile();

  return { hasProfile: profile !== null, hasPreferences: false };
}
