import type { City } from "@/types/city";
import type { NormalizedValue, PreferenceWeightKey } from "@/types/profile";

/**
 * The explanation stored alongside a recommendation, persisted as JSONB in
 * `recommendations.reason_json`.
 *
 * Day 1 fixes the shape only. Nothing produces these values yet: generating
 * them is the job of the scoring and explanation work packages.
 */
export interface RecommendationReason {
  /** One-paragraph, human-readable summary of why this city fits. */
  summary: string;
  /** Dimensions where this city scored well against the user's weights. */
  strengths: PreferenceWeightKey[];
  /** Dimensions where the user would be compromising. */
  tradeoffs: PreferenceWeightKey[];
}

/** One ranked city suggestion for a profile. */
export interface Recommendation {
  id: string;
  profileId: string;
  /** The recommended city, joined in for display. */
  city: City;
  /** 1-based position within this profile's result set. Unique per profile. */
  rank: number;
  /** Overall fit, normalised to 0–1. */
  dreamScore: NormalizedValue;
  reason: RecommendationReason;
  /** ISO 8601 timestamp. */
  createdAt: string;
}
