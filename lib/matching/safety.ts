import { percentileScore } from "@/lib/matching/normalization";
import type { CandidateCity, MetricSourceRef } from "@/lib/matching/types";

/**
 * Safety fit, from the FBI's own metropolitan-statistical-area crime rates.
 *
 * ---------------------------------------------------------------------------
 * What this is and is not
 * ---------------------------------------------------------------------------
 * A comparison between metros, on two rates the FBI publishes for entire
 * metropolitan areas. It is not a statement that a metro is safe, and it says
 * nothing about a neighbourhood, a street or an individual's risk — an MSA
 * spans millions of people and enormous internal variation. Every label and
 * explanation downstream is worded to keep that distinction.
 *
 * Pure and offline: it receives candidate cities that already carry their FBI
 * row and returns scores. No I/O, no clock, no randomness.
 */

/** The FBI's published rates for one metro. Either rate may be null. */
export interface MetroSafetyStats {
  /** The MSA name exactly as the FBI printed it. */
  fbiMetroName: string;
  dataYear: number;
  /** Offenses per 100,000 inhabitants. Null means the FBI published none. */
  violentCrimeRate: number | null;
  propertyCrimeRate: number | null;
  /** The FBI's own rate denominator for the metro. */
  sourcePopulation: number | null;
  /** Share of metro population covered by agencies that reported, 0-1. */
  reportingCoverage: number | null;
  /**
   * True when the FBI printed an "Estimated total" row, meaning the published
   * rate accounts for agencies that did not report a full year. The source's
   * own reported/estimated distinction, not ours.
   */
  isEstimated: boolean;
  source: MetricSourceRef | null;
}

export type SafetyComponentKey = "violentCrime" | "propertyCrime";

/**
 * Weights *inside* the safety dimension. These are not DreamScore weights.
 *
 * The user's own safety slider still decides how much safety matters overall;
 * these decide only what "safety" means once it does. Violent crime leads
 * because it is the harm people are actually weighing when they ask whether
 * somewhere is safe, and because property crime is far more common and would
 * otherwise dominate a combined figure by sheer volume.
 *
 * This split is a product-design choice, not an empirically derived one.
 */
export const SAFETY_COMPONENT_WEIGHTS: Record<SafetyComponentKey, number> = {
  violentCrime: 0.7,
  propertyCrime: 0.3,
};

export interface SafetyComponentScore {
  key: SafetyComponentKey;
  /** The published rate per 100,000. */
  rawValue: number;
  /** 0-100 against the other metros that published this rate. */
  score: number;
  /** Weight after renormalising over the components this metro has. */
  weight: number;
}

/** What the explanation layer needs to describe a safety score honestly. */
export interface SafetyDetail {
  kind: "safety";
  fbiMetroName: string;
  dataYear: number;
  violentCrimeRate: number | null;
  propertyCrimeRate: number | null;
  reportingCoverage: number | null;
  isEstimated: boolean;
  components: SafetyComponentScore[];
  /**
   * Share of the intended component weight that had a published rate behind
   * it. 1.0 means both rates were available.
   */
  coverage: number;
}

export interface SafetyScore {
  score: number;
  detail: SafetyDetail;
}

function usable(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/**
 * Scores safety for every candidate at once.
 *
 * Normalisation is relative to the eligible candidate set, exactly as for
 * every other dimension. Each component's population contains only the metros
 * that actually published that rate, so an unpublished rate neither becomes a
 * zero nor shifts anybody else's rank.
 *
 * Returns null for a metro with neither rate, which the caller treats as
 * missing data. A metro the FBI did not publish is never scored as safest
 * (rate 0) or as most dangerous — both would be inventions.
 */
export function scoreSafetyFit(
  cities: readonly CandidateCity[],
): Map<string, SafetyScore | null> {
  const populations: Record<SafetyComponentKey, number[]> = {
    violentCrime: [],
    propertyCrime: [],
  };
  const perCity = new Map<
    string,
    Partial<Record<SafetyComponentKey, number>>
  >();

  for (const city of cities) {
    const stats = city.safety;
    const values: Partial<Record<SafetyComponentKey, number>> = {};

    const violent = usable(stats?.violentCrimeRate);
    if (violent !== null) {
      values.violentCrime = violent;
      populations.violentCrime.push(violent);
    }

    const property = usable(stats?.propertyCrimeRate);
    if (property !== null) {
      values.propertyCrime = property;
      populations.propertyCrime.push(property);
    }

    perCity.set(city.id, values);
  }

  const results = new Map<string, SafetyScore | null>();

  for (const city of cities) {
    const stats = city.safety;
    const values = perCity.get(city.id) ?? {};
    const activeKeys = (
      Object.keys(SAFETY_COMPONENT_WEIGHTS) as SafetyComponentKey[]
    ).filter((key) => values[key] !== undefined);

    if (!stats || activeKeys.length === 0) {
      results.set(city.id, null);
      continue;
    }

    const availableWeight = activeKeys.reduce(
      (total, key) => total + SAFETY_COMPONENT_WEIGHTS[key],
      0,
    );

    let score = 0;
    const components: SafetyComponentScore[] = [];

    for (const key of activeKeys) {
      const rawValue = values[key]!;
      // Lower crime is a better outcome, so the percentile is inverted here
      // rather than the rate being negated somewhere upstream.
      const componentScore = percentileScore(
        rawValue,
        populations[key],
        "lower_is_better",
      );
      // Renormalised across what this metro actually has, so one unpublished
      // rate redistributes its weight instead of dragging the score down.
      const weight = SAFETY_COMPONENT_WEIGHTS[key] / availableWeight;

      score += componentScore * weight;
      components.push({ key, rawValue, score: componentScore, weight });
    }

    results.set(city.id, {
      score,
      detail: {
        kind: "safety",
        fbiMetroName: stats.fbiMetroName,
        dataYear: stats.dataYear,
        violentCrimeRate: usable(stats.violentCrimeRate),
        propertyCrimeRate: usable(stats.propertyCrimeRate),
        reportingCoverage: stats.reportingCoverage,
        isEstimated: stats.isEstimated,
        components,
        coverage: availableWeight,
      },
    });
  }

  return results;
}
