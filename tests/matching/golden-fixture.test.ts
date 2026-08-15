import { describe, expect, it } from "vitest";

import { scoreCities } from "@/lib/matching/scoring";
import { generateMatches } from "@/lib/matching/ranking";
import { normalizeWeights } from "@/lib/matching/weights";

import { GOLDEN_CITIES, testProfile, weightsWith } from "./fixtures";

/**
 * The personalisation proof.
 *
 * Every expected number below is derived by hand from the fixture. With four
 * candidates and distinct values, mid-rank percentiles are 12.5 / 37.5 / 62.5 /
 * 87.5, so each city's normalised score per dimension is:
 *
 *              housing(rent↓)  career(unemp↓)  climate(|t−57|/20)
 *   Alpha          87.5            12.5              40
 *   Beta           12.5            87.5              75
 *   Gamma          62.5            62.5             100
 *   Delta          37.5            37.5              35
 */

const HOUSING_FIRST = weightsWith({ housing: 1.0, career: 0.1, climate: 0.1 });
const CAREER_FIRST = weightsWith({ housing: 0.1, career: 1.0, climate: 0.1 });
const CLIMATE_FIRST = weightsWith({ housing: 0.1, career: 0.1, climate: 1.0 });
const BALANCED = weightsWith({ housing: 1, career: 1, climate: 1 });

function rankedSlugs(weights: Parameters<typeof generateMatches>[2]) {
  return generateMatches(GOLDEN_CITIES, testProfile(), weights, {
    limit: 4,
  }).recommendations.map((recommendation) => recommendation.city.slug);
}

describe("normalized dimension scores (hand-checked)", () => {
  const scored = scoreCities(GOLDEN_CITIES, normalizeWeights(BALANCED));
  const bySlug = new Map(scored.map((s) => [s.city.slug, s]));

  it("scores cheap rent highest on housing", () => {
    expect(bySlug.get("alpha")!.dimensions.housing.normalizedScore).toBe(87.5);
    expect(bySlug.get("beta")!.dimensions.housing.normalizedScore).toBe(12.5);
    expect(bySlug.get("gamma")!.dimensions.housing.normalizedScore).toBe(62.5);
    expect(bySlug.get("delta")!.dimensions.housing.normalizedScore).toBe(37.5);
  });

  it("scores low unemployment highest on career", () => {
    expect(bySlug.get("beta")!.dimensions.career.normalizedScore).toBe(87.5);
    expect(bySlug.get("alpha")!.dimensions.career.normalizedScore).toBe(12.5);
  });

  it("scores the on-target temperature highest on climate", () => {
    expect(bySlug.get("gamma")!.dimensions.climate.normalizedScore).toBe(100);
    expect(bySlug.get("beta")!.dimensions.climate.normalizedScore).toBe(75);
    expect(bySlug.get("alpha")!.dimensions.climate.normalizedScore).toBe(40);
    expect(bySlug.get("delta")!.dimensions.climate.normalizedScore).toBe(35);
  });

  it("keeps the raw value distinct from the normalised score", () => {
    const alpha = bySlug.get("alpha")!;

    expect(alpha.dimensions.housing.rawValue).toBe(900);
    expect(alpha.dimensions.housing.normalizedScore).toBe(87.5);
    expect(alpha.dimensions.housing.unit).toBe("usd_per_month");
  });
});

describe("personalisation: preferences change the ranking", () => {
  it("puts cheap-housing Alpha first for a housing-first user", () => {
    expect(rankedSlugs(HOUSING_FIRST)[0]).toBe("alpha");
  });

  it("puts strong-jobs Beta first for a career-first user", () => {
    expect(rankedSlugs(CAREER_FIRST)[0]).toBe("beta");
  });

  it("puts on-target Gamma first for a climate-first user", () => {
    expect(rankedSlugs(CLIMATE_FIRST)[0]).toBe("gamma");
  });

  it("puts all-round Gamma first for a balanced user", () => {
    expect(rankedSlugs(BALANCED)[0]).toBe("gamma");
  });

  it("produces genuinely different orderings, not cosmetic reshuffles", () => {
    const housingOrder = rankedSlugs(HOUSING_FIRST);
    const careerOrder = rankedSlugs(CAREER_FIRST);

    expect(housingOrder).not.toEqual(careerOrder);
    // The two most opposed cities swap ends of the list entirely.
    expect(housingOrder[0]).toBe("alpha");
    expect(housingOrder.at(-1)).toBe("beta");
    expect(careerOrder[0]).toBe("beta");
    expect(careerOrder.at(-1)).toBe("alpha");
  });

  it("matches hand-computed totals for the housing-first user", () => {
    const result = generateMatches(
      GOLDEN_CITIES,
      testProfile(),
      HOUSING_FIRST,
      { limit: 4 },
    );
    const alpha = result.recommendations.find((r) => r.city.slug === "alpha")!;

    // weights 1.0 / 0.1 / 0.1 normalise to 0.8333 / 0.08333 / 0.08333
    // 87.5(0.83333) + 12.5(0.08333) + 40(0.08333) = 72.917 + 1.042 + 3.333
    expect(alpha.totalScore).toBeCloseTo(77.292, 2);
    expect(alpha.dimensions.housing.effectiveWeight).toBeCloseTo(0.83333, 4);
    expect(alpha.dimensions.housing.contribution).toBeCloseTo(72.917, 2);
  });

  it("matches hand-computed totals for the balanced user", () => {
    const result = generateMatches(GOLDEN_CITIES, testProfile(), BALANCED, {
      limit: 4,
    });
    const gamma = result.recommendations.find((r) => r.city.slug === "gamma")!;

    // (62.5 + 62.5 + 100) / 3 = 75
    expect(gamma.totalScore).toBeCloseTo(75, 6);
  });

  it("has each city's contributions sum to its total", () => {
    const result = generateMatches(GOLDEN_CITIES, testProfile(), BALANCED, {
      limit: 4,
    });

    for (const recommendation of result.recommendations) {
      const summed = Object.values(recommendation.dimensions).reduce(
        (total, dimension) => total + dimension.contribution,
        0,
      );
      expect(summed).toBeCloseTo(recommendation.totalScore, 10);
    }
  });
});

describe("determinism", () => {
  it("produces identical output across repeated runs", () => {
    const first = generateMatches(GOLDEN_CITIES, testProfile(), BALANCED);
    const second = generateMatches(GOLDEN_CITIES, testProfile(), BALANCED);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("does not depend on the order candidates are supplied in", () => {
    const forwards = generateMatches(GOLDEN_CITIES, testProfile(), BALANCED, {
      limit: 4,
    });
    const backwards = generateMatches(
      [...GOLDEN_CITIES].reverse(),
      testProfile(),
      BALANCED,
      { limit: 4 },
    );

    expect(backwards.recommendations.map((r) => r.city.slug)).toEqual(
      forwards.recommendations.map((r) => r.city.slug),
    );
  });

  it("stamps the algorithm version on the result", () => {
    const result = generateMatches(GOLDEN_CITIES, testProfile(), BALANCED);

    expect(result.algorithmVersion).toMatch(/^v\d+$/);
  });
});
