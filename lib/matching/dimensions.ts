import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import type { PreferenceWeightKey } from "@/types/profile";

/**
 * The metric registry: the single description of what each scoring dimension
 * measures, where the number comes from, and how it becomes a score.
 *
 * The dimension keys are exactly the ten weights onboarding already collects
 * (`PREFERENCE_WEIGHT_KEYS`). Nothing here invents a dimension.
 *
 * Three of the ten currently have no measured metric. That is recorded here
 * rather than papered over, because the missing-data policy needs to know the
 * difference between "we measured zero" and "we have nothing".
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
  | "target_distance";

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

/**
 * Climate target: 57 °F annual mean.
 *
 * This is a stated modelling assumption, not a measured fact — it is roughly
 * the middle of the range across US metros, so it reads as "temperate".
 * Onboarding does not currently ask which climate a user prefers, so a single
 * shared target is the honest choice; a per-user target belongs with a
 * future onboarding question.
 */
const CLIMATE_TARGET_FAHRENHEIT = 57;
const CLIMATE_TOLERANCE_FAHRENHEIT = 20;

export const DIMENSIONS: Record<PreferenceWeightKey, DimensionDefinition> = {
  career: {
    key: "career",
    label: "Career opportunity",
    description: "Share of the local labour force that is unemployed.",
    metric: {
      key: "unemployment_rate",
      label: "Unemployment rate",
      unit: "percent",
      direction: "lower_is_better",
      normalization: "percentile",
    },
  },
  housing: {
    key: "housing",
    label: "Housing",
    description: "Typical monthly rent, including utilities.",
    metric: {
      key: "median_gross_rent",
      label: "Median gross rent",
      unit: "usd_per_month",
      direction: "lower_is_better",
      normalization: "percentile",
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
    description: `How close the annual mean temperature is to ${CLIMATE_TARGET_FAHRENHEIT}°F.`,
    metric: {
      key: "annual_mean_temperature",
      label: "Annual mean temperature (1991-2020 normals)",
      unit: "degrees_fahrenheit",
      direction: "target_is_better",
      normalization: "target_distance",
      target: {
        value: CLIMATE_TARGET_FAHRENHEIT,
        tolerance: CLIMATE_TOLERANCE_FAHRENHEIT,
      },
    },
  },

  // --- dimensions with no credible measurement yet --------------------------

  safety: {
    key: "safety",
    label: "Safety",
    description: "Not scored yet — no metric is wired up.",
    metric: null,
    unavailableReason:
      "The FBI Crime Data Explorer API requires an api.data.gov key, which is not configured. Crime data is deliberately absent rather than approximated from a weaker source.",
  },
  social: {
    key: "social",
    label: "Social life",
    description: "Not scored yet — no metric is wired up.",
    metric: null,
    unavailableReason:
      "No authoritative federal dataset measures social opportunity at metro level. Proxies such as bar or restaurant counts would overstate what the data supports.",
  },
  family: {
    key: "family",
    label: "Family friendliness",
    description: "Not scored yet — no metric is wired up.",
    metric: null,
    unavailableReason:
      "Family friendliness has no single authoritative measure. Household-composition shares describe who already lives somewhere, not how well it suits a family.",
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
