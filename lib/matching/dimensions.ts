import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import type { PreferenceWeightKey } from "@/types/profile";

/**
 * The metric registry: the single description of what each scoring dimension
 * measures, where the number comes from, and how it becomes a score.
 *
 * The dimension keys are exactly the ten weights onboarding already collects
 * (`PREFERENCE_WEIGHT_KEYS`). Nothing here invents a dimension.
 *
 * Every one of the ten now has a measurement behind it. The registry keeps the
 * machinery for an unscored dimension anyway, because the missing-data policy
 * still needs to know the difference between "we measured zero" and "we have
 * nothing" for any individual metro.
 */

/** How a raw measurement relates to a good outcome. */
export type MetricDirection =
  /** Bigger numbers are better, e.g. share of adults with a degree. */
  | "higher_is_better"
  /** Smaller numbers are better, e.g. rent, commute length, uninsured share. */
  | "lower_is_better"
  /** Closeness to a target is better, e.g. average temperature. */
  | "target_is_better";

/** How a raw measurement is mapped onto the shared 0-100 scale. */
export type NormalizationMethod =
  /** Rank against the other candidates. Robust to outliers. */
  | "percentile"
  /** Linear within winsorised bounds, then clamped. */
  | "winsorized_min_max"
  /** Distance from a target value, scaled by a tolerance. */
  | "target_distance"
  /**
   * Several normalised components combined inside the dimension, with the
   * user's own answers deciding which ones apply. See lib/matching/career.ts
   * and lib/matching/housing.ts.
   */
  | "personalized_composite"
  /**
   * Several normalised components combined inside the dimension with fixed
   * sub-weights, identical for every user. See lib/matching/safety.ts and
   * lib/matching/family.ts.
   */
  | "composite"
  /**
   * Closeness to the band the user asked for, rather than to a fixed target.
   * See lib/matching/climate.ts.
   */
  | "preference_band";

export interface DimensionDefinition {
  key: PreferenceWeightKey;
  label: string;
  /** Plain-language description of what a high score means. */
  description: string;
  /**
   * The measurement backing this dimension, or null when nothing credible is
   * available yet. Null means the dimension is always treated as missing data.
   */
  metric: {
    /** Matches `city_metric_observations.metric_key`. */
    key: string;
    /** What the source actually publishes — never a stronger claim. */
    label: string;
    unit: string;
    direction: MetricDirection;
    normalization: NormalizationMethod;
    /**
     * Only for `target_is_better`: the preferred value and the distance at
     * which the score reaches zero.
     */
    target?: { value: number; tolerance: number };
  } | null;
  /** Why the dimension has no metric yet. Populated only when metric is null. */
  unavailableReason?: string;
}

