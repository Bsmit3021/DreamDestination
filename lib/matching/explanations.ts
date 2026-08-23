import { usesGeneralLaborMarket } from "@/lib/matching/career";
import { BEDROOM_SHORT_LABELS, CLIMATE_PREFERENCE_LABELS } from "@/lib/labels";
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
    case "usd_per_year":
      return `$${Math.round(value).toLocaleString("en-US")}/yr`;
    case "jobs_per_1000":
      return `${value.toFixed(1)} per 1,000 jobs`;
    case "jobs":
      return `${Math.round(value).toLocaleString("en-US")} jobs`;
    case "location_quotient":
      return `${value.toFixed(2)}× the national average`;
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

/**
 * What the number quoted for a dimension actually is.
 *
 * The registry's metric label describes the dimension's *fallback* measurement,
 * which is the wrong caption once a dimension has been personalised: a career
 * row showing a median wage must not be labelled "Unemployment rate", and a
 * 3-bedroom rent must not be labelled "Median gross rent". Stored alongside the
 * score so the breakdown table can caption a stored snapshot correctly.
 */
export function measurementLabel(dimension: DimensionScore): string {
  const definition = DIMENSIONS[dimension.dimension];
  const fallback = definition.metric?.label ?? definition.label;
  const detail = dimension.detail;

  if (!detail) return fallback;

  switch (detail.kind) {
    case "career":
      if (usesGeneralLaborMarket(detail.basis)) return "Unemployment rate";
      switch (dimension.unit) {
        case "usd_per_year":
          return `Median annual wage, ${detail.occupation?.title ?? "your occupation"}`;
        case "jobs_per_1000":
          return `Jobs per 1,000, ${detail.occupation?.title ?? "your occupation"}`;
        case "location_quotient":
          return `Location quotient, ${detail.occupation?.title ?? "your occupation"}`;
        default:
          return `Local employment, ${detail.occupation?.title ?? "your occupation"}`;
      }
    case "housing":
      return detail.benchmarkBasis === "bedroom_specific" &&
        detail.desiredBedrooms
        ? `${BEDROOM_SHORT_LABELS[detail.desiredBedrooms]} median rent`
        : "Median gross rent";
    case "climate":
      return fallback;
  }
}

/**
 * The evidence half of a line, for the dimensions scored from one measurement.
 */
function describeGeneric(dimension: DimensionScore): string {
  const definition = DIMENSIONS[dimension.dimension];
  const metricLabel = definition.metric?.label ?? definition.label;
  const value = formatRawValue(dimension.rawValue ?? 0, dimension.unit);

  return `${metricLabel}: ${value}`;
}

/**
 * Career evidence, naming only what was actually used.
 *
 * The two bases produce visibly different sentences on purpose. A reader must
 * never come away believing their occupation was taken into account when BLS
 * published too little for it here — that is the difference between a
 * personalised result and an unsupported claim about one.
 */
function describeCareer(dimension: DimensionScore): string {
  const detail = dimension.detail;
  if (detail?.kind !== "career") return describeGeneric(dimension);

  if (detail.basis === "occupation_data_fallback") {
    // A substitution, and the reader has to come away knowing two things: that
    // this number is not about their occupation, and that the score was held
    // back because of it. Stating only the first would leave a high fallback
    // score looking like a high occupational one.
    const rate = formatRawValue(detail.unemploymentRate ?? 0, "percent");
    const title = detail.occupation?.title ?? "your occupation";
    return `Unemployment rate: ${rate} (metro-wide, not ${title} — BLS publishes too little for that occupation here, so the score is scaled back for the weaker evidence)`;
  }

  if (detail.basis === "general_labor_market") {
    // Not a substitution: the user chose no occupation, so the metro-wide
    // labour market is the measurement they asked for. Nothing is missing, so
    // nothing is discounted and the sentence must not suggest otherwise.
    const rate = formatRawValue(detail.unemploymentRate ?? 0, "percent");
    return `Unemployment rate: ${rate} (no occupation selected, so this reflects the metro-wide labour market rather than a specific occupation)`;
  }

  const parts: string[] = [];
  if (detail.medianAnnualWage !== null) {
    parts.push(
      `median pay ${formatRawValue(detail.medianAnnualWage, "usd_per_year")}`,
    );
  } else if (detail.wageTopCoded) {
    // "#" means at or above the top code: the wage is unknown, not low.
    parts.push("median pay above the BLS reporting ceiling");
  }
  if (detail.employmentPer1000 !== null) {
    parts.push(
      formatRawValue(detail.employmentPer1000, "jobs_per_1000") + " locally",
    );
  }
  if (detail.locationQuotient !== null) {
    parts.push(
      `concentration ${formatRawValue(detail.locationQuotient, "location_quotient")}`,
    );
  }
  if (detail.employment !== null) {
    parts.push(formatRawValue(detail.employment, "jobs"));
  }

  const title = detail.occupation?.title ?? "your occupation";
  const gap =
    detail.coverage < 1 ? " (BLS suppresses the rest for this metro)" : "";

  return `${title}: ${parts.join(", ")}${gap}`;
}

