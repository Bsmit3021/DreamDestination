/**
 * Turning incompatible raw measurements into one comparable 0-100 scale.
 *
 * Rent is in dollars, commutes in minutes, unemployment in percent. Multiplying
 * any of those directly by a preference weight would be meaningless, so every
 * metric is first mapped onto a shared scale where 0 is a poor fit and 100 a
 * strong one.
 *
 * Percentile rank is the default rather than min-max. Metro-level measurements
 * have long tails — one metro's rent can sit far above every other — and plain
 * min-max would squash the entire middle of the distribution into a narrow band
 * decided by a single outlier. Percentile rank asks "how does this city compare
 * with the others?", which is both what a user actually wants to know and
 * immune to how extreme the extremes are.
 *
 * Every function here is pure: the same inputs always produce the same output.
 */

export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/** Constrains a value to the 0-100 scale. */
export function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Score must be finite, received ${value}`);
  }
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, value));
}

function assertFinite(values: readonly number[]): void {
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new RangeError(
        `Population contains a non-finite value (${value}); ` +
          "missing data must be filtered out before normalising.",
      );
    }
  }
}

/**
 * Percentile rank of `value` within `population`, as 0-100.
 *
 * Uses the mid-rank convention: ties share the midpoint of the range they
 * occupy, so equal inputs always receive equal scores and the result does not
 * depend on the order values happen to arrive in.
 *
 * With a single candidate, or when every candidate is identical, there is no
 * basis to prefer one over another and every value scores 50.
 */
export function percentileRank(
  value: number,
  population: readonly number[],
): number {
  if (population.length === 0) {
    throw new RangeError("Cannot rank against an empty population");
  }
  assertFinite(population);
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot rank a non-finite value (${value})`);
  }

  let below = 0;
  let equal = 0;

  for (const candidate of population) {
    if (candidate < value) below += 1;
    else if (candidate === value) equal += 1;
  }

  if (equal === population.length) {
    return 50;
  }

  return clampScore(((below + equal / 2) / population.length) * SCORE_MAX);
}

/**
 * Percentile score, oriented so that 100 always means "good".
 *
 * For a lower-is-better metric the percentile is inverted, so the cheapest rent
 * scores near 100 rather than near 0.
 */
export function percentileScore(
  value: number,
  population: readonly number[],
  direction: "higher_is_better" | "lower_is_better",
): number {
  const rank = percentileRank(value, population);
  return direction === "higher_is_better" ? rank : clampScore(SCORE_MAX - rank);
}

/** Inclusive percentile of a sorted-ascending array, linearly interpolated. */
function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 1) return sorted[0]!;

  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) return sorted[lower]!;

  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

/**
 * Linear scaling between winsorised bounds.
 *
 * Offered as an alternative to percentile rank for cases where the *distance*
 * between values matters, not just their order. Bounds default to the 5th and
 * 95th percentiles so a lone extreme value cannot compress everything else.
 *
 * When the bounds collapse (every value identical, or the trimmed range is
 * empty) there is nothing to distinguish candidates, so every value scores 50 —
 * matching `percentileRank`'s behaviour in the same situation.
 */
export function winsorizedMinMaxScore(
  value: number,
  population: readonly number[],
  direction: "higher_is_better" | "lower_is_better",
  { lowerQuantile = 0.05, upperQuantile = 0.95 } = {},
): number {
  if (population.length === 0) {
    throw new RangeError("Cannot scale against an empty population");
  }
  assertFinite(population);
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot scale a non-finite value (${value})`);
  }

  const sorted = [...population].sort((a, b) => a - b);
  const low = quantile(sorted, lowerQuantile);
  const high = quantile(sorted, upperQuantile);

  if (high === low) {
    return 50;
  }

  const clamped = Math.min(high, Math.max(low, value));
  const fraction = (clamped - low) / (high - low);

  return clampScore(
    (direction === "higher_is_better" ? fraction : 1 - fraction) * SCORE_MAX,
  );
}

/**
 * Score by closeness to a preferred value.
 *
 * Used where neither direction is automatically better — an annual mean
 * temperature of 85 °F is not "better" than 55 °F, it is simply further from a
 * temperate target. Scores fall linearly with distance and reach 0 once the
 * value is `tolerance` away, so the metric degrades predictably instead of
 * going negative.
 */
export function targetDistanceScore(
  value: number,
  target: number,
  tolerance: number,
): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot score a non-finite value (${value})`);
  }
  if (!Number.isFinite(target)) {
    throw new RangeError(`Target must be finite, received ${target}`);
  }
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) {
    throw new RangeError(
      `Tolerance must be a positive finite number, received ${tolerance}`,
    );
  }

  const distance = Math.abs(value - target);
  return clampScore((1 - distance / tolerance) * SCORE_MAX);
}
