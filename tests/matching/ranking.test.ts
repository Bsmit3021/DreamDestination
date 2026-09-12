import { describe, expect, it } from "vitest";

import { BUDGET_TOLERANCE_MULTIPLIER } from "@/lib/matching/filters";
import { UNSCORED_DIMENSIONS } from "@/lib/matching/dimensions";
import {
  DEFAULT_RECOMMENDATION_LIMIT,
  generateMatches,
} from "@/lib/matching/ranking";
import { scoreCities } from "@/lib/matching/scoring";
import { normalizeWeights } from "@/lib/matching/weights";

import { GOLDEN_CITIES, cityWith, testProfile, weightsWith } from "./fixtures";

const BALANCED = weightsWith({ housing: 1, career: 1, climate: 1 });

/** A stable, sortable city id for the index-th synthetic city. */
function fixtureId(index: number): string {
  return `00000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
}

describe("ranking order and limits", () => {
  it("assigns ranks starting at 1 in descending score order", () => {
    const { recommendations } = generateMatches(
      GOLDEN_CITIES,
      testProfile(),
      BALANCED,
      { limit: 4 },
    );

    expect(recommendations.map((r) => r.rank)).toEqual([1, 2, 3, 4]);

    for (let i = 1; i < recommendations.length; i += 1) {
      expect(recommendations[i - 1]!.totalScore).toBeGreaterThanOrEqual(
        recommendations[i]!.totalScore,
      );
    }
  });

  it("honours the requested limit", () => {
    const { recommendations } = generateMatches(
      GOLDEN_CITIES,
      testProfile(),
      BALANCED,
      { limit: 2 },
    );

    expect(recommendations).toHaveLength(2);
    expect(recommendations.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("defaults to twelve recommendations", () => {
    const many = Array.from({ length: 15 }, (_, index) =>
      cityWith(fixtureId(index), {
        housing: 1000 + index * 10,
        career: 3 + index * 0.1,
        climate: 57,
      }),
    );

    const { recommendations } = generateMatches(many, testProfile(), BALANCED);

    expect(DEFAULT_RECOMMENDATION_LIMIT).toBe(12);
    expect(recommendations).toHaveLength(12);
    expect(recommendations.map((r) => r.rank)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
  });

  it("returns every ranked city when fewer than the limit qualify", () => {
    const { recommendations } = generateMatches(
      GOLDEN_CITIES,
      testProfile(),
      BALANCED,
    );

    expect(recommendations).toHaveLength(GOLDEN_CITIES.length);
  });

  it("only truncates the full ordering, never reorders or rescores it", () => {
    // Deliberately scrambled, but fixed, metrics: no randomness in the test.
    const cities = Array.from({ length: 15 }, (_, index) =>
      cityWith(fixtureId(index), {
        housing: 900 + ((index * 7) % 15) * 100,
        career: 2.5 + ((index * 11) % 15) * 0.3,
        climate: 45 + ((index * 4) % 15) * 2,
      }),
    );
    const snapshot = (limit?: number) =>
      generateMatches(
        cities,
        testProfile(),
        BALANCED,
        limit === undefined ? {} : { limit },
      ).recommendations.map((r) => ({
        id: r.city.id,
        rank: r.rank,
        totalScore: r.totalScore,
        dataCoverage: r.dataCoverage,
      }));

    const everything = snapshot(cities.length);
    const twelve = snapshot();
    const five = snapshot(5);

    expect(twelve).toEqual(everything.slice(0, 12));
    // The previous default's top five are exactly the new list's first five.
    expect(five).toEqual(twelve.slice(0, 5));
  });

  it("breaks ties at the twelfth-place cutoff by city id, whatever the input order", () => {
    // Fourteen identical cities tie on score and coverage, so which twelve
    // make the cut is decided by the stable id alone.
    const tied = Array.from({ length: 14 }, (_, index) =>
      cityWith(fixtureId(index), { housing: 1000, career: 4, climate: 57 }),
    );
    const expected = tied
      .map((city) => city.id)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 12);

    const interleaved = [
      ...tied.filter((_, index) => index % 2 === 1),
      ...tied.filter((_, index) => index % 2 === 0),
    ];

    for (const order of [tied, [...tied].reverse(), interleaved]) {
      const { recommendations } = generateMatches(
        order,
        testProfile(),
        BALANCED,
      );
      expect(recommendations.map((r) => r.city.id)).toEqual(expected);
    }
  });

  it("produces a different twelve when priorities differ", () => {
    // Rent worsens as the index rises while unemployment improves, so the two
    // priorities pull the ranking in opposite directions.
    const opposed = Array.from({ length: 15 }, (_, index) =>
      cityWith(fixtureId(index), {
        housing: 900 + index * 100,
        career: 7 - index * 0.3,
        climate: 57,
      }),
    );

    const housingFirst = generateMatches(
      opposed,
      testProfile(),
      weightsWith({ housing: 1, career: 0.1, climate: 0.1 }),
    ).recommendations.map((r) => r.city.id);
    const careerFirst = generateMatches(
      opposed,
      testProfile(),
      weightsWith({ housing: 0.1, career: 1, climate: 0.1 }),
    ).recommendations.map((r) => r.city.id);

    expect(housingFirst).toHaveLength(12);
    expect(careerFirst).toHaveLength(12);
    expect(housingFirst[0]).toBe(fixtureId(0));
    expect(careerFirst[0]).toBe(fixtureId(14));
    expect(housingFirst).not.toEqual(careerFirst);
  });

  it("breaks ties deterministically by city id", () => {
    // Two cities with identical metrics must tie on score and coverage, so the
    // only remaining discriminator is the stable identifier.
    const a = cityWith("00000000-0000-4000-8000-0000000000aa", {
      housing: 1000,
      career: 4,
      climate: 57,
    });
    const b = cityWith("00000000-0000-4000-8000-0000000000bb", {
      housing: 1000,
      career: 4,
      climate: 57,
    });

    const forwards = generateMatches([a, b], testProfile(), BALANCED, {
      limit: 2,
    });
    const backwards = generateMatches([b, a], testProfile(), BALANCED, {
      limit: 2,
    });

    expect(forwards.recommendations[0]!.totalScore).toBe(
      forwards.recommendations[1]!.totalScore,
    );
    expect(forwards.recommendations.map((r) => r.city.id)).toEqual(
      backwards.recommendations.map((r) => r.city.id),
    );
    expect(forwards.recommendations[0]!.city.id).toBe(
      "00000000-0000-4000-8000-0000000000aa",
    );
  });
});

describe("hard filters", () => {
  it("excludes a metro whose median rent far exceeds the budget", () => {
    // Budget 1000 → ceiling 1500. Beta's rent is 2400.
    const result = generateMatches(
      GOLDEN_CITIES,
      testProfile({ housingBudget: 1000 }),
      BALANCED,
      { limit: 4 },
    );

    expect(result.recommendations.map((r) => r.city.slug)).not.toContain(
      "beta",
    );
    expect(result.excluded.map((e) => e.city.slug)).toContain("beta");
    expect(result.excluded.find((e) => e.city.slug === "beta")?.reason).toBe(
      "budget",
    );
  });

  it("keeps a metro priced within the tolerance multiplier", () => {
    // 1500 rent with a 1000 budget sits exactly at the 1.5x ceiling.
    const budget = 1500 / BUDGET_TOLERANCE_MULTIPLIER;

    const result = generateMatches(
      GOLDEN_CITIES,
      testProfile({ housingBudget: budget }),
      BALANCED,
      { limit: 4 },
    );

    expect(result.recommendations.map((r) => r.city.slug)).toContain("gamma");
  });

  it("skips the budget filter when the budget is zero", () => {
    // Zero means "unspecified" far more often than "I can pay nothing";
    // filtering on it would eliminate every candidate.
    const result = generateMatches(
      GOLDEN_CITIES,
      testProfile({ housingBudget: 0 }),
      BALANCED,
      { limit: 4 },
    );

    expect(result.recommendations).toHaveLength(4);
    expect(result.excluded).toHaveLength(0);
  });

  it("does not exclude a city that has no rent measurement", () => {
    const noRent = cityWith("00000000-0000-4000-8000-0000000000ff", {
      career: 4,
      climate: 57,
    });

    const result = generateMatches(
      [...GOLDEN_CITIES, noRent],
      testProfile({ housingBudget: 500 }),
      weightsWith({ career: 1, climate: 1 }),
      { limit: 6 },
    );

    expect(result.recommendations.map((r) => r.city.id)).toContain(
      "00000000-0000-4000-8000-0000000000ff",
    );
  });
});

describe("missing data", () => {
  it("does not treat a missing dimension as a zero score", () => {
    const complete = cityWith("00000000-0000-4000-8000-000000000101", {
      housing: 1000,
      career: 4,
    });
    // Same rent, but no career measurement at all.
    const partial = cityWith("00000000-0000-4000-8000-000000000102", {
      housing: 1000,
    });

    const scored = scoreCities(
      [complete, partial],
      normalizeWeights(weightsWith({ housing: 1, career: 1 })),
    );
    const partialScore = scored.find((s) => s.city.id.endsWith("102"))!;

    expect(partialScore.dimensions.career.available).toBe(false);
    expect(partialScore.dimensions.career.normalizedScore).toBeNull();
    expect(partialScore.dimensions.career.contribution).toBe(0);
    // Housing absorbs the whole weight rather than career dragging it to zero.
    expect(partialScore.dimensions.housing.effectiveWeight).toBeCloseTo(1, 10);
    expect(partialScore.totalScore).toBe(
      partialScore.dimensions.housing.normalizedScore,
    );
  });

  it("renormalises the remaining weights to still sum to one", () => {
    const partial = cityWith("00000000-0000-4000-8000-000000000103", {
      housing: 1000,
      career: 4,
    });

    const scored = scoreCities(
      [partial],
      // A third of the weight sits on safety, which nothing can measure.
      normalizeWeights(weightsWith({ housing: 1, career: 1, safety: 1 })),
    );

    const weightSum = Object.values(scored[0]!.dimensions).reduce(
      (total, dimension) => total + dimension.effectiveWeight,
      0,
    );

    expect(weightSum).toBeCloseTo(1, 10);
    expect(scored[0]!.dataCoverage).toBeCloseTo(2 / 3, 10);
  });

  it("excludes cities below the coverage threshold", () => {
    const wellCovered = cityWith("00000000-0000-4000-8000-000000000104", {
      housing: 1000,
      career: 4,
      climate: 57,
    });
    const barelyCovered = cityWith("00000000-0000-4000-8000-000000000105", {
      climate: 57,
    });

    // 80% of weight on housing+career, which barelyCovered lacks entirely.
    const result = generateMatches(
      [wellCovered, barelyCovered],
      testProfile(),
      weightsWith({ housing: 4, career: 4, climate: 2 }),
      { limit: 5, minimumCoverage: 0.6 },
    );

    expect(result.recommendations.map((r) => r.city.id)).toEqual([
      "00000000-0000-4000-8000-000000000104",
    ]);
    expect(result.excluded.find((e) => e.city.id.endsWith("105"))?.reason).toBe(
      "insufficient_data",
    );
  });

  it("returns nothing when a city set can measure none of the weighted dimensions", () => {
    // The golden fixture carries no Overture lifestyle counts, so social
    // cannot be scored *for these cities* even though it is now scorable in
    // principle. Every candidate falls below the coverage floor.
    const result = generateMatches(
      GOLDEN_CITIES,
      testProfile(),
      weightsWith({ social: 1 }),
    );

    expect(result.recommendations).toHaveLength(0);
    expect(result.excluded).toHaveLength(GOLDEN_CITIES.length);
  });

  it("reports which weighted dimensions cannot be scored", () => {
    const result = generateMatches(
      GOLDEN_CITIES,
      testProfile(),
      weightsWith({ housing: 1, safety: 1, social: 1, family: 1 }),
    );

    // Registry-level: dimensions nothing can ever score, not dimensions this
    // particular city set happens to lack data for. Phase 6C emptied this set
    // entirely — every priority onboarding collects now has a measurement
    // behind it, so no weight is redistributed away before it is ever applied.
    expect(result.unscoredWeightedDimensions).toEqual([]);
    expect(UNSCORED_DIMENSIONS).toEqual([]);
  });
});
