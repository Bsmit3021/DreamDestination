import {
  percentileScore,
  winsorizedMinMaxScore,
} from "@/lib/matching/normalization";
import type { CandidateCity, MetricSourceRef } from "@/lib/matching/types";

/**
 * Career fit, scored for the user's own occupation.
 *
 * v1 scored every user on the metro-wide unemployment rate, so a nurse and a
 * software developer received identical career scores for the same city. The
 * app already knows the user's confirmed occupation and already stores the
 * May 2025 BLS OEWS metro estimates for it; this module puts those to work.
 *
 * Where BLS has published too little about the occupation, the score falls back
 * to the metro-wide labour market and is then discounted by an evidence
 * confidence factor, so a generic score cannot outrank an occupational one
 * purely on the strength of evidence the app does not have. See
 * `CAREER_EVIDENCE_CONFIDENCE`.
 *
 * Pure and offline: it receives candidate cities that already carry their OEWS
 * row and returns scores. No I/O, no clock, no randomness.
 */

/** The occupation a scoring run was asked about, when there is one. */
export interface OccupationTarget {
  socCode: string;
  title: string;
}

/** The OEWS estimates for one occupation in one metro. Any field may be null. */
export interface MetroOccupationStats {
  socCode: string;
  title: string;
  /** Total people employed in the occupation here. NOT job openings. */
  employment: number | null;
  /** Jobs in this occupation per 1,000 jobs in the metro. */
  employmentPer1000: number | null;
  /** Concentration versus the national average; 1.0 is typical. */
  locationQuotient: number | null;
  medianAnnualWage: number | null;
  /** True when BLS reported "#": at or above the top code. */
  wageTopCoded: boolean;
  period: string;
  source: MetricSourceRef | null;
}

export type CareerComponentKey =
  | "medianWage"
  | "locationQuotient"
  | "jobsPer1000"
  | "employmentDepth"
  | "generalLaborMarket";

/**
 * Weights *inside* the career dimension. These are not DreamScore weights.
 *
 * The user's own career slider still decides how much career matters overall;
 * these decide only what "career fit" means once it does. Keeping the two
 * apart is what stops a developer-chosen number from quietly overriding a
 * user-chosen one.
 *
 * Pay is the single component a mover can act on directly, so it leads.
 * Concentration and jobs-per-1,000 measure how much of the local economy is
 * this occupation, which is the closest available proxy for opportunity, and
 * are weighted equally because neither is clearly the better signal. Absolute
 * employment is worth something — a large market has more churn and more
 * employers — but it tracks metro size more than opportunity, so it is capped
 * low. The metro-wide labour market still matters a little: a strong
 * occupation inside a failing regional economy is a worse bet than the
 * occupational figures alone suggest.
 */
export const CAREER_COMPONENT_WEIGHTS: Record<CareerComponentKey, number> = {
  medianWage: 0.3,
  locationQuotient: 0.25,
  jobsPer1000: 0.25,
  employmentDepth: 0.1,
  generalLaborMarket: 0.1,
};

/**
 * The occupation-specific components. The general labour market is excluded
 * on purpose: it is identical for every occupation, so it can never be
 * evidence that a *particular* occupation is well supported here.
 */
export const OCCUPATION_SPECIFIC_COMPONENTS: CareerComponentKey[] = [
  "medianWage",
  "locationQuotient",
  "jobsPer1000",
  "employmentDepth",
];

/**
 * How many occupation-specific components must be present before the score is
 * allowed to call itself occupation-specific.
 *
 * BLS suppresses estimates that fail its publication criteria, so one field
 * missing is routine and must not disqualify a metro. One field surviving,
 * though, is a single data point carrying 100% of the weight after
 * renormalisation — that is not enough to claim the ranking reflects the
 * user's occupation, so those metros fall back to the general score instead.
 */
export const MIN_OCCUPATION_INDICATORS = 2;

