import { describe, expect, it } from "vitest";

import {
  LIFESTYLE_BREADTH_WEIGHT,
  LIFESTYLE_PER_CAPITA_WEIGHT,
  scoreLifestyleFit,
} from "@/lib/matching/lifestyle";
import { generateMatches } from "@/lib/matching/ranking";
import { scoreCities } from "@/lib/matching/scoring";
import { normalizeWeights } from "@/lib/matching/weights";
import type { LifestyleCategory } from "@/types/profile";

import {
  cityWith,
  personalizationFor,
  testProfile,
  weightsWith,
  withMetroData,
} from "./fixtures";

/**
 * Lifestyle Fit.
 *
 * The behaviour that matters: a raw count must never become the score, a big
 * metro must not win on size alone, the user's own selection must be able to
 * change the ranking, and a user who selected nothing must not be punished for
 * it.
 */

const A = "00000000-0000-4000-8000-00000000c001";
const B = "00000000-0000-4000-8000-00000000c002";
const C = "00000000-0000-4000-8000-00000000c003";

/** Metros carrying lifestyle counts, with an explicit population each. */
function lifestyleSet(
  rows: {
    id: string;
    population: number;
    counts?: Partial<Record<LifestyleCategory, number>> | null;
  }[],
) {
  return rows.map((row) => {
    const base = cityWith(row.id, { housing: 1_200 });
    return withMetroData(
      { ...base, population: row.population },
      {
        lifestyle: row.counts === undefined ? {} : row.counts,
      },
    );
  });
}

const THREE_CATEGORY_SET = () =>
  lifestyleSet([
    {
      id: A,
      population: 1_000_000,
      counts: { food_drink: 5_000, nightlife: 800, parks_outdoors: 600 },
    },
    {
      id: B,
      population: 500_000,
      counts: { food_drink: 3_000, nightlife: 200, parks_outdoors: 700 },
    },
    {
      id: C,
      population: 2_000_000,
      counts: { food_drink: 7_000, nightlife: 500, parks_outdoors: 400 },
    },
  ]);

describe("places per 100,000 residents", () => {
  it("uses count / population x 100,000", () => {
    const detail = scoreLifestyleFit(THREE_CATEGORY_SET(), null).get(A)!.detail;
    const food = detail.categories.find((c) => c.category === "food_drink")!;

    // 5,000 / 1,000,000 * 100,000 = 500 per 100k.
    expect(food.placesPer100k).toBe(500);
    expect(food.placeCount).toBe(5_000);
  });

  it("never produces Infinity or NaN", () => {
    for (const [, result] of scoreLifestyleFit(THREE_CATEGORY_SET(), null)) {
      if (!result) continue;
      for (const entry of result.detail.categories) {
        expect(Number.isFinite(entry.placesPer100k)).toBe(true);
        expect(Number.isFinite(entry.score)).toBe(true);
      }
    }
  });

  it("treats a measured zero as a real measurement, not missing data", () => {
    // A metro with no nightlife venues has been measured, not missed. It must
    // still be scored — at the bottom of the nightlife population.
    const cities = lifestyleSet([
      { id: A, population: 1_000_000, counts: { nightlife: 0 } },
      { id: B, population: 1_000_000, counts: { nightlife: 500 } },
      { id: C, population: 1_000_000, counts: { nightlife: 900 } },
    ]);

    const result = scoreLifestyleFit(cities, ["nightlife"]).get(A)!;

    expect(result).not.toBeNull();
    expect(result.detail.categories).toHaveLength(1);
    expect(result.detail.categories[0]!.placeCount).toBe(0);
    expect(result.detail.categories[0]!.placesPer100k).toBe(0);
    // Measured, so coverage is complete: nothing was missing.
    expect(result.detail.coverage).toBe(1);
    expect(result.score).toBeLessThan(
      scoreLifestyleFit(cities, ["nightlife"]).get(C)!.score,
    );
  });
});

