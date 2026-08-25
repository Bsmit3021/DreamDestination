import { percentileScore } from "@/lib/matching/normalization";
import type { CandidateCity, MetricSourceRef } from "@/lib/matching/types";
import type { LifestyleCategory } from "@/types/profile";

/**
 * Lifestyle fit, from Overture Maps place counts inside each metro's official
 * CBSA polygon.
 *
 * ---------------------------------------------------------------------------
 * What this measures
 * ---------------------------------------------------------------------------
 * How many places of a given kind exist in a metro, and how many that is per
 * resident. **Availability and breadth — nothing else.** It says nothing about
 * whether the venues are good, popular, well reviewed, currently open, or
 * within walking distance of wherever the user would actually live. A metro is
 * a large area containing dense and sparse parts, and a count over the whole
 * of it cannot speak to any one neighbourhood.
 *
 * Pure and offline: it receives candidate cities that already carry their
 * counts and returns scores. No I/O, no clock, no randomness, and no places
 * API is ever called at request time.
 */

/** One category's measurement for one metro. */
export interface MetroLifestyleCategoryStat {
  category: LifestyleCategory;
  /** Distinct Overture place ids inside the CBSA polygon. Zero is real. */
  placeCount: number;
  population: number;
  placesPer100k: number;
}

/** Every lifestyle measurement for one metro. */
export interface MetroLifestyleStats {
  sourceRelease: string;
  taxonomyMappingVersion: string;
  extractedOn: string;
  categories: MetroLifestyleCategoryStat[];
  source: MetricSourceRef | null;
}

/**
 * Weights *inside* a lifestyle category score. These are not DreamScore
 * weights.
 *
 * Breadth is how many places exist; relative availability is how many there
 * are per resident. Both matter and they disagree: raw counts alone would let
 * New York, Los Angeles and Chicago win every category simply for being large,
 * while per-capita alone would hand every category to whichever small metro
 * happens to have a high ratio. Weighting availability higher keeps the score
 * about what a resident can reach rather than about metro size, while breadth
 * still rewards the genuine variety only a bigger place can offer.
 *
 * The 40/60 split is a product-design choice, not an empirically learned or
 * validated coefficient, and must never be presented as one.
 */
export const LIFESTYLE_BREADTH_WEIGHT = 0.4;
export const LIFESTYLE_PER_CAPITA_WEIGHT = 0.6;

/** Which evidence a lifestyle score was built from. */
export type LifestyleBasis = "personalized_lifestyle" | "general_lifestyle";

export interface LifestyleCategoryScore {
  category: LifestyleCategory;
  placeCount: number;
  placesPer100k: number;
  /** 0-100 against the other metros publishing this category. */
  breadthPercentile: number;
  perCapitaPercentile: number;
  /** 0.40 x breadth + 0.60 x per-capita. */
  score: number;
}

/** What the explanation layer needs to describe a lifestyle score honestly. */
export interface LifestyleDetail {
  kind: "lifestyle";
  basis: LifestyleBasis;
  /** The categories the user asked about, when they asked about any. */
  requestedCategories: LifestyleCategory[];
  /** The categories actually scored, in registry order. */
  categories: LifestyleCategoryScore[];
  sourceRelease: string;
  taxonomyMappingVersion: string;
  /**
   * Share of the requested category weight that had usable evidence.
   *
   * A measured count of zero is evidence, not a gap: a metro with no comedy
   * clubs has been measured, not missed. Only a category the extraction could
   * not produce at all reduces this.
   */
  coverage: number;
  /** The mean before the evidence adjustment. */
  rawScore: number;
  /** Equals `coverage`. Not a probability, not a statistical confidence. */
  evidenceConfidence: number;
}

export interface LifestyleScore {
  /**
   * The effective lifestyle score, `rawScore × evidenceConfidence`. This is
   * what DreamScore consumes and what ranks the city.
   */
  score: number;
  detail: LifestyleDetail;
}

