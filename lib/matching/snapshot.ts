/**
 * One scoring run, two views.
 *
 * "Recalculate best matches" runs the deterministic engine once and stores the
 * top RECOMMENDATION_SNAPSHOT_SIZE cities with their overall ranks. Everything
 * the matches page, the comparison and the advisor show is read back out of
 * that single stored snapshot:
 *
 *   ranks 1-5    the user's best matches
 *   ranks 6-10   other places worth exploring, if they meet
 *                MIN_ALTERNATIVE_DREAM_SCORE
 *
 * Splitting one stored snapshot, rather than scoring twice, means the two views
 * can never disagree about a score or an order, and exploring alternatives can
 * never change the best matches. Ranks are assigned by the engine before the
 * split, so an alternative keeps its true overall rank.
 *
 * Pure: no I/O, no clock, no randomness.
 */

/** Ranks shown as the user's best matches. */
export const PRIMARY_MATCH_COUNT = 5;

/** Ranks immediately after the best matches offered as alternatives. */
export const ALTERNATIVE_MATCH_COUNT = 5;

/** Cities stored per scoring run: the best matches plus the alternatives. */
export const RECOMMENDATION_SNAPSHOT_SIZE =
  PRIMARY_MATCH_COUNT + ALTERNATIVE_MATCH_COUNT;

/**
 * Lowest DreamScore (0-100) an alternative needs to be shown.
 *
 * Best matches are shown whatever they score: they are the strongest cities
 * available to this user. An alternative is a suggestion to look further, and
 * suggesting a weak fit would misrepresent it.
 *
 * Compared at full precision — the same precision ranking uses — so a score
 * that only rounds to the minimum for display (49.6 shown as 50) does not
 * qualify.
 */
export const MIN_ALTERNATIVE_DREAM_SCORE = 50;

/**
 * DreamScore (0-100) below which a best match is flagged as a weak fit.
 *
 * Best matches are never hidden for scoring low — they are the strongest cities
 * available to this user, however restrictive the profile — but presenting a
 * poor absolute fit without comment would overstate it. Kept equal to the
 * alternatives minimum, so "too weak to suggest as an alternative" and "a weak
 * best match" mean the same thing. Compared at full precision.
 */
export const WEAK_BEST_MATCH_DREAM_SCORE = MIN_ALTERNATIVE_DREAM_SCORE;

export const NO_ALTERNATIVES_MESSAGE =
  "We could not find additional cities that meet the minimum fit score. Try adjusting your priorities or housing budget.";

export const RECOMMENDATION_VIEWS = ["best", "alternatives"] as const;

export type RecommendationView = (typeof RECOMMENDATION_VIEWS)[number];

/**
 * Reads the `view` query parameter. Anything other than exactly
 * "alternatives" — absent, misspelled or repeated — is the best-matches view,
 * which is the safe default.
 */
export function parseRecommendationView(
  value: string | string[] | undefined,
): RecommendationView {
  return value === "alternatives" ? "alternatives" : "best";
}

/** The only fields the split needs, so it works on stored and fresh results. */
export interface SnapshotEntry {
  rank: number;
  /** DreamScore on 0-100, at full precision. */
  score: number;
}

export interface SnapshotPartition<T extends SnapshotEntry> {
  /** Ranks 1 to PRIMARY_MATCH_COUNT, in rank order. */
  primary: T[];
  /** Qualifying ranks after the best matches, in rank order. */
  alternatives: T[];
  /** Stored cities in the alternative rank range, before the score minimum. */
  alternativeCandidates: number;
  /** How many of those candidates scored below the minimum. */
  belowMinimumScore: number;
  /** The minimum that was applied. */
  minimumScore: number;
}

/**
 * Splits a stored snapshot into best matches and alternatives by rank.
 *
 * Input order is not trusted: rows are ordered by their stored rank first.
 * Ranks beyond RECOMMENDATION_SNAPSHOT_SIZE are ignored, so a snapshot saved
 * when more rows were stored still shows exactly ranks 6-10 as alternatives.
 */
