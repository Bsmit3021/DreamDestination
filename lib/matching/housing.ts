import { clampScore, percentileScore } from "@/lib/matching/normalization";
import type { CandidateCity } from "@/lib/matching/types";
import type { DesiredBedrooms } from "@/types/profile";

/**
 * Housing scored against the home the user says they want.
 *
 * v1 judged every user on one number: the metro's overall median gross rent.
 * That answers "is this metro expensive?" but not "can I get the place I need
 * here?" — a studio renter and a family needing three bedrooms face very
 * different markets in the same city.
 *
 * The ACS bedroom-specific rents (B25031) are already stored in
 * `housing_market_stats`; nothing new is fetched here. When the user has
 * stated a size and the corresponding figure exists, it becomes the benchmark
 * everything else is measured against.
 */

/** The ACS bedroom rents a metro publishes. Any of them may be absent. */
export interface MetroBedroomRents {
  studio: number | null;
  one: number | null;
  two: number | null;
  three: number | null;
  four: number | null;
}

/** Which rent the score is actually based on. Surfaced in explanations. */
export type HousingBenchmarkBasis = "bedroom_specific" | "overall_median";

export interface HousingBenchmark {
  rent: number;
  basis: HousingBenchmarkBasis;
  /** Null when the user has not stated a size. */
  desiredBedrooms: DesiredBedrooms | null;
}

/**
 * How much the relative and budget views each contribute — see `scoreHousing`.
 *
 * The budget view is a multiplier rather than a second addend, so a user whose
 * budget comfortably covers a metro sees exactly the v1 percentile. Only
 * metros that stretch the budget are pulled down.
 */
export const BUDGET_COMFORTABLE_RATIO = 1.0;
/**
 * The floor the multiplier reaches at the hard filter's 1.5× ceiling.
 *
 * Not zero: a metro at 1.49× the budget is a stretch, not a non-option, and
 * zeroing it would duplicate the hard filter's job with a softer input. Not a
 * cliff either — the factor moves continuously between the two ratios.
 */
export const BUDGET_STRETCH_FLOOR = 0.5;
export const BUDGET_STRETCH_CEILING = 1.5;

const FIELD_FOR_BEDROOMS: Record<DesiredBedrooms, keyof MetroBedroomRents> = {
  studio: "studio",
  one: "one",
  two: "two",
  three: "three",
  // ACS publishes no category above "4 bedrooms", so 4+ maps to it rather
  // than to an estimate that does not exist.
  four_plus: "four",
};

function usableRent(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * The rent this metro is judged on for this user.
 *
 * Falls back to the overall median gross rent whenever the user stated no size
 * or ACS suppressed that size for this metro. Falling back is deliberate: a
 * missing 3-bedroom estimate is a gap in the data, not evidence that the metro
 * is unaffordable, and dropping the metro over it would hide a real option.
 *
 * Returns null only when the metro has no usable rent of any kind.
 */
export function resolveHousingBenchmark(
  city: CandidateCity,
  desiredBedrooms: DesiredBedrooms | null,
): HousingBenchmark | null {
  if (desiredBedrooms && city.bedroomRents) {
    const specific = usableRent(
      city.bedroomRents[FIELD_FOR_BEDROOMS[desiredBedrooms]],
    );

    if (specific !== null) {
      return { rent: specific, basis: "bedroom_specific", desiredBedrooms };
    }
  }

  const overall = usableRent(city.observations.housing?.rawValue);
  if (overall === null) return null;

  return { rent: overall, basis: "overall_median", desiredBedrooms };
}

/**
 * How well the benchmark rent sits against a stated budget, as a 0.5–1.0
 * multiplier.
 *
 * 1.0 while the benchmark is at or below the budget — a metro is not "better"
 * for being far under it, because being cheap is already what the percentile
 * measures. From there it falls linearly to `BUDGET_STRETCH_FLOOR` at 1.5×,
 * the point the hard filter removes the metro entirely, so the soft penalty
 * and the hard cut-off meet rather than contradicting each other.
 *
 * Returns 1.0 when no budget was stated: 0 already means "unspecified"
 * everywhere else in the engine, and inventing a penalty from a number the
 * user never gave would be worse than ignoring it.
 */
export function budgetAlignmentFactor(
  benchmarkRent: number,
  monthlyBudget: number | null,
): number {
  if (
    monthlyBudget === null ||
    !Number.isFinite(monthlyBudget) ||
    monthlyBudget <= 0
  ) {
    return 1;
  }

  const ratio = benchmarkRent / monthlyBudget;

  if (ratio <= BUDGET_COMFORTABLE_RATIO) return 1;
  if (ratio >= BUDGET_STRETCH_CEILING) return BUDGET_STRETCH_FLOOR;

  const overshoot =
    (ratio - BUDGET_COMFORTABLE_RATIO) /
    (BUDGET_STRETCH_CEILING - BUDGET_COMFORTABLE_RATIO);

  return 1 - overshoot * (1 - BUDGET_STRETCH_FLOOR);
}

/** What the explanation layer needs to describe a housing score honestly. */
export interface HousingDetail {
  kind: "housing";
  desiredBedrooms: DesiredBedrooms | null;
  benchmarkRent: number;
  benchmarkBasis: HousingBenchmarkBasis;
  monthlyBudget: number | null;
  /** benchmarkRent ÷ budget. Null when no budget was stated. */
  budgetRatio: number | null;
  /** The percentile score before the budget multiplier. */
  relativeScore: number;
  budgetAlignmentFactor: number;
}

/**
 * Housing fit: how this metro's benchmark rent compares with the others,
 * tempered by whether the user could plausibly pay it.
 *
 *   score = percentile(benchmark, cheapest is best) × budgetAlignmentFactor
 *
 * Both halves are needed. The percentile alone says a metro is cheap relative
 * to the field even when every metro in the field is out of reach; the budget
 * alone says nothing about the alternatives.
 *
 * @param population every eligible metro's benchmark rent, on the same basis
 */
export function scoreHousing(
  benchmark: HousingBenchmark,
  population: readonly number[],
  monthlyBudget: number | null,
): { score: number; detail: HousingDetail } {
  const relativeScore = percentileScore(
    benchmark.rent,
    population,
    "lower_is_better",
  );
  const factor = budgetAlignmentFactor(benchmark.rent, monthlyBudget);

  const hasBudget =
    monthlyBudget !== null &&
    Number.isFinite(monthlyBudget) &&
    monthlyBudget > 0;

  return {
    score: clampScore(relativeScore * factor),
    detail: {
      kind: "housing",
      desiredBedrooms: benchmark.desiredBedrooms,
      benchmarkRent: benchmark.rent,
      benchmarkBasis: benchmark.basis,
      monthlyBudget: hasBudget ? monthlyBudget : null,
      budgetRatio: hasBudget ? benchmark.rent / monthlyBudget : null,
      relativeScore,
      budgetAlignmentFactor: factor,
    },
  };
}