/**
 * Scores lifestyle fit for every candidate at once.
 *
 * Normalisation is relative to the eligible candidate set, exactly as for
 * every other dimension. Each category's two populations contain only the
 * metros that actually have a measurement for it, so a missing category
 * neither becomes a zero nor shifts anybody else's rank.
 *
 * `requested` is the user's own selection. An empty or null selection is a
 * real answer — "no particular preference" — and is scored on the full
 * supported mix under the `general_lifestyle` basis rather than penalised, in
 * exactly the way `general_labor_market` is the intended answer for a user who
 * named no occupation.
 *
 * Returns null for a metro with no usable lifestyle evidence at all.
 */
export function scoreLifestyleFit(
  cities: readonly CandidateCity[],
  requested: readonly LifestyleCategory[] | null,
): Map<string, LifestyleScore | null> {
  // Populations first: a percentile only means something against the same
  // category measured across every other candidate.
  const counts = new Map<LifestyleCategory, number[]>();
  const rates = new Map<LifestyleCategory, number[]>();

  for (const city of cities) {
    for (const stat of city.lifestyle?.categories ?? []) {
      if (!Number.isFinite(stat.placeCount)) continue;
      if (!Number.isFinite(stat.placesPer100k)) continue;

      counts.set(stat.category, [
        ...(counts.get(stat.category) ?? []),
        stat.placeCount,
      ]);
      rates.set(stat.category, [
        ...(rates.get(stat.category) ?? []),
        stat.placesPer100k,
      ]);
    }
  }

  // The categories a "broad mix" covers: everything actually measured across
  // the candidate set, so narrowing the mapping narrows the general basis too.
  const supported = [...counts.keys()].sort();

  const selected =
    requested && requested.length > 0 ? [...requested].sort() : null;
  const basis: LifestyleBasis = selected
    ? "personalized_lifestyle"
    : "general_lifestyle";
  const target = selected ?? supported;

  const results = new Map<string, LifestyleScore | null>();

  for (const city of cities) {
    const stats = city.lifestyle;
    if (!stats) {
      results.set(city.id, null);
      continue;
    }

    const byCategory = new Map(
      stats.categories.map((stat) => [stat.category, stat]),
    );

    const scored: LifestyleCategoryScore[] = [];

    for (const category of target) {
      const stat = byCategory.get(category);
      const countPopulation = counts.get(category);
      const ratePopulation = rates.get(category);

      // No measurement for this category in this metro: excluded from the mean
      // and counted against coverage. A measured zero is not this case — it
      // has a stat and scores on its merits.
      if (!stat || !countPopulation || !ratePopulation) continue;

      const breadthPercentile = percentileScore(
        stat.placeCount,
        countPopulation,
        "higher_is_better",
      );
      const perCapitaPercentile = percentileScore(
        stat.placesPer100k,
        ratePopulation,
        "higher_is_better",
      );

      scored.push({
        category,
        placeCount: stat.placeCount,
        placesPer100k: stat.placesPer100k,
        breadthPercentile,
        perCapitaPercentile,
        score:
          breadthPercentile * LIFESTYLE_BREADTH_WEIGHT +
          perCapitaPercentile * LIFESTYLE_PER_CAPITA_WEIGHT,
      });
    }

    if (scored.length === 0) {
      results.set(city.id, null);
      continue;
    }

    // Equal weight across the selected categories: the UI collects which
    // categories matter, not how much each one matters relative to the others,
    // and inventing a strength the user never expressed would put words in
    // their mouth.
    const rawScore =
      scored.reduce((total, entry) => total + entry.score, 0) / scored.length;

    const coverage = scored.length / target.length;

    results.set(city.id, {
      score: rawScore * coverage,
      detail: {
        kind: "lifestyle",
        basis,
        requestedCategories: selected ?? [],
        categories: scored,
        sourceRelease: stats.sourceRelease,
        taxonomyMappingVersion: stats.taxonomyMappingVersion,
        coverage,
        rawScore,
        evidenceConfidence: coverage,
      },
    });
  }

  return results;
}
