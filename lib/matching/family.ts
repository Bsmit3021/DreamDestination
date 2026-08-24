import { percentileScore } from "@/lib/matching/normalization";
import type { CandidateCity, MetricSourceRef } from "@/lib/matching/types";

/**
 * Family fit: DreamDestination's own transparent composite.
 *
 * ---------------------------------------------------------------------------
 * What this is
 * ---------------------------------------------------------------------------
 * There is no official government "family friendliness" statistic, and this is
 * not one. It is an aggregation of four conditions that plausibly matter to a
 * household with children, each of which comes from a published federal
 * source, combined with weights chosen by product judgement:
 *
 *   50%  public-school availability   NCES EDGE + ACS B01001
 *   30%  safety                       FBI CIUS Table 6, via Safety Fit
 *   10%  commute                      ACS mean travel time to work
 *   10%  healthcare                   ACS uninsured share
 *
 * The 50/30/10/10 split is a design decision, not an empirically learned or
 * validated model. Nothing here should be presented as scientifically optimal.
 *
 * ---------------------------------------------------------------------------
 * School availability is not school quality
 * ---------------------------------------------------------------------------
 * The school component counts how many public schools exist per 10,000
 * school-age residents. NCES EDGE publishes locations. It does not publish
 * quality, achievement, test scores, rankings or anything about teaching, and
 * no label in this codebase may imply otherwise.
 *
 * ---------------------------------------------------------------------------
 * Evidence confidence
 * ---------------------------------------------------------------------------
 * Renormalising over the surviving components produces the best estimate the
 * available evidence supports — but it lands on the same 0-100 axis as a fully
 * covered metro, which makes the two look comparable when they are not.
 *
 * The real case: Grand Rapids scored 92.6 against Madison's 93.8, but the FBI
 * published no 2025 MSA estimate for Grand Rapids, so its composite was really
 * 71.4% school access / 14.3% commute / 14.3% healthcare rather than the
 * intended 50/30/10/10. A near-identical number, resting on 70% of the
 * intended evidence.
 *
 * So the composite is multiplied by the share of intended weight that actually
 * had data:
 *
 *   evidenceConfidence = coverage
 *   effectiveScore     = rawScore × evidenceConfidence
 *
 * `evidenceConfidence` is **not** a statistical confidence, a probability, a
 * claim about how family-friendly the metro is, or a claim that a metro
 * missing FBI data is unsafe. It answers exactly one question: what share of
 * the evidence this composite is supposed to use was available here. Grand
 * Rapids at 92.6 × 0.70 = 64.8 means the intended evidence was incomplete, not
 * that the metro was measured to be 30% worse.
 *
 * A fully covered metro has `coverage = 1`, so its score is numerically
 * unchanged.
 *
 * ---------------------------------------------------------------------------
 * Overlap with other dimensions is deliberate
 * ---------------------------------------------------------------------------
 * Safety, commute and healthcare are also scored as standalone dimensions. A
 * user who weights both Safety and Family therefore counts safety twice — once
 * directly and once inside this composite. That is intended: they told us both
 * things matter. The alternative, silently removing a component because it
 * appears elsewhere, would mean a user's stated priorities no longer add up to
 * what they asked for.
 *
 * Pure and offline. No I/O, no clock, no randomness.
 */

/** NCES school counts and the ACS denominator for one metro. */
export interface MetroSchoolStats {
  schoolYear: string;
  /** Distinct public schools located in this metro. Zero is a real count. */
  publicSchoolCount: number;
  /** ACS population aged 5-17. Null when unpublished. */
  schoolAgePopulation: number | null;
  populationPeriod: string;
  source: MetricSourceRef | null;
}

export type FamilyComponentKey =
  "schoolAccess" | "safety" | "commute" | "healthcare";

/**
 * Weights *inside* the family dimension. These are not DreamScore weights.
 *
 * The user's own family slider still decides how much family friendliness
 * matters overall; these decide only what it means once it does.
 */
export const FAMILY_COMPONENT_WEIGHTS: Record<FamilyComponentKey, number> = {
  schoolAccess: 0.5,
  safety: 0.3,
  commute: 0.1,
  healthcare: 0.1,
};

/**
 * The components that can stand in for a missing one.
 *
 * School access cannot: it is the only family-specific signal in this
 * composite, and a "family fit" computed purely from safety, commute and
 * healthcare would just be a rename of three dimensions the user already
 * weights separately. See `scoreFamilyFit`.
 */
export const FAMILY_SECONDARY_COMPONENTS: FamilyComponentKey[] = [
  "safety",
  "commute",
  "healthcare",
];

/** Schools are counted per this many school-age residents. */
export const SCHOOL_ACCESS_PER = 10_000;

export interface FamilyComponentScore {
  key: FamilyComponentKey;
  /** 0-100 against the other candidates. */
  score: number;
  /** Weight after renormalising over the components this metro has. */
  weight: number;
}