export function partitionSnapshot<T extends SnapshotEntry>(
  entries: readonly T[],
  minimumScore: number = MIN_ALTERNATIVE_DREAM_SCORE,
): SnapshotPartition<T> {
  const ordered = [...entries].sort((a, b) => a.rank - b.rank);

  const primary = ordered.filter(
    (entry) => entry.rank >= 1 && entry.rank <= PRIMARY_MATCH_COUNT,
  );
  const candidates = ordered.filter(
    (entry) =>
      entry.rank > PRIMARY_MATCH_COUNT &&
      entry.rank <= RECOMMENDATION_SNAPSHOT_SIZE,
  );
  const alternatives = candidates.filter(
    (entry) => entry.score >= minimumScore,
  );

  return {
    primary,
    alternatives,
    alternativeCandidates: candidates.length,
    belowMinimumScore: candidates.length - alternatives.length,
    minimumScore,
  };
}

/** A short explanation shown alongside one of the views. */
export interface SnapshotNotice {
  message: string;
  /** Supporting reasons, each a full sentence. */
  details: string[];
}

function countOf(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Why fewer than ALTERNATIVE_MATCH_COUNT alternatives are shown, or null when
 * the full set is available.
 *
 * Only two things can shorten the list, and each is reported when it applies:
 * cities in the rank range that scored under the minimum, and fewer cities
 * ranked in that range at all. Nothing is ranked unless it passed the housing
 * budget filter and the data-coverage gate.
 */
export function describeAlternativesShortfall(
  partition: SnapshotPartition<SnapshotEntry>,
): SnapshotNotice | null {
  const shown = partition.alternatives.length;

  if (shown >= ALTERNATIVE_MATCH_COUNT) {
    return null;
  }

  const details: string[] = [];

  if (partition.belowMinimumScore > 0) {
    details.push(
      `${countOf(partition.belowMinimumScore, "city", "cities")} ranked just below your top ${PRIMARY_MATCH_COUNT} scored under the minimum DreamScore of ${partition.minimumScore}.`,
    );
  }

  if (partition.alternativeCandidates < ALTERNATIVE_MATCH_COUNT) {
    details.push(
      partition.alternativeCandidates === 0
        ? `Your saved results contain no cities ranked below your top ${PRIMARY_MATCH_COUNT}.`
        : `Your saved results contain only ${countOf(partition.alternativeCandidates, "city", "cities")} ranked below your top ${PRIMARY_MATCH_COUNT}.`,
      "Cities are ranked only when they fit your housing budget and enough of your priorities can be measured.",
    );

    // Results saved before this view existed held only the best matches.
    if (
      partition.alternativeCandidates === 0 &&
      partition.primary.length === PRIMARY_MATCH_COUNT
    ) {
      details.push(
        "If these results were saved before this view was available, recalculate your best matches to rank the next cities.",
      );
    }
  }

  return {
    message:
      shown === 0
        ? NO_ALTERNATIVES_MESSAGE
        : `Showing ${countOf(shown, "city", "cities")} instead of ${ALTERNATIVE_MATCH_COUNT}.`,
    details,
  };
}

/**
 * A warning when best matches are weak fits in absolute terms, or null when
 * every best match reaches WEAK_BEST_MATCH_DREAM_SCORE.
 *
 * Ranking is relative: rank 1 is the strongest available city even when it
 * lines up poorly with what the user asked for. This says so, without hiding
 * or reordering anything.
 */
export function describeWeakBestMatches(
  primary: readonly SnapshotEntry[],
  threshold: number = WEAK_BEST_MATCH_DREAM_SCORE,
): SnapshotNotice | null {
  const weak = primary.filter((entry) => entry.score < threshold).length;

  if (weak === 0) {
    return null;
  }

  return {
    message:
      weak === primary.length
        ? `None of your best matches reaches a DreamScore of ${threshold}.`
        : `${weak} of your ${primary.length} best matches score below ${threshold}.`,
    details: [
      "They are still the strongest cities available for your profile and priorities, but they line up weakly with what you asked for.",
      "A higher housing budget or different priorities may surface stronger fits.",
    ],
  };
}
