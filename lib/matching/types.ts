import type {
  CareerDetail,
  MetroOccupationStats,
  OccupationTarget,
} from "@/lib/matching/career";
import type { ClimateDetail } from "@/lib/matching/climate";
import type { HousingDetail, MetroBedroomRents } from "@/lib/matching/housing";
import type {
  ClimatePreference,
  DesiredBedrooms,
  PreferenceWeightKey,
  UsStateCode,
} from "@/types/profile";

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
  /**
   * BLS OEWS estimates for the signed-in user's confirmed occupation in this
   * metro.
   *
   * Null has two distinct causes, and the career scorer keeps them apart:
   * either the user has no confirmed occupation (so nothing was loaded), or
   * BLS publishes no row for that occupation here. Neither is evidence that
   * the occupation does not exist locally.
   */
  career?: MetroOccupationStats | null;
  /**
   * ACS bedroom-specific median rents for this metro, when published.
   *
   * The overall median gross rent stays where it always was — in
   * `observations.housing` — so the housing dataset is not duplicated.
   */
  bedroomRents?: MetroBedroomRents | null;
}

/**
 * The user-side inputs that make a dimension personal.
 *
 * Passed through the scorer rather than read from a profile inside it, so the
 * scoring functions stay pure and directly testable.
 */
export interface Personalization {
  /** Null means unstated: housing falls back to the overall median rent. */
  desiredBedrooms: DesiredBedrooms | null;
  /** Null is read exactly like `no_preference`. */
  climatePreference: ClimatePreference | null;
  /** Monthly budget in USD. Null or 0 means unspecified. */
  housingBudget: number | null;
  /**
   * The user's confirmed occupation, or null when they have not chosen one.
   *
   * Null is a real answer, not missing data: it means the metro-wide labour
   * market is the career measurement the user asked for. Career Fit needs the
   * distinction because a city with no OEWS row looks the same either way.
   */
  occupation: OccupationTarget | null;
}

/**
 * Per-dimension evidence, for dimensions whose score is more than one
 * measurement. Discriminated on `kind` so an explanation cannot read a career
 * field off a housing score.
 */
export type DimensionDetail = CareerDetail | HousingDetail | ClimateDetail;

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
  /**
   * The workings behind a personalised dimension, when it has any.
   *
   * Null for the dimensions that are still a single normalised measurement.
   * Explanations read this so they can name the evidence that was actually
   * used — and so they cannot imply occupation-specific data was used when it
   * was not.
   */
  detail?: DimensionDetail | null;
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
  /**
   * Dimensions removed from the weighting because the user said they do not
   * care, not because data is missing. Only `climate` can appear here today,
   * via `no_preference`.
   */
  dimensionsWaivedByUser: PreferenceWeightKey[];
}
