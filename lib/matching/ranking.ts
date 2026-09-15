import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import { climateAffectsScoring } from "@/lib/matching/climate";
import { UNSCORED_DIMENSIONS } from "@/lib/matching/dimensions";
import { buildReasons, buildTradeoffs } from "@/lib/matching/explanations";
import {
  MINIMUM_DATA_COVERAGE,
  applyHardFilters,
} from "@/lib/matching/filters";
import { scoreCities } from "@/lib/matching/scoring";
import { RECOMMENDATION_SNAPSHOT_SIZE } from "@/lib/matching/snapshot";
import { normalizeWeights } from "@/lib/matching/weights";
import type { OccupationTarget } from "@/lib/matching/career";
import type {
  CandidateCity,
  ExcludedCity,
  MatchingResult,
  Personalization,
} from "@/lib/matching/types";
import type {
  PreferenceWeightKey,
  PreferenceWeights,
  Profile,
} from "@/types/profile";

/**
 * The end-to-end matching pipeline, as one pure function.
 *
 *   hard filters → normalise metrics → weight → score → coverage gate → rank
 *
 * Kept free of I/O so it can be exercised directly in tests with synthetic
 * cities and known-good arithmetic. The service layer does the loading and
 * saving around it.
 */

/**
 * Bumped when the scoring model changes in a way that alters results.
 *
 * v2:   career fit scored for the user's own occupation, housing scored on the
 *       rent for the home size they asked for, climate scored against the
 *       climate they asked for.
 * v2.1: safety and family become measurable. Both were always selectable
 *       priorities whose weight was redistributed away for lack of a metric;
 *       that weight now lands where the user put it, which changes rankings
 *       for anyone who weighted either.
 * v2.2: social becomes measurable from Overture place counts, and optional
 *       lifestyle preferences make it personal. The last dimension that could
 *       never be scored now can be, so social weight is no longer
 *       redistributed away either.
 *
 * A minor bump rather than v3 because no existing dimension's definition
 * changed — two previously unscored ones were filled in. Stored on every row,
 * so results from different versions are never silently compared. Old
 * snapshots keep their own version string and stay readable.
 */
export const MATCHING_ALGORITHM_VERSION = "v2.2";

/**
 * How many ranked cities are returned and stored: the best matches plus the
 * alternatives, from one scoring run (see lib/matching/snapshot.ts).
 *
 * Not part of the scoring model: the limit is applied after ranking, so
 * changing it shows more or fewer rows of the same ordering and never alters
 * any city's score, rank or tie-break. It therefore does not bump
 * MATCHING_ALGORITHM_VERSION.
 */
export const DEFAULT_RECOMMENDATION_LIMIT = RECOMMENDATION_SNAPSHOT_SIZE;

export interface MatchingOptions {
  /** How many recommendations to return. */
  limit?: number;
  /** Minimum share of user weight that must be measurable. */
  minimumCoverage?: number;
  /**
   * The user's confirmed occupation, when they have one.
   *
   * User data rather than a tuning knob, and it sits here only because it does
   * not live on `Profile`: the confirmed SOC code comes from the separate
   * career-target record, which the caller has already resolved. Omitting it
   * means "no occupation was chosen", which Career Fit treats as an answer
   * rather than as absent evidence.
   */
  occupation?: OccupationTarget | null;
}

/**
 * Ranks candidate cities for one user.
 *
 * Ordering is fully deterministic. Ties break on data coverage first — between
 * two equal scores, prefer the one supported by more of what the user cares
 * about — and then on the city's stable id, so the same inputs always produce
 * the same order regardless of the order rows arrived from the database.
 */
export function generateMatches(
  cities: readonly CandidateCity[],
  profile: Profile,
  weights: PreferenceWeights,
  options: MatchingOptions = {},
): MatchingResult {
  const limit = options.limit ?? DEFAULT_RECOMMENDATION_LIMIT;
  const minimumCoverage = options.minimumCoverage ?? MINIMUM_DATA_COVERAGE;

  const excluded: ExcludedCity[] = [];
  const eligible: CandidateCity[] = [];

  for (const city of cities) {
    const outcome = applyHardFilters(city, profile);

    if (outcome.passed) {
      eligible.push(city);
    } else {
      excluded.push({
        city,
        reason: outcome.reason ?? "budget",
        detail: outcome.detail ?? "Excluded by a hard filter.",
      });
    }
  }

  const personalization: Personalization = {
    desiredBedrooms: profile.desiredBedrooms,
    climatePreference: profile.climatePreference,
    housingBudget: profile.housingBudget,
    occupation: options.occupation ?? null,
    lifestylePreferences: profile.lifestylePreferences,
  };

  /**
   * A waived dimension is one the user told us not to care about.
   *
   * Climate is the only one today: "no preference" — and a legacy profile that
   * was never asked — means no metro should gain or lose for its weather. The
   * correct arithmetic is to take the dimension's weight out before
   * normalisation, so it redistributes proportionally across the priorities the
   * user does hold. The alternatives are all worse: scoring every metro 50
   * invents a measurement, and treating it as *missing* data would count
   * against coverage and could drop metros below the coverage floor for a
   * user who simply does not care about the weather.
   */
  const waived: PreferenceWeightKey[] = [];
  const effectiveWeights = { ...weights };

  if (!climateAffectsScoring(profile.climatePreference)) {
    if (effectiveWeights.climate > 0) waived.push("climate");
    effectiveWeights.climate = 0;
  }

  const normalized = normalizeWeights(effectiveWeights);

  // Scored together: a percentile only means something relative to the rest of
  // the eligible set.
  const scored = scoreCities(eligible, normalized, personalization);

  const ranked = scored
    .filter((score) => {
      if (score.dataCoverage >= minimumCoverage) {
        return true;
      }

      excluded.push({
        city: score.city,
        reason: "insufficient_data",
        detail:
          `Only ${Math.round(score.dataCoverage * 100)}% of your priorities ` +
          `can be measured here, below the ${Math.round(minimumCoverage * 100)}% minimum.`,
      });
      return false;
    })
    .sort(
      (a, b) =>
        b.totalScore - a.totalScore ||
        b.dataCoverage - a.dataCoverage ||
        a.city.id.localeCompare(b.city.id),
    )
    .slice(0, limit)
    .map((score, index) => ({
      ...score,
      rank: index + 1,
      reasons: buildReasons(score),
      tradeoffs: buildTradeoffs(score),
    }));

  const unscoredWeightedDimensions: PreferenceWeightKey[] =
    PREFERENCE_WEIGHT_KEYS.filter(
      (key) => normalized[key] > 0 && UNSCORED_DIMENSIONS.includes(key),
    );

  return {
    recommendations: ranked,
    excluded,
    algorithmVersion: MATCHING_ALGORITHM_VERSION,
    unscoredWeightedDimensions,
    dimensionsWaivedByUser: waived,
  };
}