export const DIMENSIONS: Record<PreferenceWeightKey, DimensionDefinition> = {
  career: {
    key: "career",
    label: "Career opportunity",
    description:
      "Pay, concentration and depth of the user's own occupation in this " +
      "metro, with the metro-wide labour market as context. Falls back to the " +
      "unemployment rate alone when BLS publishes too little for the " +
      "occupation here.",
    metric: {
      // The metro-wide fallback measurement, and the `generalLaborMarket`
      // component of the occupational score. The occupational figures come
      // from `metro_occupation_stats`, keyed by the user's own SOC code, and
      // so cannot be described by a single shared metric key.
      key: "unemployment_rate",
      label: "Unemployment rate",
      unit: "percent",
      direction: "lower_is_better",
      normalization: "personalized_composite",
    },
  },
  housing: {
    key: "housing",
    label: "Housing",
    description:
      "Monthly rent for the home size the user asked for, relative to the " +
      "other metros and to their stated budget.",
    metric: {
      // The fallback benchmark. Bedroom-specific rents live in
      // `housing_market_stats` and are selected per user.
      key: "median_gross_rent",
      label: "Median gross rent",
      unit: "usd_per_month",
      direction: "lower_is_better",
      normalization: "personalized_composite",
    },
  },
  cost: {
    key: "cost",
    label: "Cost of living",
    description:
      "Share of household income the typical renter spends on housing.",
    metric: {
      key: "rent_share_of_income",
      label: "Median gross rent as a percentage of household income",
      unit: "percent",
      direction: "lower_is_better",
      normalization: "percentile",
    },
  },
  education: {
    key: "education",
    label: "Education",
    description:
      "Share of adults aged 25+ holding a bachelor's degree or higher.",
    metric: {
      key: "bachelors_or_higher_share",
      label: "Educational attainment, bachelor's degree or higher",
      unit: "percent",
      direction: "higher_is_better",
      normalization: "percentile",
    },
  },
  healthcare: {
    key: "healthcare",
    label: "Healthcare access",
    description: "Share of the population without health insurance coverage.",
    metric: {
      key: "uninsured_share",
      label: "Population without health insurance coverage",
      unit: "percent",
      direction: "lower_is_better",
      normalization: "percentile",
    },
  },
  transport: {
    key: "transport",
    label: "Getting around",
    description: "Average one-way commute time for workers aged 16+.",
    metric: {
      key: "mean_commute_minutes",
      label: "Mean travel time to work",
      unit: "minutes",
      direction: "lower_is_better",
      normalization: "percentile",
    },
  },
  climate: {
    key: "climate",
    label: "Climate",
    description:
      "How close the annual mean temperature is to the climate the user " +
      "asked for. Carries no weight when they stated no preference.",
    metric: {
      key: "annual_mean_temperature",
      label: "Annual mean temperature (1991-2020 normals)",
      unit: "degrees_fahrenheit",
      direction: "target_is_better",
      // No shared `target`: the band comes from the user's own answer, so a
      // single value here would be exactly the 57 °F assumption Phase 6A
      // removed. See lib/matching/climate.ts.
      normalization: "preference_band",
    },
  },
  safety: {
    key: "safety",
    label: "Safety",
    description:
      "Violent and property crime rates the FBI publishes for this entire " +
      "metropolitan area, compared with the other candidates. Describes a " +
      "metro, not a neighbourhood and not personal risk.",
    metric: {
      // The headline component. The property rate lives alongside it in
      // `metro_safety_stats`, so one shared metric key cannot describe both.
      key: "violent_crime_rate",
      label: "Violent crime rate (FBI, metropolitan statistical area)",
      unit: "per_100k",
      direction: "lower_is_better",
      normalization: "composite",
    },
  },
  family: {
    key: "family",
    label: "Family friendliness",
    description:
      "A DreamDestination composite of public-school availability, metro " +
      "safety, commute times and health-insurance coverage. Not an official " +
      "measure, and school counts describe availability rather than quality.",
    metric: {
      // The family-specific component. Its denominator and the three reused
      // dimensions live elsewhere, so this key names the lead measurement only.
      key: "public_schools_per_10k_school_age",
      label: "Public schools per 10,000 residents aged 5-17",
      unit: "index",
      direction: "higher_is_better",
      normalization: "composite",
    },
  },

  social: {
    key: "social",
    label: "Social life",
    description:
      "How many places to eat, drink, play, watch, shop and gather this " +
      "metro has, in the categories the user cares about, both in total and " +
      "per resident. Measures availability, never quality or popularity.",
    metric: {
      // The lead measurement. Per-category counts and rates live in
      // `metro_lifestyle_stats`, selected against the user's own preferences,
      // so one shared metric key cannot describe them all.
      key: "lifestyle_places_per_100k",
      label: "Places per 100,000 residents, across lifestyle categories",
      unit: "index",
      direction: "higher_is_better",
      normalization: "personalized_composite",
    },
  },
};

/** Dimensions that currently have a measurement behind them. */
export const SCORED_DIMENSIONS: PreferenceWeightKey[] =
  PREFERENCE_WEIGHT_KEYS.filter((key) => DIMENSIONS[key].metric !== null);

/** Dimensions a user can weight but which nothing can score yet. */
export const UNSCORED_DIMENSIONS: PreferenceWeightKey[] =
  PREFERENCE_WEIGHT_KEYS.filter((key) => DIMENSIONS[key].metric === null);

/** Look up the dimension a raw metric key feeds, or null if unknown. */
export function dimensionForMetricKey(
  metricKey: string,
): PreferenceWeightKey | null {
  for (const key of PREFERENCE_WEIGHT_KEYS) {
    if (DIMENSIONS[key].metric?.key === metricKey) {
      return key;
    }
  }
  return null;
}
