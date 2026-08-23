import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import { PREFERENCE_LABELS } from "@/lib/labels";
import { compareBudget } from "@/lib/opportunity/calculations";
import type { DestinationOpportunity } from "@/lib/opportunity/types";
import type { PreferenceWeights } from "@/types/profile";

/**
 * Builds the bounded, allowlisted view of a user that the model is allowed to
 * see.
 *
 * Pure — it receives already-loaded domain objects and performs no I/O, so the
 * exact payload leaving the process is unit-testable.
 *
 * The allowlist is deliberately narrow. Identifiers that carry no reasoning
 * value are excluded on principle: the model cannot leak, and cannot be
 * tricked into echoing, an identifier it never received.
 */

/** Never sent to the provider. Asserted in tests. */
export const EXCLUDED_FROM_PROVIDER = [
  "email",
  "user id (auth uuid)",
  "profile id",
  "city uuid",
  "conversation id",
  "supabase session/access token",
  "service role key",
  "OpenAI api key",
  "password",
] as const;

export interface AdvisorCityContext {
  /** Slug, not uuid: stable, human-readable, useless as a database selector. */
  slug: string;
  name: string;
  rank: number;
  fitScore: number;
  dataCoverage: number;
  strengths: { label: string; detail: string }[];
  tradeoffs: { label: string; detail: string }[];
  career: {
    occupationTitle: string;
    socCode: string;
    employment: number | null;
    employmentPer1000: number | null;
    locationQuotient: number | null;
    wageAvailability: string;
    medianAnnualWage: number | null;
    meanAnnualWage: number | null;
    wageP25: number | null;
    wageP75: number | null;
    topCodeAnnual: number | null;
    period: string;
  } | null;
  housing: {
    medianGrossRent: number | null;
    studioRent: number | null;
    oneBedroomRent: number | null;
    twoBedroomRent: number | null;
    threeBedroomRent: number | null;
    fourBedroomRent: number | null;
    medianHomeValue: number | null;
    budgetDifference: number | null;
    benchmarkPercentOfBudget: number | null;
    period: string;
  } | null;
}

export interface AdvisorContext {
  algorithmVersion: string;
  user: {
    confirmedOccupation: { socCode: string; title: string } | null;
    /** null when unspecified; 0 is treated as unspecified upstream. */
    monthlyHousingBudget: number | null;
    priorities: { label: string; weightPercent: number }[];
  };
  destinations: AdvisorCityContext[];
}

/** User weights as whole percentages, strongest first. */
export function summarizePriorities(
  weights: PreferenceWeights,
): { label: string; weightPercent: number }[] {
  const total = PREFERENCE_WEIGHT_KEYS.reduce(
    (sum, key) => sum + (weights[key] ?? 0),
    0,
  );

  if (total <= 0) {
    // All-zero means equal importance — the same reading Phase 3 uses.
    const share = Math.round(100 / PREFERENCE_WEIGHT_KEYS.length);
    return PREFERENCE_WEIGHT_KEYS.map((key) => ({
      label: PREFERENCE_LABELS[key].label,
      weightPercent: share,
    }));
  }

  return PREFERENCE_WEIGHT_KEYS.map((key) => ({
    label: PREFERENCE_LABELS[key].label,
    weightPercent: Math.round(((weights[key] ?? 0) / total) * 100),
  }))
    .filter((entry) => entry.weightPercent > 0)
    .sort(
      (a, b) =>
        b.weightPercent - a.weightPercent || a.label.localeCompare(b.label),
    );
}

export function buildAdvisorContext(
  destinations: readonly DestinationOpportunity[],
  weights: PreferenceWeights,
  housingBudget: number | null,
  confirmedOccupation: { socCode: string; title: string } | null,
  algorithmVersion: string,
): AdvisorContext {
  return {
    algorithmVersion,
    user: {
      confirmedOccupation,
      monthlyHousingBudget:
        housingBudget !== null && housingBudget > 0 ? housingBudget : null,
      priorities: summarizePriorities(weights),
    },
    destinations: destinations
      .slice()
      .sort((a, b) => a.fit.rank - b.fit.rank)
      .map((destination) => ({
        slug: destination.city.slug,
        name: `${destination.city.city}, ${destination.city.state}`,
        rank: destination.fit.rank,
        fitScore: Math.round(destination.fit.score),
        dataCoverage: Math.round(destination.fit.dataCoverage * 100),
        strengths: destination.fit.reasons,
        tradeoffs: destination.fit.tradeoffs,
        career: destination.career
          ? {
              occupationTitle: destination.career.occupation.title,
              socCode: destination.career.occupation.socCode,
              employment: destination.career.employment,
              employmentPer1000: destination.career.employmentPer1000,
              locationQuotient: destination.career.locationQuotient,
              wageAvailability: destination.career.wages.availability,
              medianAnnualWage: destination.career.wages.medianAnnual,
              meanAnnualWage: destination.career.wages.meanAnnual,
              wageP25: destination.career.wages.percentile25,
              wageP75: destination.career.wages.percentile75,
              topCodeAnnual: destination.career.wages.topCodeAnnual,
              period: destination.career.period,
            }
          : null,
        housing: destination.housing
          ? {
              medianGrossRent: destination.housing.medianGrossRent,
              studioRent: destination.housing.bedrooms.studio,
              oneBedroomRent: destination.housing.bedrooms.one,
              twoBedroomRent: destination.housing.bedrooms.two,
              threeBedroomRent: destination.housing.bedrooms.three,
              fourBedroomRent: destination.housing.bedrooms.four,
              medianHomeValue: destination.housing.medianHomeValue,
              budgetDifference:
                destination.housing.budgetComparison?.difference ?? null,
              benchmarkPercentOfBudget: destination.housing.budgetComparison
                ? Math.round(
                    destination.housing.budgetComparison
                      .benchmarkPercentOfBudget,
                  )
                : null,
              period: destination.housing.period,
            }
          : null,
      })),
  };
}

export interface HypotheticalBudgetRow {
  name: string;
  benchmarkRent: number;
  difference: number;
  benchmarkPercentOfBudget: number;
}

/**
 * Recomputes budget comparisons at a hypothetical budget.
 *
 * Done server-side with the same `compareBudget` the real comparison uses, so
 * a "what if" answer is arithmetic the model narrates rather than arithmetic
 * the model performs. Nothing is persisted.
 */
export function buildHypotheticalBudget(
  context: AdvisorContext,
  hypotheticalMonthlyBudget: number,
): HypotheticalBudgetRow[] {
  const rows: HypotheticalBudgetRow[] = [];

  for (const destination of context.destinations) {
    const rent = destination.housing?.medianGrossRent;
    if (rent === null || rent === undefined) continue;

    const comparison = compareBudget(hypotheticalMonthlyBudget, rent);
    if (!comparison) continue;

    rows.push({
      name: destination.name,
      benchmarkRent: rent,
      difference: comparison.difference,
      benchmarkPercentOfBudget: Math.round(comparison.benchmarkPercentOfBudget),
    });
  }

  return rows;
}
