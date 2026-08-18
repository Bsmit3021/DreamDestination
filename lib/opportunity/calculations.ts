import type { HousingIntelligence } from "@/lib/opportunity/types";

/**
 * The arithmetic behind the housing comparison. Pure, so it is testable
 * without a database and cannot drift from what the UI renders.
 */

/**
 * Compares a stated monthly housing budget against a metro rent benchmark.
 *
 * Returns null when no comparison is meaningful:
 *  - budget is 0 or negative — Phase 3 already reads 0 as "unspecified", and
 *    reporting "your budget is $1,420 short" to someone who never stated one
 *    would be inventing a finding.
 *  - no benchmark rent is published for the metro.
 *
 * The result is deliberately a plain difference, not a probability or an
 * affordability verdict. "Your stated budget is $180 above this benchmark" is
 * something the data supports; "you can afford this city" is not.
 */
export function compareBudget(
  monthlyBudget: number | null | undefined,
  benchmarkRent: number | null,
): HousingIntelligence["budgetComparison"] {
  if (
    monthlyBudget === null ||
    monthlyBudget === undefined ||
    !Number.isFinite(monthlyBudget) ||
    monthlyBudget <= 0
  ) {
    return null;
  }
  if (
    benchmarkRent === null ||
    !Number.isFinite(benchmarkRent) ||
    benchmarkRent <= 0
  ) {
    return null;
  }

  return {
    monthlyBudget,
    benchmarkRent,
    difference: monthlyBudget - benchmarkRent,
    benchmarkPercentOfBudget: (benchmarkRent / monthlyBudget) * 100,
  };
}

/**
 * Plain-language description of a location quotient.
 *
 * Bands are deliberately coarse. The underlying figure is an estimate, and
 * implying that 1.21 and 1.19 are meaningfully different would overstate it.
 * Says nothing about an individual's chances — only about how concentrated the
 * occupation is locally.
 */
export function describeConcentration(
  locationQuotient: number | null,
): string | null {
  if (locationQuotient === null || !Number.isFinite(locationQuotient))
    return null;

  if (locationQuotient >= 1.5) {
    return "Much more concentrated here than the national average";
  }
  if (locationQuotient >= 1.15) {
    return "More concentrated here than the national average";
  }
  if (locationQuotient >= 0.85) {
    return "About as concentrated here as the national average";
  }
  if (locationQuotient >= 0.5) {
    return "Less concentrated here than the national average";
  }
  return "Much less concentrated here than the national average";
}
