import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import type { PreferenceWeightKey, PreferenceWeights } from "@/types/profile";

/**
 * Turning the sliders a user moved into weights the scorer can use.
 *
 * Onboarding stores ten independent 0-1 values. They are *relative* importance,
 * not shares of a budget — a user can legitimately set every slider to 1. So
 * before scoring they are rescaled to sum to 1, which makes the weighted sum of
 * 0-100 dimension scores land back on a 0-100 total.
 */

export type NormalizedWeights = Record<PreferenceWeightKey, number>;

/**
 * What to do when a user leaves every slider at zero.
 *
 * Dividing by the total is impossible, and refusing to produce anything would
 * punish a user for a legitimate answer. Zero everywhere says "nothing matters
 * more than anything else", so it is read as equal importance across all
 * dimensions — the same result as setting every slider to the same non-zero
 * value.
 */
export const ALL_ZERO_WEIGHTS_POLICY = "equal_weighting" as const;

function emptyWeights(): NormalizedWeights {
  return Object.fromEntries(
    PREFERENCE_WEIGHT_KEYS.map((key) => [key, 0]),
  ) as NormalizedWeights;
}

/**
 * Rescales raw slider values so they sum to exactly 1.
 *
 * @throws {RangeError} if any weight is negative or not finite.
 */
export function normalizeWeights(
  weights: PreferenceWeights,
): NormalizedWeights {
  let total = 0;

  for (const key of PREFERENCE_WEIGHT_KEYS) {
    const value = weights[key];

    if (!Number.isFinite(value)) {
      throw new RangeError(`Weight for "${key}" must be finite, got ${value}`);
    }
    if (value < 0) {
      throw new RangeError(`Weight for "${key}" must not be negative`);
    }

    total += value;
  }

  const normalized = emptyWeights();

  if (total === 0) {
    const share = 1 / PREFERENCE_WEIGHT_KEYS.length;
    for (const key of PREFERENCE_WEIGHT_KEYS) {
      normalized[key] = share;
    }
    return normalized;
  }

  for (const key of PREFERENCE_WEIGHT_KEYS) {
    normalized[key] = weights[key] / total;
  }

  return normalized;
}

export interface EffectiveWeights {
  /** Weights renormalised across the dimensions this city can be scored on. */
  weights: NormalizedWeights;
  /**
   * Share of the user's total weight that fell on measurable dimensions.
   *
   * Deliberately weight-based rather than a plain count: a user who cares only
   * about safety gets 0 coverage when safety cannot be measured, even though
   * nine other dimensions have data. Counting dimensions would report 90% and
   * imply a confidence the result does not deserve.
   */
  coverage: number;
  covered: PreferenceWeightKey[];
  missing: PreferenceWeightKey[];
}

/**
 * Redistributes a user's weights over the dimensions actually available for
 * one city.
 *
 * A missing dimension is dropped from the denominator rather than scored as
 * zero. Scoring it zero would say "this city is terrible at X"; dropping it
 * says "we do not know about X here", which is the truth.
 */
export function effectiveWeightsFor(
  normalized: NormalizedWeights,
  available: ReadonlySet<PreferenceWeightKey>,
): EffectiveWeights {
  const covered: PreferenceWeightKey[] = [];
  const missing: PreferenceWeightKey[] = [];
  let coverage = 0;

  for (const key of PREFERENCE_WEIGHT_KEYS) {
    if (available.has(key)) {
      covered.push(key);
      coverage += normalized[key];
    } else if (normalized[key] > 0) {
      // Only counts as "missing" if the user actually cared about it.
      missing.push(key);
    }
  }

  const weights = emptyWeights();

  if (coverage > 0) {
    for (const key of covered) {
      weights[key] = normalized[key] / coverage;
    }
  }

  return { weights, coverage, covered, missing };
}
