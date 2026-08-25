import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import {
  scoreCareerFit,
  usesGeneralLaborMarket,
  type CareerScore,
} from "@/lib/matching/career";
import { scoreClimate } from "@/lib/matching/climate";
import { scoreFamilyFit, type FamilyInputs } from "@/lib/matching/family";
import { scoreLifestyleFit } from "@/lib/matching/lifestyle";
import { scoreSafetyFit } from "@/lib/matching/safety";
import { DIMENSIONS } from "@/lib/matching/dimensions";
import {
  resolveHousingBenchmark,
  scoreHousing,
  type HousingBenchmark,
} from "@/lib/matching/housing";
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
  DimensionDetail,
  DimensionScore,
  Personalization,
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
 *
 * Three dimensions are personalised, and each one asks the user's own answer
 * rather than a developer's assumption:
 *
 *   career    the user's confirmed occupation (lib/matching/career.ts)
 *   housing   the home size they want, and their budget (housing.ts)
 *   climate   the climate they asked for (climate.ts)
 *
 * The personalisation happens strictly *inside* a dimension. It changes what
 * "a good career score" means; it never changes how much career matters, which
 * remains the user's own slider.
 */

/** The user-side inputs a scoring run needs, when the caller has none. */
export const NO_PERSONALIZATION: Personalization = {
  desiredBedrooms: null,
  climatePreference: null,
  housingBudget: null,
  occupation: null,
  lifestylePreferences: null,
};

/**
 * Dimensions a composite scorer owns; the generic observation path skips them.
 *
 * Career, housing and climate depend on the user's own answers. Safety and
 * family do not — they are identical for every user — but both still combine
 * several measurements inside one dimension, which the single-observation path
 * cannot express.
 */
const COMPOSITE_DIMENSIONS = new Set<PreferenceWeightKey>([
  "career",
  "housing",
  "climate",
  "safety",
  "family",
  "social",
]);

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

/** Raw values for one dimension across the set, for a one-off normalisation. */
function populationFor(
  cities: readonly CandidateCity[],
  dimension: PreferenceWeightKey,
): number[] {
  const values: number[] = [];
  for (const city of cities) {
    const observation = city.observations[dimension];
    if (observation && Number.isFinite(observation.rawValue)) {
      values.push(observation.rawValue);
    }
  }
  return values;
}

/**
 * One city's 0-100 score for a dimension scored from a single observation.
 *
 * Used by Family Fit to borrow the commute and healthcare normalisations
 * rather than restate them, so a change to either definition moves both the
 * standalone dimension and the family component together.
 */
function observationScore(
  city: CandidateCity,
  dimension: PreferenceWeightKey,
  population: readonly number[],
): number | null {
  const observation = city.observations[dimension];
  if (!observation || !Number.isFinite(observation.rawValue)) return null;
  if (population.length === 0) return null;
  return normalizeObservation(dimension, observation.rawValue, population);
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

    case "composite":
    case "personalized_composite":
    case "preference_band":
      // These are computed per user, not from a single shared observation.
      // Reaching here means a dimension was routed down the generic path by
      // mistake, which must fail loudly rather than silently score something.
      throw new Error(
        `Dimension "${dimension}" is personalised and must not be normalised generically`,
      );
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
    detail: null,
  };
}

/** One personalised dimension's result for one city, before weighting. */
interface PersonalizedScore {
  normalizedScore: number;
  rawValue: number;
  unit: string;
  detail: DimensionDetail;
}

/**
 * The raw figure quoted for a career score, chosen to match the evidence used.
 *
 * A general-basis score quotes the unemployment rate, because that is all it
 * used. An occupation-specific score quotes the strongest occupational figure
 * it has, so the number a user sees is one that actually moved their score.
 */
function careerRawValue(career: CareerScore): { value: number; unit: string } {
  const { detail } = career;

  if (usesGeneralLaborMarket(detail.basis)) {
    return { value: detail.unemploymentRate ?? 0, unit: "percent" };
  }
  if (detail.medianAnnualWage !== null) {
    return { value: detail.medianAnnualWage, unit: "usd_per_year" };
  }
  if (detail.employmentPer1000 !== null) {
    return { value: detail.employmentPer1000, unit: "jobs_per_1000" };
  }
  if (detail.locationQuotient !== null) {
    return { value: detail.locationQuotient, unit: "location_quotient" };
  }
  return { value: detail.employment ?? 0, unit: "jobs" };
}

/**
 * Computes the three personalised dimensions for the whole candidate set.
 *
 * A city missing from a returned map has no usable evidence for that
 * dimension, which the caller treats as missing data — the same policy as an
 * absent observation, and never as a zero.
 */
