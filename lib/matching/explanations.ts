import { DIMENSIONS } from "@/lib/matching/dimensions";
import type {
  CityScore,
  DimensionScore,
  MatchReason,
} from "@/lib/matching/types";

/**
 * Deterministic explanations, derived only from the numbers the scorer already
 * produced.
 *
 * Nothing here consults an external model or asserts anything about a city that
 * is not in the dataset. A reason can only ever name a dimension that was
 * actually measured for that city, and always quotes the measurement behind it.
 */

/** A dimension must score at least this to be offered as a strength. */
export const STRENGTH_SCORE_THRESHOLD = 60;

/** At or below this, a dimension is a candidate tradeoff. */
export const TRADEOFF_SCORE_THRESHOLD = 45;

export const MAX_REASONS = 3;
export const MAX_TRADEOFFS = 2;

/** Renders a raw measurement in its own unit, never as a bare number. */
export function formatRawValue(value: number, unit: string | null): string {
  switch (unit) {
    case "usd_per_month":
      return `$${Math.round(value).toLocaleString("en-US")}/mo`;
    case "usd":
      return `$${Math.round(value).toLocaleString("en-US")}`;
    case "percent":
      return `${value.toFixed(1)}%`;
    case "minutes":
      return `${value.toFixed(1)} min`;
    case "degrees_fahrenheit":
      return `${value.toFixed(1)}°F`;
    case "per_100k":
      return `${Math.round(value).toLocaleString("en-US")} per 100k`;
    default:
      return `${value}`;
  }
}

function describe(dimension: DimensionScore, isTopPriority: boolean): string {
  const definition = DIMENSIONS[dimension.dimension];
  const metricLabel = definition.metric?.label ?? definition.label;
  const value = formatRawValue(dimension.rawValue ?? 0, dimension.unit);
  const score = Math.round(dimension.normalizedScore ?? 0);

  const priority = isTopPriority ? ", your highest-weighted priority" : "";

  return `${metricLabel}: ${value} — scores ${score}/100 against the other candidates${priority}.`;
}

/** The dimension carrying the most user weight, or null if none do. */
function topWeightedDimension(score: CityScore): string | null {
  let best: DimensionScore | null = null;

  for (const dimension of Object.values(score.dimensions)) {
    if (!dimension.available) continue;
    if (!best || dimension.effectiveWeight > best.effectiveWeight) {
      best = dimension;
    }
  }

  return best && best.effectiveWeight > 0 ? best.dimension : null;
}

/**
 * Strengths, ordered by how much they actually moved the total.
 *
 * Ranked by contribution rather than raw score, so a dimension the user barely
 * cares about cannot lead the explanation just because the city happens to do
 * well at it.
 */
export function buildReasons(score: CityScore): MatchReason[] {
  const topPriority = topWeightedDimension(score);

  return Object.values(score.dimensions)
    .filter(
      (dimension) =>
        dimension.available &&
        dimension.effectiveWeight > 0 &&
        (dimension.normalizedScore ?? 0) >= STRENGTH_SCORE_THRESHOLD,
    )
    .sort(
      (a, b) =>
        b.contribution - a.contribution ||
        a.dimension.localeCompare(b.dimension),
    )
    .slice(0, MAX_REASONS)
    .map((dimension) => ({
      dimension: dimension.dimension,
      label: DIMENSIONS[dimension.dimension].label,
      detail: describe(dimension, dimension.dimension === topPriority),
    }));
}

/**
 * Weak spots that matter, ordered by how much score they cost.
 *
 * The cost of a dimension is `weight × (100 − score)` — the contribution it
 * failed to make. A low score on something the user does not care about costs
 * almost nothing and is therefore not worth mentioning.
 */
export function buildTradeoffs(score: CityScore): MatchReason[] {
  const topPriority = topWeightedDimension(score);

  return Object.values(score.dimensions)
    .filter(
      (dimension) =>
        dimension.available &&
        dimension.effectiveWeight > 0 &&
        (dimension.normalizedScore ?? 100) <= TRADEOFF_SCORE_THRESHOLD,
    )
    .map((dimension) => ({
      dimension,
      cost:
        dimension.effectiveWeight * (100 - (dimension.normalizedScore ?? 100)),
    }))
    .sort(
      (a, b) =>
        b.cost - a.cost ||
        a.dimension.dimension.localeCompare(b.dimension.dimension),
    )
    .slice(0, MAX_TRADEOFFS)
    .map(({ dimension }) => ({
      dimension: dimension.dimension,
      label: DIMENSIONS[dimension.dimension].label,
      detail: describe(dimension, dimension.dimension === topPriority),
    }));
}
