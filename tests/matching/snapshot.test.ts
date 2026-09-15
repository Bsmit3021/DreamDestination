import { describe, expect, it } from "vitest";

import { generateMatches } from "@/lib/matching/ranking";
import {
  ALTERNATIVE_MATCH_COUNT,
  MIN_ALTERNATIVE_DREAM_SCORE,
  NO_ALTERNATIVES_MESSAGE,
  PRIMARY_MATCH_COUNT,
  RECOMMENDATION_SNAPSHOT_SIZE,
  WEAK_BEST_MATCH_DREAM_SCORE,
  describeAlternativesShortfall,
  describeWeakBestMatches,
  parseRecommendationView,
  partitionSnapshot,
} from "@/lib/matching/snapshot";

import { cityWith, testProfile, weightsWith } from "./fixtures";

interface Entry {
  id: string;
  rank: number;
  score: number;
}

/** A snapshot whose i-th score belongs to overall rank i + 1. */
function snapshotOf(scores: number[]): Entry[] {
  return scores.map((score, index) => ({
    id: `city-${index + 1}`,
    rank: index + 1,
    score,
  }));
}

const ALL_STRONG = [95, 92, 90, 88, 85, 80, 75, 70, 65, 60];

describe("snapshot constants", () => {
  it("stores the best matches plus the alternatives from one run", () => {
    expect(PRIMARY_MATCH_COUNT).toBe(5);
    expect(ALTERNATIVE_MATCH_COUNT).toBe(5);
    expect(RECOMMENDATION_SNAPSHOT_SIZE).toBe(10);
    expect(MIN_ALTERNATIVE_DREAM_SCORE).toBe(50);
  });
});

describe("parseRecommendationView", () => {
  it("recognises the alternatives view", () => {
    expect(parseRecommendationView("alternatives")).toBe("alternatives");
  });

  it.each([undefined, "", "best", "ALTERNATIVES", "surprise"])(
    "treats %j as the best-matches view",
    (value) => {
      expect(parseRecommendationView(value)).toBe("best");
    },
  );

  it("treats a repeated parameter as the best-matches view", () => {
    expect(parseRecommendationView(["alternatives", "alternatives"])).toBe(
      "best",
    );
  });
});