/**
 * Which evidence a career score was actually built from.
 *
 * The two metro-wide bases score identically and differ only in *why* the
 * metro-wide labour market was used, which is the whole point of separating
 * them:
 *
 * - `occupation_specific` — the user named an occupation and BLS published
 *   enough about it here.
 * - `occupation_data_fallback` — the user named an occupation and BLS did not
 *   publish enough about it here, so generic evidence is standing in for the
 *   evidence that was actually wanted. A substitution.
 * - `general_labor_market` — the user named no occupation, so the metro-wide
 *   labour market *is* the intended measurement. Nothing is missing and nothing
 *   is being substituted.
 *
 * Extended rather than overloaded: a stored snapshot that predates this
 * distinction carries `general_labor_market` and keeps its original meaning of
 * "scored on the metro-wide labour market", which remains true.
 */
export type CareerBasis =
  "occupation_specific" | "occupation_data_fallback" | "general_labor_market";

/** True for the two bases scored on the metro-wide labour market. */
export function usesGeneralLaborMarket(basis: CareerBasis): boolean {
  return basis !== "occupation_specific";
}

/**
 * How much the app trusts a career score to describe *this user's occupation*.
 *
 * This is not a claim about the metro. A discounted score of 0.65 does not say
 * the labour market here is 35% worse — it says the app has substantially
 * weaker evidence that this labour market is good for the occupation the user
 * actually named. The two are different statements, and only the second one is
 * supported by the data.
 *
 * The discount applies to exactly one situation: the user asked about an
 * occupation and the app had to answer with something else. A user who named no
 * occupation is not in that situation. For them the metro-wide labour market is
 * the measurement they asked for, not a degraded stand-in for one, so there is
 * no missing evidence to discount — and discounting it anyway would quietly
 * shrink the career priority they explicitly set.
 *
 * It is deliberately not a probability or a statistical confidence interval.
 * There is no sampling model behind it and it should never be presented as one.
 * It is a ranking policy: a metro where BLS published enough about the user's
 * occupation should not have to compete on equal terms with a metro where the
 * app is really just quoting the unemployment rate.
 *
 * The problem it fixes is concrete. Scoring Registered Nurses across the 100
 * candidate metros, Durham led the field at 89.5 — on a `general_labor_market`
 * score, with no published RN wage at all — ahead of every metro that did
 * publish RN figures. The explanation disclosed the fallback, but the ranking
 * still presented generic evidence as if it were occupational evidence.
 *
 * Partial occupational coverage is explicitly *not* penalised here. A metro
 * that clears `MIN_OCCUPATION_INDICATORS` keeps a confidence of 1.0 even with a
 * suppressed field, because component-weight renormalisation already handles
 * that case and charging for it twice would punish metros for BLS's
 * publication rules. `coverage` reports it separately.
 */
export const CAREER_EVIDENCE_CONFIDENCE: Record<CareerBasis, number> = {
  occupation_specific: 1,
  occupation_data_fallback: 0.65,
  general_labor_market: 1,
};

export interface CareerComponentScore {
  key: CareerComponentKey;
  rawValue: number;
  /** 0-100 against the other eligible metros. */
  score: number;
  /** Weight after renormalising over the components this metro has. */
  weight: number;
}

/** What the explanation layer needs to describe a career score honestly. */
export interface CareerDetail {
  kind: "career";
  basis: CareerBasis;
  /** Present whenever the user has a confirmed occupation, even where BLS
   * published nothing for it in this metro. */
  occupation: OccupationTarget | null;
  components: CareerComponentScore[];
  /**
   * Share of the intended component weight that had data behind it.
   *
   * 1.0 means every component was available. Reported rather than hidden so a
   * partially-supported score is never presented as a complete one.
   */
  coverage: number;
  /** How many of the four occupation-specific components were usable. */
  occupationIndicators: number;
  /**
   * The career score before the evidence-confidence adjustment: how good this
   * labour market looks on whatever evidence was available.
   *
   * Kept alongside the effective score so the three questions stay separable —
   * how strong the labour market is (`rawScore`), how well the app can speak to
   * the user's occupation here (`evidenceConfidence`), and what actually ranked
   * the city (`CareerScore.score`). Persisted with the rest of the detail, so a
   * stored recommendation can still be explained later.
   */
  rawScore: number;
  /** See CAREER_EVIDENCE_CONFIDENCE. Not a probability. */
  evidenceConfidence: number;
  /**
   * True when BLS reported the wage as at-or-above its top code. The wage is
   * then genuinely absent, not low, and is excluded from scoring.
   */
  wageTopCoded: boolean;
  medianAnnualWage: number | null;
  employmentPer1000: number | null;
  locationQuotient: number | null;
  employment: number | null;
  unemploymentRate: number | null;
}

