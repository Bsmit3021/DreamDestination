import type { CITY_SCORE_KEYS } from "@/lib/constants";

import type { NormalizedValue, UsStateCode } from "@/types/profile";

/** Reference data for a city or metro area. Curated, not user-owned. */
export interface City {
  id: string;
  /** URL-safe unique identifier, e.g. `austin-tx`. */
  slug: string;
  city: string;
  state: UsStateCode;
  /** Metropolitan statistical area, when the city belongs to one. */
  metro: string | null;
  population: number | null;
  latitude: number;
  longitude: number;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp. */
  updatedAt: string;
}

export type CityScoreKey = (typeof CITY_SCORE_KEYS)[number];

/**
 * Comparable 0–1 scores, one per scoring dimension.
 *
 * These are what scoring consumes. They are derived from raw measurements, and
 * the derivation is deliberately not implemented yet.
 */
export type CityScores = Record<CityScoreKey, NormalizedValue | null>;

/**
 * Raw, human-meaningful measurements in their original units.
 *
 * Kept separate from `CityScores` so the UI can show a real number ("median
 * rent $1,850") while scoring works with normalised values.
 */
export interface CityRawMetrics {
  /** Median monthly rent in USD. */
  medianRent: number | null;
  /** Median annual household income in USD. */
  medianIncome: number | null;
}

/**
 * Metrics for one city. One row per city.
 *
 * Every measurement is nullable because no data has been ingested yet — a
 * `null` here means "not loaded", never "zero".
 */
export interface CityMetrics {
  id: string;
  cityId: string;
  raw: CityRawMetrics;
  scores: CityScores;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp. */
  updatedAt: string;
}

/** A city together with its metrics, as the results UI will consume it. */
export interface CityWithMetrics extends City {
  metrics: CityMetrics | null;
}