describe("partitionSnapshot", () => {
  it("puts ranks 1-5, and only those, in the best matches", () => {
    const { primary } = partitionSnapshot(snapshotOf(ALL_STRONG));

    expect(primary.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps each alternative's overall rank 6-10 and never repeats a best match", () => {
    const { primary, alternatives } = partitionSnapshot(snapshotOf(ALL_STRONG));

    expect(alternatives.map((entry) => entry.rank)).toEqual([6, 7, 8, 9, 10]);

    const primaryIds = new Set(primary.map((entry) => entry.id));
    for (const alternative of alternatives) {
      expect(primaryIds.has(alternative.id)).toBe(false);
    }
    expect(
      new Set([...primary, ...alternatives].map((entry) => entry.id)).size,
    ).toBe(10);
  });

  it("orders by stored rank, not by the order rows arrived in", () => {
    const ordered = snapshotOf(ALL_STRONG);
    const shuffled = [...ordered].reverse();

    expect(partitionSnapshot(shuffled)).toEqual(partitionSnapshot(ordered));
  });

  it("applies the minimum DreamScore to alternatives only, inclusively", () => {
    // Best match 5 scores below the minimum and is still a best match.
    const partition = partitionSnapshot(
      snapshotOf([90, 80, 70, 60, 40, 70, 55, 50, 49.99, 30]),
    );

    expect(partition.primary.map((entry) => entry.rank)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(partition.alternatives.map((entry) => entry.rank)).toEqual([
      6, 7, 8,
    ]);
    expect(partition.alternativeCandidates).toBe(5);
    expect(partition.belowMinimumScore).toBe(2);
    expect(partition.minimumScore).toBe(MIN_ALTERNATIVE_DREAM_SCORE);
  });

  it("accepts a different minimum without changing the default", () => {
    const partition = partitionSnapshot(snapshotOf(ALL_STRONG), 72);

    expect(partition.alternatives.map((entry) => entry.rank)).toEqual([6, 7]);
    expect(partition.minimumScore).toBe(72);
  });

  it("ignores ranks beyond the snapshot size in an older, larger snapshot", () => {
    const partition = partitionSnapshot(snapshotOf([...ALL_STRONG, 58, 57]));

    expect(partition.alternatives.map((entry) => entry.rank)).toEqual([
      6, 7, 8, 9, 10,
    ]);
    expect(partition.alternativeCandidates).toBe(5);
  });

  it("splits the engine's ranking after ranks are assigned", () => {
    const cities = Array.from({ length: 15 }, (_, index) =>
      cityWith(
        `00000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`,
        {
          housing: 900 + ((index * 7) % 15) * 100,
          career: 2.5 + ((index * 11) % 15) * 0.3,
          climate: 45 + ((index * 4) % 15) * 2,
        },
      ),
    );
    const ranked = generateMatches(
      cities,
      testProfile(),
      weightsWith({ housing: 1, career: 1, climate: 1 }),
    ).recommendations.map((r) => ({
      id: r.city.id,
      rank: r.rank,
      score: r.totalScore,
    }));

    const partition = partitionSnapshot(ranked);

    expect(partition.primary).toEqual(ranked.slice(0, 5));
    expect(partition.alternatives).toEqual(
      ranked
        .slice(5, 10)
        .filter((entry) => entry.score >= MIN_ALTERNATIVE_DREAM_SCORE),
    );
  });
});

describe("describeAlternativesShortfall", () => {
  it("says nothing when five alternatives qualify", () => {
    expect(
      describeAlternativesShortfall(partitionSnapshot(snapshotOf(ALL_STRONG))),
    ).toBeNull();
  });

  it("explains fewer qualifying alternatives by the score minimum", () => {
    const shortfall = describeAlternativesShortfall(
      partitionSnapshot(snapshotOf([95, 92, 90, 88, 85, 80, 75, 70, 45, 20])),
    );

    expect(shortfall).toEqual({
      message: "Showing 3 cities instead of 5.",
      details: [
        "2 cities ranked just below your top 5 scored under the minimum DreamScore of 50.",
      ],
    });
  });

  it("explains fewer alternatives by fewer ranked cities", () => {
    const shortfall = describeAlternativesShortfall(
      partitionSnapshot(snapshotOf([95, 92, 90, 88, 85, 80, 75])),
    );

    expect(shortfall?.message).toBe("Showing 2 cities instead of 5.");
    expect(shortfall?.details).toEqual([
      "Your saved results contain only 2 cities ranked below your top 5.",
      "Cities are ranked only when they fit your housing budget and enough of your priorities can be measured.",
    ]);
  });

  it("uses the required empty-state message when no alternative qualifies", () => {
    const shortfall = describeAlternativesShortfall(
      partitionSnapshot(snapshotOf([95, 92, 90, 88, 85, 45, 40, 35, 30, 25])),
    );

    expect(shortfall?.message).toBe(NO_ALTERNATIVES_MESSAGE);
    expect(shortfall?.message).toBe(
      "We could not find additional cities that meet the minimum fit score. Try adjusting your priorities or housing budget.",
    );
    expect(shortfall?.details).toEqual([
      "5 cities ranked just below your top 5 scored under the minimum DreamScore of 50.",
    ]);
  });

  it("suggests recalculating when a full top five has nothing stored below it", () => {
    const shortfall = describeAlternativesShortfall(
      partitionSnapshot(snapshotOf([95, 92, 90, 88, 85])),
    );

    expect(shortfall?.message).toBe(NO_ALTERNATIVES_MESSAGE);
    expect(shortfall?.details).toContain(
      "If these results were saved before this view was available, recalculate your best matches to rank the next cities.",
    );
  });

  it("does not suggest recalculating when fewer than five cities ranked at all", () => {
    const shortfall = describeAlternativesShortfall(
      partitionSnapshot(snapshotOf([95, 92, 90])),
    );

    expect(shortfall?.message).toBe(NO_ALTERNATIVES_MESSAGE);
    expect(shortfall?.details.join(" ")).not.toContain("recalculate");
  });
});

describe("describeWeakBestMatches", () => {
  const primaryOf = (scores: number[]) =>
    partitionSnapshot(snapshotOf(scores)).primary;

  it("uses the same cutoff as the alternatives minimum", () => {
    expect(WEAK_BEST_MATCH_DREAM_SCORE).toBe(MIN_ALTERNATIVE_DREAM_SCORE);
  });

  it("says nothing when every best match reaches the cutoff, inclusively", () => {
    expect(describeWeakBestMatches(primaryOf([95, 80, 70, 60, 50]))).toBeNull();
  });

  it("counts best matches below the cutoff at full precision", () => {
    const notice = describeWeakBestMatches(primaryOf([80, 70, 60, 49.99, 30]));

    expect(notice?.message).toBe("2 of your 5 best matches score below 50.");
    expect(notice?.details).toHaveLength(2);
  });

  it("says when no best match reaches the cutoff", () => {
    const notice = describeWeakBestMatches(primaryOf([45, 40, 35]));

    expect(notice?.message).toBe(
      "None of your best matches reaches a DreamScore of 50.",
    );
  });

  it("never removes or reorders the best matches it describes", () => {
    const primary = primaryOf([45, 40, 35, 30, 25]);

    describeWeakBestMatches(primary);

    expect(primary.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5]);
  });
});