describe("raw counts never become the score", () => {
  it("does not let the largest metro win on breadth alone", () => {
    // C has the most food places in absolute terms but the fewest per person.
    const scores = scoreLifestyleFit(THREE_CATEGORY_SET(), ["food_drink"]);
    const detail = scores.get(C)!.detail.categories[0]!;

    expect(detail.placeCount).toBe(7_000);
    expect(detail.breadthPercentile).toBeGreaterThan(
      detail.perCapitaPercentile,
    );
    // A (500 per 100k) beats C (350 per 100k) despite having fewer places.
    expect(scores.get(A)!.score).toBeGreaterThan(scores.get(C)!.score);
  });

  it("scores breadth and per-capita as separate deterministic percentiles", () => {
    const first = scoreLifestyleFit(THREE_CATEGORY_SET(), ["food_drink"]);
    const second = scoreLifestyleFit(THREE_CATEGORY_SET(), ["food_drink"]);

    for (const id of [A, B, C]) {
      const a = first.get(id)!.detail.categories[0]!;
      const b = second.get(id)!.detail.categories[0]!;
      expect(a.breadthPercentile).toBe(b.breadthPercentile);
      expect(a.perCapitaPercentile).toBe(b.perCapitaPercentile);
    }
  });

  it("ranks more places per resident higher on the per-capita component", () => {
    const scores = scoreLifestyleFit(THREE_CATEGORY_SET(), ["food_drink"]);
    const perCapita = (id: string) =>
      scores.get(id)!.detail.categories[0]!.perCapitaPercentile;

    // A 500/100k, B 600/100k, C 350/100k.
    expect(perCapita(B)).toBeGreaterThan(perCapita(A));
    expect(perCapita(A)).toBeGreaterThan(perCapita(C));
  });

  it("ranks more places in total higher on the breadth component", () => {
    const scores = scoreLifestyleFit(THREE_CATEGORY_SET(), ["food_drink"]);
    const breadth = (id: string) =>
      scores.get(id)!.detail.categories[0]!.breadthPercentile;

    expect(breadth(C)).toBeGreaterThan(breadth(A));
    expect(breadth(A)).toBeGreaterThan(breadth(B));
  });
});