export interface FamilyDetail {
  kind: "family";
  schoolYear: string;
  publicSchoolCount: number;
  schoolAgePopulation: number | null;
  /** Public schools per 10,000 residents aged 5-17. */
  schoolsPer10kSchoolAge: number;
  components: FamilyComponentScore[];
  /**
   * Share of the intended component weight that had data behind it.
   *
   * 1.0 means all four components were available. 0.7 means safety was
   * missing, 0.9 means commute or healthcare was.
   */
  coverage: number;
  /**
   * The composite before the evidence adjustment: the best estimate the
   * available components support, on the renormalised 50/30/10/10 axis.
   *
   * Kept alongside the effective score so "what the available evidence says"
   * stays separable from "how much of the intended evidence there was".
   */
  rawScore: number;
  /** See FAMILY evidence confidence below. Equals `coverage`. Not a probability. */
  evidenceConfidence: number;
}

export interface FamilyScore {
  /**
   * The effective family score, `rawScore × evidenceConfidence`. This is what
   * DreamScore consumes and what ranks the city.
   */
  score: number;
  detail: FamilyDetail;
}

/**
 * Public schools per 10,000 residents aged 5-17.
 *
 * Null rather than Infinity or zero when the denominator is missing or not
 * positive: a metro whose school-age population the ACS did not publish has an
 * unknown access rate, which is not the same as having no schools.
 */
export function schoolAccessRate(
  stats: MetroSchoolStats | null,
): number | null {
  if (!stats) return null;

  const population = stats.schoolAgePopulation;
  if (population === null || !Number.isFinite(population) || population <= 0) {
    return null;
  }
  if (
    !Number.isFinite(stats.publicSchoolCount) ||
    stats.publicSchoolCount < 0
  ) {
    return null;
  }

  return (stats.publicSchoolCount / population) * SCHOOL_ACCESS_PER;
}

/** The already-scored dimensions Family Fit reuses rather than recomputing. */
export interface FamilyInputs {
  /** Safety Fit for this metro, from lib/matching/safety.ts. */
  safetyScore: number | null;
  /** Commute score, 0-100, already normalised lower-is-better. */
  commuteScore: number | null;
  /** Healthcare score, 0-100, already normalised lower-is-better. */
  healthcareScore: number | null;
}

/**
 * Scores family fit for every candidate at once.
 *
 * Safety, commute and healthcare are passed in already scored rather than
 * recomputed here: recomputing safety would risk the two dimensions drifting
 * apart, and duplicating the commute or healthcare normalisation would mean
 * two definitions of the same number.
 *
 * The returned `score` is the effective score — the renormalised composite
 * scaled by how much of the intended evidence was available. `detail.rawScore`
 * keeps the unscaled estimate.
 *
 * Returns null when school access is unavailable, or when no secondary
 * component is available to accompany it.
 */
export function scoreFamilyFit(
  cities: readonly CandidateCity[],
  inputs: ReadonlyMap<string, FamilyInputs>,
): Map<string, FamilyScore | null> {
  // Access rates are ranked against each other, so the population is built
  // first across every metro that has one.
  const rates = new Map<string, number>();
  for (const city of cities) {
    const rate = schoolAccessRate(city.schools ?? null);
    if (rate !== null) rates.set(city.id, rate);
  }
  const ratePopulation = [...rates.values()];

  const results = new Map<string, FamilyScore | null>();

  for (const city of cities) {
    const stats = city.schools ?? null;
    const rate = rates.get(city.id);
    const input = inputs.get(city.id);

    // School access is mandatory. Without it there is no family-specific
    // evidence, and the remaining components are dimensions the user already
    // scores individually — combining them and calling the result "family fit"
    // would be presenting a relabelling as a measurement.
    if (!stats || rate === undefined) {
      results.set(city.id, null);
      continue;
    }

    const available: { key: FamilyComponentKey; score: number }[] = [
      {
        key: "schoolAccess",
        score: percentileScore(rate, ratePopulation, "higher_is_better"),
      },
    ];

    if (input?.safetyScore !== null && input?.safetyScore !== undefined) {
      available.push({ key: "safety", score: input.safetyScore });
    }
    if (input?.commuteScore !== null && input?.commuteScore !== undefined) {
      available.push({ key: "commute", score: input.commuteScore });
    }
    if (
      input?.healthcareScore !== null &&
      input?.healthcareScore !== undefined
    ) {
      available.push({ key: "healthcare", score: input.healthcareScore });
    }

    // At least one secondary component must survive, so a family score is
    // never school access wearing a different name.
    if (available.length < 2) {
      results.set(city.id, null);
      continue;
    }

    const availableWeight = available.reduce(
      (total, component) => total + FAMILY_COMPONENT_WEIGHTS[component.key],
      0,
    );

    let rawScore = 0;
    const components: FamilyComponentScore[] = [];

    for (const component of available) {
      const weight = FAMILY_COMPONENT_WEIGHTS[component.key] / availableWeight;
      rawScore += component.score * weight;
      components.push({ key: component.key, score: component.score, weight });
    }

    // Applied last, to the finished composite rather than to any component, so
    // renormalisation still produces the best estimate the available evidence
    // supports and only its ranking influence is reduced.
    const evidenceConfidence = availableWeight;

    results.set(city.id, {
      score: rawScore * evidenceConfidence,
      detail: {
        kind: "family",
        schoolYear: stats.schoolYear,
        publicSchoolCount: stats.publicSchoolCount,
        schoolAgePopulation: stats.schoolAgePopulation,
        schoolsPer10kSchoolAge: rate,
        components,
        coverage: availableWeight,
        rawScore,
        evidenceConfidence,
      },
    });
  }

  return results;
}
