import "server-only";

import { requireUser } from "@/lib/auth/session";
import { getCurrentUserCareerTarget } from "@/lib/data/career-targets";
import { loadCandidateCities } from "@/lib/data/cities";
import { MissingProfileError } from "@/lib/data/errors";
import {
  loadBedroomRentsForScoring,
  loadOccupationStatsForScoring,
} from "@/lib/data/opportunity";
import {
  loadLifestyleStatsForScoring,
  loadSafetyStatsForScoring,
  loadSchoolStatsForScoring,
} from "@/lib/data/place-intelligence";
import { getCurrentUserPreferences } from "@/lib/data/preferences";
import { getCurrentUserProfile } from "@/lib/data/profiles";
import { persistRecommendations } from "@/lib/data/recommendations";
import { generateMatches, type MatchingOptions } from "@/lib/matching/ranking";
import type { CandidateCity, MatchingResult } from "@/lib/matching/types";

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

  // The occupation is read from the user's own confirmed career target, not
  // from anything the caller passed, so one user's ranking can never be scored
  // against another's occupation. No target means no occupational data is
  // loaded at all, and career fit falls back to the metro-wide labour market.
  const careerTarget = await getCurrentUserCareerTarget();

  const [
    occupationStats,
    bedroomRents,
    safetyStats,
    schoolStats,
    lifestyleStats,
  ] = await Promise.all([
    careerTarget
      ? loadOccupationStatsForScoring(careerTarget.socCode)
      : Promise.resolve(null),
    loadBedroomRentsForScoring(),
    loadSafetyStatsForScoring(),
    loadSchoolStatsForScoring(),
    loadLifestyleStatsForScoring(),
  ]);

  const enriched: CandidateCity[] = cities.map((city) => ({
    ...city,
    career: occupationStats?.get(city.id) ?? null,
    bedroomRents: bedroomRents.get(city.id) ?? null,
    // Absent for a metro the FBI published no estimate for. Left null so the
    // scorer records missing data rather than inventing a rate.
    safety: safetyStats.get(city.id) ?? null,
    schools: schoolStats.get(city.id) ?? null,
    lifestyle: lifestyleStats.get(city.id) ?? null,
  }));

  const result = generateMatches(enriched, profile, preferences.weights, {
    ...options,
    // Distinguishes "BLS published too little about your occupation here" from
    // "you have not chosen an occupation" — Career Fit scores those
    // differently and must not guess which one it is looking at.
    occupation: careerTarget
      ? { socCode: careerTarget.socCode, title: careerTarget.title }
      : null,
  });

  // No profile id is passed: the database derives the owner from auth.uid()
  // inside replace_my_recommendations.
  await persistRecommendations(result.recommendations, result.algorithmVersion);

  return result;
}