describe("category score weighting", () => {
  it("declares 40% breadth and 60% per-capita", () => {
    expect(LIFESTYLE_BREADTH_WEIGHT).toBe(0.4);
    expect(LIFESTYLE_PER_CAPITA_WEIGHT).toBe(0.6);
    expect(LIFESTYLE_BREADTH_WEIGHT + LIFESTYLE_PER_CAPITA_WEIGHT).toBe(1);
  });

  it("computes each category score as 0.40 x breadth + 0.60 x per-capita", () => {
    for (const [, result] of scoreLifestyleFit(THREE_CATEGORY_SET(), null)) {
      if (!result) continue;
      for (const entry of result.detail.categories) {
        expect(entry.score).toBeCloseTo(
          entry.breadthPercentile * 0.4 + entry.perCapitaPercentile * 0.6,
          10,
        );
      }
    }
  });

  it("keeps every score inside 0-100", () => {
    for (const [, result] of scoreLifestyleFit(THREE_CATEGORY_SET(), null)) {
      if (!result) continue;
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      for (const entry of result.detail.categories) {
        expect(entry.score).toBeGreaterThanOrEqual(0);
        expect(entry.score).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("personalised and general bases", () => {
  it("scores only the categories the user selected", () => {
    const result = scoreLifestyleFit(THREE_CATEGORY_SET(), ["nightlife"]).get(
      A,
    )!;

    expect(result.detail.basis).toBe("personalized_lifestyle");
    expect(result.detail.categories.map((c) => c.category)).toEqual([
      "nightlife",
    ]);
    expect(result.detail.requestedCategories).toEqual(["nightlife"]);
  });

  it("produces different fits for different preference sets", () => {
    // A leads on nightlife, B leads on parks. The same metros, scored against
    // different preferences, must not produce the same answer.
    const nightlife = scoreLifestyleFit(THREE_CATEGORY_SET(), ["nightlife"]);
    const parks = scoreLifestyleFit(THREE_CATEGORY_SET(), ["parks_outdoors"]);

    expect(nightlife.get(A)!.score).not.toBe(parks.get(A)!.score);
    expect(nightlife.get(A)!.score).toBeGreaterThan(nightlife.get(B)!.score);
    expect(parks.get(B)!.score).toBeGreaterThan(parks.get(A)!.score);
  });

  it("can change the metro ranking when social carries real weight", () => {
    const cities = THREE_CATEGORY_SET();
    const rank = (preferences: LifestyleCategory[]) =>
      generateMatches(
        cities,
        testProfile({ lifestylePreferences: preferences }),
        weightsWith({ social: 1 }),
        { limit: 3 },
      ).recommendations.map((r) => r.city.id);

    expect(rank(["nightlife"])[0]).toBe(A);
    expect(rank(["parks_outdoors"])[0]).toBe(B);
    expect(rank(["nightlife"])).not.toEqual(rank(["parks_outdoors"]));
  });

  it("uses the general basis when nothing was selected", () => {
    const result = scoreLifestyleFit(THREE_CATEGORY_SET(), null).get(A)!;

    expect(result.detail.basis).toBe("general_lifestyle");
    expect(result.detail.requestedCategories).toEqual([]);
    // A broad mix: every category measured across the candidate set.
    expect(result.detail.categories.map((c) => c.category)).toEqual([
      "food_drink",
      "nightlife",
      "parks_outdoors",
    ]);
  });

  it("treats an empty selection exactly like never having been asked", () => {
    const never = scoreLifestyleFit(THREE_CATEGORY_SET(), null).get(A)!;
    const asked = scoreLifestyleFit(THREE_CATEGORY_SET(), []).get(A)!;

    expect(asked.detail.basis).toBe("general_lifestyle");
    expect(asked.score).toBe(never.score);
  });

  it("does not penalise a profile that selected no categories", () => {
    // The general basis is the intended measurement, not a degraded one, in
    // exactly the way general_labor_market is for a user with no occupation.
    const result = scoreLifestyleFit(THREE_CATEGORY_SET(), null).get(A)!;

    expect(result.detail.coverage).toBe(1);
    expect(result.detail.evidenceConfidence).toBe(1);
    expect(result.score).toBe(result.detail.rawScore);
  });

  it("averages the selected categories with equal weight", () => {
    // The UI collects which categories matter, not how much each matters, so
    // inventing a relative strength would put words in the user's mouth.
    const result = scoreLifestyleFit(THREE_CATEGORY_SET(), [
      "food_drink",
      "nightlife",
    ]).get(A)!;

    const mean =
      result.detail.categories.reduce((total, c) => total + c.score, 0) /
      result.detail.categories.length;

    expect(result.detail.rawScore).toBeCloseTo(mean, 10);
  });
});

describe("missing category evidence", () => {
  /** A metro measured for food only, in a set where others have nightlife. */
  function partialSet() {
    return lifestyleSet([
      { id: A, population: 1_000_000, counts: { food_drink: 5_000 } },
      {
        id: B,
        population: 1_000_000,
        counts: { food_drink: 3_000, nightlife: 400 },
      },
      {
        id: C,
        population: 1_000_000,
        counts: { food_drink: 4_000, nightlife: 900 },
      },
    ]);
  }

  it("excludes an unmeasured category rather than scoring it zero", () => {
    const result = scoreLifestyleFit(partialSet(), [
      "food_drink",
      "nightlife",
    ]).get(A)!;

    expect(result.detail.categories.map((c) => c.category)).toEqual([
      "food_drink",
    ]);
    // Zeroing nightlife would have dragged the raw estimate down; it did not.
    expect(result.detail.rawScore).toBe(result.detail.categories[0]!.score);
  });

  it("renormalises the raw score over what was measured", () => {
    const result = scoreLifestyleFit(partialSet(), [
      "food_drink",
      "nightlife",
    ]).get(A)!;

    expect(result.detail.coverage).toBeCloseTo(0.5, 10);
    expect(result.detail.evidenceConfidence).toBeCloseTo(0.5, 10);
  });

  it("scales the effective score by evidence coverage", () => {
    const result = scoreLifestyleFit(partialSet(), [
      "food_drink",
      "nightlife",
    ]).get(A)!;

    expect(result.score).toBeCloseTo(result.detail.rawScore * 0.5, 10);
    expect(result.score).toBeLessThan(result.detail.rawScore);
  });

  it("leaves a fully covered score unchanged by the adjustment", () => {
    const result = scoreLifestyleFit(partialSet(), ["food_drink"]).get(A)!;

    expect(result.detail.coverage).toBe(1);
    expect(result.score).toBe(result.detail.rawScore);
  });

  it("returns null when none of the requested categories exist here", () => {
    const result = scoreLifestyleFit(partialSet(), ["nightlife"]).get(A);

    expect(result).toBeNull();
  });

  it("returns null when the metro has no lifestyle data at all", () => {
    const cities = [
      ...partialSet().slice(0, 2),
      withMetroData(cityWith(C, { housing: 1_200 }), { lifestyle: null }),
    ];

    expect(scoreLifestyleFit(cities, null).get(C)).toBeNull();
  });

  it("keeps coverage inside 0-1", () => {
    for (const preferences of [
      null,
      ["food_drink"] as LifestyleCategory[],
      ["food_drink", "nightlife"] as LifestyleCategory[],
    ]) {
      for (const [, result] of scoreLifestyleFit(partialSet(), preferences)) {
        if (!result) continue;
        expect(result.detail.coverage).toBeGreaterThan(0);
        expect(result.detail.coverage).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("social top-level semantics", () => {
  it("lets the user's social weight decide the contribution", () => {
    const cities = THREE_CATEGORY_SET();
    const contributionFor = (social: number, housing: number) =>
      generateMatches(cities, testProfile(), weightsWith({ social, housing }), {
        limit: 3,
      }).recommendations.find((r) => r.city.id === A)!.dimensions.social;

    const heavy = contributionFor(1, 0.1);
    const light = contributionFor(0.1, 1);

    expect(heavy.effectiveWeight).toBeGreaterThan(light.effectiveWeight);
    // Same underlying score; only how much of the total it carries changes.
    expect(heavy.normalizedScore).toBe(light.normalizedScore);
  });

  it("no longer redistributes social weight away as unscorable", () => {
    const result = generateMatches(
      THREE_CATEGORY_SET(),
      testProfile(),
      weightsWith({ social: 1 }),
      { limit: 3 },
    );

    expect(result.unscoredWeightedDimensions).not.toContain("social");
    const top = result.recommendations[0]!;
    expect(top.dimensions.social.effectiveWeight).toBeCloseTo(1, 10);
    expect(top.dimensions.social.contribution).toBeCloseTo(top.totalScore, 10);
  });

  it("keeps the 40/60 sub-weights out of the user's top-level weight", () => {
    const top = generateMatches(
      THREE_CATEGORY_SET(),
      testProfile(),
      weightsWith({ social: 0.25, housing: 0.75 }),
      { limit: 3 },
    ).recommendations[0]!;

    expect(top.dimensions.social.effectiveWeight).toBeCloseTo(0.25, 10);
    expect(top.dimensions.housing.effectiveWeight).toBeCloseTo(0.75, 10);
  });

  it("scores social through the composite path, not a raw observation", () => {
    const scored = scoreCities(
      THREE_CATEGORY_SET(),
      normalizeWeights(weightsWith({ social: 1 })),
      personalizationFor(testProfile()),
    );

    for (const city of scored) {
      expect(city.dimensions.social.available).toBe(true);
      expect(city.dimensions.social.detail?.kind).toBe("lifestyle");
    }
  });
});

describe("determinism", () => {
  it("produces identical output on repeated runs", () => {
    const cities = THREE_CATEGORY_SET();

    expect(JSON.stringify([...scoreLifestyleFit(cities, null)])).toBe(
      JSON.stringify([...scoreLifestyleFit(cities, null)]),
    );
  });

  it("does not depend on the order candidates are supplied in", () => {
    const cities = THREE_CATEGORY_SET();
    const forwards = scoreLifestyleFit(cities, null);
    const backwards = scoreLifestyleFit([...cities].reverse(), null);

    for (const id of [A, B, C]) {
      expect(backwards.get(id)!.score).toBe(forwards.get(id)!.score);
    }
  });

  it("does not depend on the order preferences are supplied in", () => {
    const cities = THREE_CATEGORY_SET();
    const one = scoreLifestyleFit(cities, ["nightlife", "food_drink"]);
    const other = scoreLifestyleFit(cities, ["food_drink", "nightlife"]);

    expect(one.get(A)!.score).toBe(other.get(A)!.score);
  });
});
