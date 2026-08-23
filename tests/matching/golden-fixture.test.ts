import { describe, expect, it } from "vitest";

import { scoreCities } from "@/lib/matching/scoring";
import { generateMatches } from "@/lib/matching/ranking";
import { normalizeWeights } from "@/lib/matching/weights";

import {
  GOLDEN_CITIES,
  personalizationFor,
  testProfile,
  weightsWith,
} from "./fixtures";

/**
 * The personalisation proof.
 *
 * Every expected number below is derived by hand from the fixture. With four
 * candidates and distinct values, mid-rank percentiles are 12.5 / 37.5 / 62.5 /
 * 87.5. The fixture profile has a 10,000/mo budget, so the housing budget
 * multiplier is 1.0 throughout and housing is the plain rent percentile. It
 * prefers a `mild` climate: the 55-65 °F band, 20 °F tolerance.
 *
 * The fixture profile names no occupation and the cities carry no OEWS rows,
 * so career scores on the metro-wide labour market — `general_labor_market`,
 * evidence confidence 1.0. That is the measurement this user asked for, not a
 * stand-in for a missing one, so nothing is discounted and the career column
 * below is the plain unemployment percentile.
 *
 *              housing(rent↓)  career(unemp↓)  climate(mild band)
 *   Alpha          87.5            12.5              50   (45°F, 10 below)
 *   Beta           12.5            87.5              85   (52°F, 3 below)
 *   Gamma          62.5            62.5             100   (57°F, inside)
 *   Delta          37.5            37.5              75   (70°F, 5 above)
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
  const scored = scoreCities(
    GOLDEN_CITIES,
    normalizeWeights(BALANCED),
    personalizationFor(testProfile()),
  );
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

  it("does not discount a career score the user never asked to personalise", () => {
    const beta = bySlug.get("beta")!;
    const detail = beta.dimensions.career.detail;

    expect(detail?.kind).toBe("career");
    if (detail?.kind !== "career") return;

    // No occupation was named, so the metro-wide labour market is the intended
    // measurement rather than a substitute for a missing one. Nothing is
    // missing, so nothing is discounted.
    expect(detail.basis).toBe("general_labor_market");
    expect(detail.evidenceConfidence).toBe(1);
    expect(detail.rawScore).toBe(87.5);
    expect(beta.dimensions.career.normalizedScore).toBe(87.5);
  });

  it("scores the temperature inside the requested band highest on climate", () => {
    expect(bySlug.get("gamma")!.dimensions.climate.normalizedScore).toBe(100);
    expect(bySlug.get("beta")!.dimensions.climate.normalizedScore).toBe(85);
    expect(bySlug.get("delta")!.dimensions.climate.normalizedScore).toBe(75);
    expect(bySlug.get("alpha")!.dimensions.climate.normalizedScore).toBe(50);
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
    // 87.5(0.83333) + 12.5(0.08333) + 50(0.08333) = 72.917 + 1.042 + 4.167
    expect(alpha.totalScore).toBeCloseTo(78.125, 2);
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
