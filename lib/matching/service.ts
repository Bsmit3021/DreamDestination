import "server-only";

import { requireUser } from "@/lib/auth/session";
import { loadCandidateCities } from "@/lib/data/cities";
import { MissingProfileError } from "@/lib/data/errors";
import { getCurrentUserPreferences } from "@/lib/data/preferences";
import { getCurrentUserProfile } from "@/lib/data/profiles";
import { persistRecommendations } from "@/lib/data/recommendations";
import { generateMatches, type MatchingOptions } from "@/lib/matching/ranking";
import type { MatchingResult } from "@/lib/matching/types";

/**
 * Server-side orchestration for generating a user's recommendations.
 *
 * The order matters: identity first, then the user's own saved data, then the
 * shared city universe, then the pure scoring pass, then persistence. Nothing
 * accepts a user or profile id from the caller — both are resolved here from
 * the verified session, so a request cannot ask for someone else's ranking or
 * write results onto someone else's profile.
 */

export class OnboardingIncompleteError extends Error {
  constructor(
    message = "Complete your profile and priorities before generating matches.",
  ) {
    super(message);
    this.name = "OnboardingIncompleteError";
  }
}

export class NoCityDataError extends Error {
  constructor(
    message = "No city data has been loaded yet. Run the data pipeline first.",
  ) {
    super(message);
    this.name = "NoCityDataError";
  }
}

/**
 * Scores the city universe for the signed-in user and stores the result.
 *
 * @throws {NotAuthenticatedError} when there is no verified session
 * @throws {OnboardingIncompleteError} when profile or preferences are missing
 * @throws {NoCityDataError} when the city universe is empty
 */
export async function generateRecommendationsForCurrentUser(
  options: MatchingOptions = {},
): Promise<MatchingResult> {
  // Establishes that there *is* a user before any data is touched.
  await requireUser();

  const profile = await getCurrentUserProfile();
  if (!profile) {
    throw new MissingProfileError();
  }

  const preferences = await getCurrentUserPreferences();
  if (!preferences) {
    throw new OnboardingIncompleteError();
  }

  const cities = await loadCandidateCities();
  if (cities.length === 0) {
    throw new NoCityDataError();
  }

  const result = generateMatches(cities, profile, preferences.weights, options);

  // profile.id came from the session-scoped read above, never from input.
  await persistRecommendations(
    profile.id,
    result.recommendations,
    result.algorithmVersion,
  );

  return result;
}
