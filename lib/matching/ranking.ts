import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import { UNSCORED_DIMENSIONS } from "@/lib/matching/dimensions";
import { buildReasons, buildTradeoffs } from "@/lib/matching/explanations";
import {
  MINIMUM_DATA_COVERAGE,
  applyHardFilters,
} from "@/lib/matching/filters";
import { scoreCities } from "@/lib/matching/scoring";
import { normalizeWeights } from "@/lib/matching/weights";
import type {
  CandidateCity,
  ExcludedCity,
  MatchingResult,
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

/** Bumped when the scoring model changes in a way that alters results. */
export const MATCHING_ALGORITHM_VERSION = "v1";

export const DEFAULT_RECOMMENDATION_LIMIT = 5;

export interface MatchingOptions {
  /** How many recommendations to return. */
  limit?: number;
  /** Minimum share of user weight that must be measurable. */
  minimumCoverage?: number;
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

  const normalized = normalizeWeights(weights);

  // Scored together: a percentile only means something relative to the rest of
  // the eligible set.
  const scored = scoreCities(eligible, normalized);

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
  };
}