function scorePersonalizedDimensions(
  cities: readonly CandidateCity[],
  personalization: Personalization,
): Map<PreferenceWeightKey, Map<string, PersonalizedScore>> {
  const career = new Map<string, PersonalizedScore>();
  const housing = new Map<string, PersonalizedScore>();
  const climate = new Map<string, PersonalizedScore>();
  const safety = new Map<string, PersonalizedScore>();
  const family = new Map<string, PersonalizedScore>();
  const social = new Map<string, PersonalizedScore>();

  for (const [cityId, result] of scoreCareerFit(
    cities,
    personalization.occupation,
  )) {
    if (!result) continue;
    const raw = careerRawValue(result);
    career.set(cityId, {
      normalizedScore: result.score,
      rawValue: raw.value,
      unit: raw.unit,
      detail: result.detail,
    });
  }

  // Benchmarks first: the percentile only means something against the same
  // basis every other candidate is being judged on.
  const benchmarks = new Map<string, HousingBenchmark>();
  for (const city of cities) {
    const benchmark = resolveHousingBenchmark(
      city,
      personalization.desiredBedrooms,
    );
    if (benchmark) benchmarks.set(city.id, benchmark);
  }

  const rentPopulation = [...benchmarks.values()].map(
    (benchmark) => benchmark.rent,
  );

  if (rentPopulation.length > 0) {
    for (const [cityId, benchmark] of benchmarks) {
      const result = scoreHousing(
        benchmark,
        rentPopulation,
        personalization.housingBudget,
      );
      housing.set(cityId, {
        normalizedScore: result.score,
        rawValue: benchmark.rent,
        unit: "usd_per_month",
        detail: result.detail,
      });
    }
  }

  for (const city of cities) {
    const temperature = city.observations.climate?.rawValue;
    if (temperature === undefined || !Number.isFinite(temperature)) continue;

    const result = scoreClimate(temperature, personalization.climatePreference);
    // Null means the user waived climate. Nothing is recorded, so the dimension
    // reads as unscored rather than as a fabricated 50.
    if (!result) continue;

    climate.set(city.id, {
      normalizedScore: result.score,
      rawValue: temperature,
      unit: "degrees_fahrenheit",
      detail: result.detail,
    });
  }

  // ---------------------------------------------------------------------
  // Safety, then family.
  //
  // Order matters: Family Fit reuses the finished Safety Fit rather than
  // recomputing crime, so the two dimensions can never disagree about how safe
  // a metro is.
  // ---------------------------------------------------------------------

  const safetyScores = scoreSafetyFit(cities);

  for (const [cityId, result] of safetyScores) {
    if (!result) continue;
    safety.set(cityId, {
      normalizedScore: result.score,
      // The violent rate is quoted because it carries most of the weight; the
      // property rate travels alongside it in the detail.
      rawValue: result.detail.violentCrimeRate ?? 0,
      unit: "per_100k",
      detail: result.detail,
    });
  }

  // Commute and healthcare come from the generic observation path, so family
  // reuses those normalisations instead of defining a second one.
  const commutePopulation = populationFor(cities, "transport");
  const healthcarePopulation = populationFor(cities, "healthcare");

  const familyInputs = new Map<string, FamilyInputs>();
  for (const city of cities) {
    familyInputs.set(city.id, {
      safetyScore: safetyScores.get(city.id)?.score ?? null,
      commuteScore: observationScore(city, "transport", commutePopulation),
      healthcareScore: observationScore(
        city,
        "healthcare",
        healthcarePopulation,
      ),
    });
  }

  for (const [cityId, result] of scoreFamilyFit(cities, familyInputs)) {
    if (!result) continue;
    family.set(cityId, {
      normalizedScore: result.score,
      rawValue: result.detail.schoolsPer10kSchoolAge,
      unit: "index",
      detail: result.detail,
    });
  }

  // ---------------------------------------------------------------------
  // Social, from the user's own lifestyle preferences.
  // ---------------------------------------------------------------------

  for (const [cityId, result] of scoreLifestyleFit(
    cities,
    personalization.lifestylePreferences,
  )) {
    if (!result) continue;

    // The mean rate across the categories that were actually scored: the one
    // figure that describes the whole dimension without privileging a
    // category the user may not have asked about.
    const meanRate =
      result.detail.categories.reduce(
        (total, entry) => total + entry.placesPer100k,
        0,
      ) / result.detail.categories.length;

    social.set(cityId, {
      normalizedScore: result.score,
      rawValue: meanRate,
      unit: "index",
      detail: result.detail,
    });
  }

  return new Map([
    ["career", career],
    ["housing", housing],
    ["climate", climate],
    ["safety", safety],
    ["family", family],
    ["social", social],
  ]);
}

/**
 * Scores every candidate against one user's weights.
 *
 * @param cities candidate set; normalisation is relative to exactly this set
 * @param normalized user weights already rescaled to sum to 1
 * @param personalization the user's own housing-size, climate and budget
 *   answers. Omitted, every personalised dimension falls back to its
 *   metro-wide behaviour, which is what a legacy profile gets.
 */
export function scoreCities(
  cities: readonly CandidateCity[],
  normalized: NormalizedWeights,
  personalization: Personalization = NO_PERSONALIZATION,
): CityScore[] {
  const populations = collectPopulations(cities);
  const personalized = scorePersonalizedDimensions(cities, personalization);

  return cities.map((city) => {
    const available = new Set<PreferenceWeightKey>();

    for (const key of PREFERENCE_WEIGHT_KEYS) {
      if (COMPOSITE_DIMENSIONS.has(key)) {
        if (personalized.get(key)?.has(city.id)) available.add(key);
        continue;
      }

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
      if (!available.has(key)) continue;

      const personalizedScore = personalized.get(key)?.get(city.id);
      const observation = city.observations[key];
      const population = populations[key];

      let normalizedScore: number;
      let rawValue: number;
      let unit: string;
      let detail: DimensionDetail | null = null;

      if (personalizedScore) {
        ({ normalizedScore, rawValue, unit, detail } = personalizedScore);
      } else if (observation && population) {
        normalizedScore = normalizeObservation(
          key,
          observation.rawValue,
          population,
        );
        rawValue = observation.rawValue;
        unit = observation.unit;
      } else {
        continue;
      }

      const effectiveWeight = effective.weights[key];
      const contribution = normalizedScore * effectiveWeight;

      dimensions[key] = {
        dimension: key,
        available: true,
        rawValue,
        unit,
        normalizedScore,
        effectiveWeight,
        contribution,
        // The observation's source is still the right citation for a
        // personalised dimension's fallback measurement; the occupational and
        // bedroom figures carry their own provenance in `detail`.
        source: observation?.source ?? null,
        detail,
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