export interface CareerScore {
  /**
   * The effective career score, `rawScore × evidenceConfidence`. This is what
   * DreamScore consumes and what ranks the city.
   */
  score: number;
  detail: CareerDetail;
}

/**
 * Employment depth: `log1p(employment)`, winsorised min-max.
 *
 * Raw employment spans four orders of magnitude across the 100 metros, and
 * that spread is mostly metro size. Two decisions keep it from smuggling
 * population into the career score:
 *
 *  1. `log1p` before normalising. A metro with ten times the jobs is better
 *     placed, but not ten times better placed, and a log says exactly that.
 *     `log1p` rather than `log` so an employment of 0 — which OEWS does not
 *     publish, but which arithmetic should survive — stays defined.
 *  2. Winsorised min-max rather than percentile. Percentile rank is
 *     order-preserving, so it is completely blind to any monotone transform:
 *     applying log1p and then taking a percentile would give the identical
 *     answer to using raw employment, and the transformation would be
 *     decorative. Min-max is what makes the compression real, and winsorising
 *     at the 5th/95th percentiles stops the largest metro from setting the
 *     scale for everyone else.
 *
 * The component is also capped at 10% of the career score, so even where size
 * does help, it cannot decide the dimension.
 */
export function employmentDepthValue(employment: number): number {
  return Math.log1p(employment);
}

