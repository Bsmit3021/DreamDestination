import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import { DIMENSIONS } from "@/lib/matching/dimensions";
import {
  percentileScore,
  targetDistanceScore,
  winsorizedMinMaxScore,
} from "@/lib/matching/normalization";
import {
  effectiveWeightsFor,
  type NormalizedWeights,
} from "@/lib/matching/weights";
import type {
  CandidateCity,
  CityScore,
  DimensionScore,
} from "@/lib/matching/types";
import type { PreferenceWeightKey } from "@/types/profile";

/**
 * The weighted-sum scorer.
 *
 *   totalScore = Σ (normalizedScore[d] × effectiveWeight[d])
 *
 * with normalizedScore on 0-100 and the effective weights summing to 1, so the
 * total lands on 0-100 too. Pure: no I/O, no clock, no randomness.
 *
 * Normalisation is relative to the candidate set, so scoring is done for the
 * whole set at once rather than city by city — a percentile is meaningless
 * without the other candidates to rank against.
 */

/** Raw values for one dimension across the candidate set, used for ranking. */
type Populations = Partial<Record<PreferenceWeightKey, number[]>>;

function collectPopulations(cities: readonly CandidateCity[]): Populations {
  const populations: Populations = {};

  for (const key of PREFERENCE_WEIGHT_KEYS) {
    const values: number[] = [];

    for (const city of cities) {
      const observation = city.observations[key];
      if (observation && Number.isFinite(observation.rawValue)) {
        values.push(observation.rawValue);
      }
    }

    if (values.length > 0) {
      populations[key] = values;
    }
  }

  return populations;
}

/** Maps one raw value onto 0-100 using that dimension's declared method. */
function normalizeObservation(
  dimension: PreferenceWeightKey,
  rawValue: number,
  population: readonly number[],
): number {
  const metric = DIMENSIONS[dimension].metric;

  if (!metric) {
    throw new Error(
      `Dimension "${dimension}" has no metric definition but an observation was supplied`,
    );
  }

  switch (metric.normalization) {
    case "percentile":
      if (metric.direction === "target_is_better") {
        throw new Error(
          `Dimension "${dimension}" cannot use percentile with a target direction`,
        );
      }
      return percentileScore(rawValue, population, metric.direction);

    case "winsorized_min_max":
      if (metric.direction === "target_is_better") {
        throw new Error(
          `Dimension "${dimension}" cannot use winsorised min-max with a target direction`,
        );
      }
      return winsorizedMinMaxScore(rawValue, population, metric.direction);

    case "target_distance": {
      if (!metric.target) {
        throw new Error(
          `Dimension "${dimension}" uses target_distance but declares no target`,
        );
      }
      return targetDistanceScore(
        rawValue,
        metric.target.value,
        metric.target.tolerance,
      );
    }
  }
}

function emptyDimensionScore(dimension: PreferenceWeightKey): DimensionScore {
  return {
    dimension,
    available: false,
    rawValue: null,
    unit: null,
    normalizedScore: null,
    effectiveWeight: 0,
    contribution: 0,
    source: null,
  };
}

/**
 * Scores every candidate against one user's weights.
 *
 * @param cities candidate set; normalisation is relative to exactly this set
 * @param normalized user weights already rescaled to sum to 1
 */
export function scoreCities(
  cities: readonly CandidateCity[],
  normalized: NormalizedWeights,
): CityScore[] {
  const populations = collectPopulations(cities);

  return cities.map((city) => {
    const available = new Set<PreferenceWeightKey>();

    for (const key of PREFERENCE_WEIGHT_KEYS) {
      const observation = city.observations[key];
      if (
        observation &&
        Number.isFinite(observation.rawValue) &&
        populations[key]
      ) {
        available.add(key);
      }
    }

    const effective = effectiveWeightsFor(normalized, available);

    const dimensions = Object.fromEntries(
      PREFERENCE_WEIGHT_KEYS.map((key) => [key, emptyDimensionScore(key)]),
    ) as Record<PreferenceWeightKey, DimensionScore>;

    let totalScore = 0;

    for (const key of PREFERENCE_WEIGHT_KEYS) {
      const observation = city.observations[key];
      const population = populations[key];

      if (!available.has(key) || !observation || !population) {
        continue;
      }

      const normalizedScore = normalizeObservation(
        key,
        observation.rawValue,
        population,
      );
      const effectiveWeight = effective.weights[key];
      const contribution = normalizedScore * effectiveWeight;

      dimensions[key] = {
        dimension: key,
        available: true,
        rawValue: observation.rawValue,
        unit: observation.unit,
        normalizedScore,
        effectiveWeight,
        contribution,
        source: observation.source,
      };

      totalScore += contribution;
    }

    const weightedKeys = PREFERENCE_WEIGHT_KEYS.filter(
      (key) => normalized[key] > 0,
    );

    // Counted against what the user actually weighted. A dimension that has
    // data but carries zero weight is irrelevant to this user, and including
    // it would overstate how much of their input we could act on.
    const dimensionsCovered = weightedKeys.filter((key) =>
      available.has(key),
    ).length;

    return {
      city,
      totalScore,
      dataCoverage: effective.coverage,
      dimensionsCovered,
      dimensionsWeighted: weightedKeys.length,
      dimensions,
    };
  });
}

/**
 * The number shown to a user.
 *
 * Rounded to a whole number on purpose. The inputs are survey estimates with
 * their own margins of error, so presenting "87.392" would imply a precision
 * the underlying data cannot support. Full precision is kept internally for
 * ordering and for the dimension breakdown.
 */
export function displayScore(totalScore: number): number {
  return Math.round(totalScore);
}