function describeHousing(dimension: DimensionScore): string {
  const detail = dimension.detail;
  if (detail?.kind !== "housing") return describeGeneric(dimension);

  const label =
    detail.benchmarkBasis === "bedroom_specific" && detail.desiredBedrooms
      ? `${BEDROOM_SHORT_LABELS[detail.desiredBedrooms]} median rent`
      : "Median gross rent";

  const rent = formatRawValue(detail.benchmarkRent, "usd_per_month");

  const fallback =
    detail.benchmarkBasis === "overall_median" && detail.desiredBedrooms
      ? ` (ACS publishes no ${BEDROOM_SHORT_LABELS[detail.desiredBedrooms].toLowerCase()} figure here, so the overall median stands in)`
      : "";

  const budget =
    detail.budgetRatio !== null && detail.monthlyBudget !== null
      ? `, ${Math.round(detail.budgetRatio * 100)}% of your ${formatRawValue(detail.monthlyBudget, "usd_per_month")} budget`
      : "";

  return `${label}: ${rent}${budget}${fallback}`;
}

/**
 * The one climate preference the scored data cannot actually measure.
 *
 * Seasonality is a spread; the dataset holds a single annual mean. Metros with
 * cold winters and warm summers do cluster in that band, which is why it is a
 * usable proxy, but saying "matches the four distinct seasons you asked for"
 * would claim a measurement that was never taken.
 */
const FOUR_SEASONS_CAVEAT =
  "annual averages only, so this approximates seasonal variation rather than measuring it";

function describeClimate(dimension: DimensionScore): string {
  const detail = dimension.detail;
  if (detail?.kind !== "climate") return describeGeneric(dimension);

  const temperature = formatRawValue(
    detail.annualMeanTemperature,
    "degrees_fahrenheit",
  );

  if (detail.preference === "four_seasons") {
    const fit = detail.withinBand ? "sits in" : "sits outside";
    return `Annual mean temperature: ${temperature}, which ${fit} the range typical of metros with distinct seasons (${FOUR_SEASONS_CAVEAT})`;
  }

  const preference = CLIMATE_PREFERENCE_LABELS[detail.preference].toLowerCase();
  const fit = detail.withinBand
    ? `matches the ${preference} climate you asked for`
    : `is outside the ${preference} range you asked for`;

  return `Annual mean temperature: ${temperature}, which ${fit}`;
}

function describe(dimension: DimensionScore, isTopPriority: boolean): string {
  const score = Math.round(dimension.normalizedScore ?? 0);
  const priority = isTopPriority ? ", your highest-weighted priority" : "";

  const evidence =
    dimension.detail?.kind === "career"
      ? describeCareer(dimension)
      : dimension.detail?.kind === "housing"
        ? describeHousing(dimension)
        : dimension.detail?.kind === "climate"
          ? describeClimate(dimension)
          : describeGeneric(dimension);

  return `${evidence} — scores ${score}/100 against the other candidates${priority}.`;
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
