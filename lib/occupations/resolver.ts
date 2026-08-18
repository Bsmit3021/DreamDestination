import { normalizeTitle, tokenOverlap } from "@/lib/occupations/normalize";

/**
 * Deterministic occupation resolution: free-text job title -> SOC code.
 *
 * No model decides this. The same query against the same title index always
 * produces the same ranked candidates, and every candidate carries the reason
 * it matched so a weak guess can be recognised as one.
 *
 * The engine is pure — it takes the title index as an argument — so the whole
 * matching policy is testable without a database.
 */

export type OccupationMatchMethod =
  /** The query equals an official O*NET title once normalised. */
  | "exact"
  /** The query equals a published alternate/lay title for the occupation. */
  | "alternate_title"
  /** Partial word overlap with a title. Weakest signal. */
  | "token_overlap";

/** One title in the searchable index. */
export interface OccupationTitleEntry {
  socCode: string;
  /** The official SOC title, used for display. */
  socTitle: string;
  /** This particular title variant (primary or alternate). */
  title: string;
  normalizedTitle: string;
  kind: "primary" | "alternate" | "reported";
}

export interface OccupationCandidate {
  socCode: string;
  title: string;
  /** The title variant that produced the match. */
  matchedTitle: string;
  confidence: number;
  matchType: OccupationMatchMethod;
}

/**
 * What the caller should do with the result.
 *
 * Thresholds are policy, not arithmetic, so they live here as named constants
 * and are asserted directly in the tests.
 */
export type OccupationResolutionAction =
  /** Unambiguous and strong: safe to use without asking. */
  | "auto_accept"
  /** Plausible but not certain: show it and ask the user to confirm. */
  | "confirm"
  /** Too weak or too contested: make the user choose. */
  | "select";

/** At or above this, a single clear winner may be accepted automatically. */
export const AUTO_ACCEPT_CONFIDENCE = 0.85;

/** Below this, the match is too weak to present as a suggestion. */
export const CONFIRM_CONFIDENCE = 0.6;

/**
 * Minimum lead the best candidate needs over the runner-up to count as
 * unambiguous. Without this, "engineer" — which matches many occupations almost
 * equally — could be auto-accepted as whichever one happened to sort first.
 */
export const AMBIGUITY_MARGIN = 0.15;

export const MAX_CANDIDATES = 5;

/** Confidence awarded to an exact match on an official title. */
const EXACT_CONFIDENCE = 1;

/**
 * Confidence for an exact match on an alternate title. Below `exact` because
 * alternate titles are contributed lay terms, but still above the auto-accept
 * threshold: "programmer" really does mean the occupation it is filed under.
 */
const ALTERNATE_CONFIDENCE = 0.9;

/**
 * Token-overlap matches are scaled below the confirm threshold's ceiling so a
 * partial word match can never masquerade as an exact one. A full overlap
 * ("software developer" vs "software developers") lands at 0.8 — strong enough
 * to suggest, never strong enough to auto-accept silently.
 */
const TOKEN_OVERLAP_CEILING = 0.8;

export interface OccupationResolution {
  query: string;
  normalizedQuery: string;
  candidates: OccupationCandidate[];
  action: OccupationResolutionAction;
  /** True when the top two candidates are too close to separate. */
  ambiguous: boolean;
}

function bestPerSoc(candidates: OccupationCandidate[]): OccupationCandidate[] {
  const best = new Map<string, OccupationCandidate>();

  for (const candidate of candidates) {
    const existing = best.get(candidate.socCode);
    if (!existing || candidate.confidence > existing.confidence) {
      best.set(candidate.socCode, candidate);
    }
  }

  return [...best.values()];
}

/**
 * Ranks occupations for a free-text query.
 *
 * @param query   what the user typed, e.g. "software engineer"
 * @param index   every searchable title variant
 */
export function resolveOccupation(
  query: string,
  index: readonly OccupationTitleEntry[],
): OccupationResolution {
  const normalizedQuery = normalizeTitle(query);

  if (normalizedQuery.length === 0) {
    return {
      query,
      normalizedQuery,
      candidates: [],
      action: "select",
      ambiguous: false,
    };
  }

  const matches: OccupationCandidate[] = [];

  for (const entry of index) {
    let confidence = 0;
    let matchType: OccupationMatchMethod = "token_overlap";

    if (entry.normalizedTitle === normalizedQuery) {
      confidence =
        entry.kind === "primary" ? EXACT_CONFIDENCE : ALTERNATE_CONFIDENCE;
      matchType = entry.kind === "primary" ? "exact" : "alternate_title";
    } else {
      const overlap = tokenOverlap(normalizedQuery, entry.normalizedTitle);
      if (overlap > 0) {
        confidence = overlap * TOKEN_OVERLAP_CEILING;
        matchType = "token_overlap";
      }
    }

    if (confidence > 0) {
      matches.push({
        socCode: entry.socCode,
        title: entry.socTitle,
        matchedTitle: entry.title,
        confidence,
        matchType,
      });
    }
  }

  // One entry per occupation — a SOC code matching on five alternate titles is
  // not five results — then a stable order so equal scores never shuffle.
  //
  // Match type breaks ties before the title does. Sorting equal-confidence
  // results alphabetically alone let an unrelated occupation that happened to
  // start with "A" outrank a genuine match.
  const methodRank: Record<OccupationMatchMethod, number> = {
    exact: 0,
    alternate_title: 1,
    token_overlap: 2,
  };

  const candidates = bestPerSoc(matches)
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        methodRank[a.matchType] - methodRank[b.matchType] ||
        // Shorter official titles are the more general occupation, which is the
        // better default when nothing else separates two candidates.
        a.title.length - b.title.length ||
        a.title.localeCompare(b.title) ||
        a.socCode.localeCompare(b.socCode),
    )
    .slice(0, MAX_CANDIDATES);

  const top = candidates[0];
  const runnerUp = candidates[1];

  const ambiguous =
    top !== undefined &&
    runnerUp !== undefined &&
    top.confidence - runnerUp.confidence < AMBIGUITY_MARGIN;

  let action: OccupationResolutionAction;

  if (!top || top.confidence < CONFIRM_CONFIDENCE) {
    action = "select";
  } else if (top.confidence >= AUTO_ACCEPT_CONFIDENCE && !ambiguous) {
    action = "auto_accept";
  } else {
    action = "confirm";
  }

  return { query, normalizedQuery, candidates, action, ambiguous };
}