function usable(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Raw component values for one metro, before normalisation. */
function componentValues(
  city: CandidateCity,
): Partial<Record<CareerComponentKey, number>> {
  const values: Partial<Record<CareerComponentKey, number>> = {};
  const stats = city.career;

  if (stats) {
    // A top-coded wage is absent, not high: BLS says only "at or above
    // $239,200". Scoring it as if the top code were the median would invent a
    // figure, so it is treated as missing.
    const wage = stats.wageTopCoded ? null : usable(stats.medianAnnualWage);
    if (wage !== null) values.medianWage = wage;

    const lq = usable(stats.locationQuotient);
    if (lq !== null) values.locationQuotient = lq;

    const per1000 = usable(stats.employmentPer1000);
    if (per1000 !== null) values.jobsPer1000 = per1000;

    const employment = usable(stats.employment);
    if (employment !== null) {
      values.employmentDepth = employmentDepthValue(employment);
    }
  }

  const unemployment = usable(city.observations.career?.rawValue);
  if (unemployment !== null) values.generalLaborMarket = unemployment;

  return values;
}

function normalizeComponent(
  key: CareerComponentKey,
  value: number,
  population: readonly number[],
): number {
  switch (key) {
    case "employmentDepth":
      // See employmentDepthValue: min-max is what makes the log meaningful.
      return winsorizedMinMaxScore(value, population, "higher_is_better");
    case "generalLaborMarket":
      return percentileScore(value, population, "lower_is_better");
    default:
      // Percentile rank, the engine's default: robust to the long right tail
      // of metro wages and concentrations.
      return percentileScore(value, population, "higher_is_better");
  }
}

/**
 * Scores career fit for every candidate at once.
 *
 * Normalisation is relative to the eligible candidate set, exactly as for
 * every other dimension: a wage means nothing without the other metros to
 * compare it against. Each component's population contains only the metros
 * that actually published it, so a suppressed value neither becomes a zero nor
 * shifts anybody else's rank.
 *
 * `occupation` is the set-level fact that per-city data cannot supply: a city
 * with no OEWS row looks identical whether the user named an occupation BLS
 * suppressed here or named none at all, and those two cases must not be scored
 * the same way. It is passed rather than inferred because inferring it from
 * "does any city have a row" would misread the case that matters most — an
 * occupation so thinly published that no candidate metro carries it.
 *
 * Returns null for a metro with no career evidence at all — neither OEWS nor
 * an unemployment rate — which the caller treats as missing data.
 */
export function scoreCareerFit(
  cities: readonly CandidateCity[],
  occupation: OccupationTarget | null = null,
): Map<string, CareerScore | null> {
  const perCity = new Map<
    string,
    Partial<Record<CareerComponentKey, number>>
  >();
  const populations = new Map<CareerComponentKey, number[]>();

  for (const city of cities) {
    const values = componentValues(city);
    perCity.set(city.id, values);

    for (const [key, value] of Object.entries(values) as [
      CareerComponentKey,
      number,
    ][]) {
      const population = populations.get(key) ?? [];
      population.push(value);
      populations.set(key, population);
    }
  }

  const results = new Map<string, CareerScore | null>();

  for (const city of cities) {
    const values = perCity.get(city.id) ?? {};
    const stats = city.career;

    const occupationIndicators = OCCUPATION_SPECIFIC_COMPONENTS.filter(
      (key) => values[key] !== undefined,
    ).length;

    const useOccupation = occupationIndicators >= MIN_OCCUPATION_INDICATORS;

    // Below the evidence threshold the occupational figures are dropped
    // entirely rather than blended in at whatever weight survives: a score
    // resting on one published number should not be presented, or ranked, as
    // if it described the user's occupation.
    const activeKeys = (
      useOccupation
        ? (Object.keys(CAREER_COMPONENT_WEIGHTS) as CareerComponentKey[])
        : (["generalLaborMarket"] as CareerComponentKey[])
    ).filter((key) => values[key] !== undefined);

    if (activeKeys.length === 0) {
      results.set(city.id, null);
      continue;
    }

    const availableWeight = activeKeys.reduce(
      (total, key) => total + CAREER_COMPONENT_WEIGHTS[key],
      0,
    );

    let rawScore = 0;
    const components: CareerComponentScore[] = [];

    for (const key of activeKeys) {
      const rawValue = values[key]!;
      const population = populations.get(key)!;
      const componentScore = normalizeComponent(key, rawValue, population);
      // Renormalised across what this metro actually has, so a suppressed
      // field redistributes its weight instead of dragging the score down.
      const weight = CAREER_COMPONENT_WEIGHTS[key] / availableWeight;

      rawScore += componentScore * weight;
      components.push({ key, rawValue, score: componentScore, weight });
    }

    const intendedWeight = useOccupation
      ? 1
      : CAREER_COMPONENT_WEIGHTS.generalLaborMarket;

    // Three cases, not two. Falling back because BLS published too little
    // about a *requested* occupation is a substitution; scoring the metro-wide
    // labour market because no occupation was requested is the intended
    // measurement.
    const basis: CareerBasis = useOccupation
      ? "occupation_specific"
      : occupation
        ? "occupation_data_fallback"
        : "general_labor_market";

    // Applied last, to the finished score rather than to any component, so it
    // cannot interact with renormalisation: the shape of the occupational
    // formula is untouched and only the fallback branch is discounted.
    const evidenceConfidence = CAREER_EVIDENCE_CONFIDENCE[basis];

    results.set(city.id, {
      score: rawScore * evidenceConfidence,
      detail: {
        kind: "career",
        basis,
        // The requested occupation, even where this metro published nothing
        // for it — that is precisely the case the explanation has to name.
        occupation: stats
          ? { socCode: stats.socCode, title: stats.title }
          : occupation,
        components,
        coverage: availableWeight / intendedWeight,
        occupationIndicators,
        rawScore,
        evidenceConfidence,
        wageTopCoded: stats?.wageTopCoded ?? false,
        medianAnnualWage: stats?.wageTopCoded
          ? null
          : usable(stats?.medianAnnualWage),
        employmentPer1000: usable(stats?.employmentPer1000),
        locationQuotient: usable(stats?.locationQuotient),
        employment: usable(stats?.employment),
        unemploymentRate: usable(city.observations.career?.rawValue),
      },
    });
  }

  return results;
}
