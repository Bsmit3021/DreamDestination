import type { PreferenceWeightKey, UsStateCode } from "@/types/profile";

/**
 * Types for the matching engine.
 *
 * The three representations of a metric are kept deliberately distinct and are
 * never collapsed into one another:
 *
 *   raw value        what the source published, in its own unit
 *   normalized score that value placed on the shared 0-100 scale
 *   contribution     the normalized score multiplied by the user's weight
 */

/** Where a measurement came from. Enough to cite it in the UI. */
export interface MetricSourceRef {
  key: string;
  organization: string;
  dataset: string;
  url: string;
  /** Reporting period as published, e.g. "2019-2023". */
  period: string;
  geographyLevel: string;
}

/** One raw measurement for one city. */
export interface RawObservation {
  metricKey: string;
  dimension: PreferenceWeightKey;
  rawValue: number;
  unit: string;
  source: MetricSourceRef;
}

/** A city plus whatever measurements exist for it. */
export interface CandidateCity {
  id: string;
  slug: string;
  city: string;
  state: UsStateCode;
  metro: string | null;
  population: number | null;
  latitude: number;
  longitude: number;
  /** Absent key means no measurement — which is not the same as a zero. */
  observations: Partial<Record<PreferenceWeightKey, RawObservation>>;
}

/** Per-dimension detail behind a city's total score. */
export interface DimensionScore {
  dimension: PreferenceWeightKey;
  /** False when this city has no measurement for the dimension. */
  available: boolean;
  rawValue: number | null;
  unit: string | null;
  /** 0-100 on the shared scale, or null when unavailable. */
  normalizedScore: number | null;
  /** The user's weight after renormalising over available dimensions. */
  effectiveWeight: number;
  /** normalizedScore × effectiveWeight. Zero when unavailable. */
  contribution: number;
  source: MetricSourceRef | null;
}

export interface CityScore {
  city: CandidateCity;
  /** 0-100. Sum of contributions. */
  totalScore: number;
  /** Share of the user's total weight that landed on measurable dimensions. */
  dataCoverage: number;
  dimensionsCovered: number;
  /** How many dimensions the user put any weight on. */
  dimensionsWeighted: number;
  dimensions: Record<PreferenceWeightKey, DimensionScore>;
}

/** A single explanation line, tied back to the dimension that produced it. */
export interface MatchReason {
  dimension: PreferenceWeightKey;
  label: string;
  detail: string;
}

export interface RankedRecommendation extends CityScore {
  rank: number;
  reasons: MatchReason[];
  tradeoffs: MatchReason[];
}

/** Why a candidate was dropped before ranking. */
export interface ExcludedCity {
  city: CandidateCity;
  reason: "budget" | "insufficient_data";
  detail: string;
}

export interface MatchingResult {
  recommendations: RankedRecommendation[];
  excluded: ExcludedCity[];
  algorithmVersion: string;
  /** Dimensions the user weighted that nothing can score yet. */
  unscoredWeightedDimensions: PreferenceWeightKey[];
}
