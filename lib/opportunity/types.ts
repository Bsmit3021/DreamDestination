import type { MetricSourceRef } from "@/lib/matching/types";

/**
 * The career + housing intelligence layer.
 *
 * Everything here *supplements* a Phase 3 recommendation. Nothing in this file
 * feeds back into the Fit Score: changing how destinations rank would require a
 * new matching algorithm version, which Phase 4 deliberately does not do.
 */

/** How a wage figure came to be absent. Never collapse these into one. */
export type WageAvailability =
  /** BLS published a point estimate. */
  | "published"
  /** BLS suppressed it ("*"): not released for this metro/occupation. */
  | "not_released"
  /** BLS reported "#": at or above the top code, so no point estimate exists. */
  | "top_coded";

export interface CareerIntelligence {
  occupation: { socCode: string; title: string };
  /**
   * Total jobs in this occupation in the metro. NOT job openings — OEWS counts
   * people employed, not vacancies.
   */
  employment: number | null;
  /** Jobs in this occupation per 1,000 jobs in the metro. */
  employmentPer1000: number | null;
  /**
   * Local concentration relative to the national average. 1.0 means typical.
   * NOT a probability of being hired.
   */
  locationQuotient: number | null;
  wages: {
    availability: WageAvailability;
    meanAnnual: number | null;
    medianAnnual: number | null;
    percentile25: number | null;
    percentile75: number | null;
    /** Only meaningful when availability is "top_coded". */
    topCodeAnnual: number | null;
  };
  period: string;
  source: MetricSourceRef | null;
}

export interface HousingIntelligence {
  medianGrossRent: number | null;
  bedrooms: {
    studio: number | null;
    one: number | null;
    two: number | null;
    three: number | null;
    four: number | null;
  };
  medianHomeValue: number | null;
  /**
   * Present only when the profile states a usable monthly budget. Phase 3
   * already treats 0 as "unspecified", and that reading is preserved here.
   */
  budgetComparison: {
    monthlyBudget: number;
    benchmarkRent: number;
    /** budget − benchmark. Positive means the budget exceeds the benchmark. */
    difference: number;
    /** Benchmark as a percentage of the budget. */
    benchmarkPercentOfBudget: number;
  } | null;
  period: string;
  source: MetricSourceRef | null;
}

/** One destination, combining the Phase 3 match with Phase 4 intelligence. */
export interface DestinationOpportunity {
  city: {
    id: string;
    slug: string;
    city: string;
    state: string;
    metro: string | null;
  };
  /** Straight from the stored Phase 3 recommendation. Never recomputed here. */
  fit: {
    rank: number;
    score: number;
    algorithmVersion: string;
    dataCoverage: number;
    reasons: { label: string; detail: string }[];
    tradeoffs: { label: string; detail: string }[];
  };
  /**
   * The user's confirmed occupation, if they have set one.
   *
   * Kept separate from `career` so the UI can tell two very different things
   * apart: "you have not chosen an occupation yet" versus "you have, but BLS
   * publishes no estimate for it in this metro". Collapsing both into a null
   * `career` would tell a user to confirm an occupation they already confirmed.
   */
  careerTarget: { socCode: string; title: string } | null;
  career: CareerIntelligence | null;
  housing: HousingIntelligence | null;
}
