import { describe, expect, it } from "vitest";

import {
  CAREER_EVIDENCE_CONFIDENCE,
  scoreCareerFit,
} from "@/lib/matching/career";
import { scoreClimate } from "@/lib/matching/climate";
import { UNSCORED_DIMENSIONS } from "@/lib/matching/dimensions";
import { buildReasons, buildTradeoffs } from "@/lib/matching/explanations";
import { resolveHousingBenchmark } from "@/lib/matching/housing";
import { scoreSafetyFit } from "@/lib/matching/safety";
import {
  MATCHING_ALGORITHM_VERSION,
  generateMatches,
} from "@/lib/matching/ranking";
import { scoreCities } from "@/lib/matching/scoring";
import { normalizeWeights } from "@/lib/matching/weights";

import {
  GOLDEN_CITIES,
  cityWith,
  personalizationFor,
  testProfile,
  weightsWith,
  withMetroData,
} from "./fixtures";

/**
 * Phase 6B did not touch career, housing or climate. These assertions exist so
 * that stays true, and so the two new dimensions cannot quietly change the
 * meaning of a user's top-level weights.
 */

const A = "00000000-0000-4000-8000-00000000b001";
const B = "00000000-0000-4000-8000-00000000b002";

const NURSE = { socCode: "29-1141", title: "Registered Nurses" };

/** Metros carrying every Phase 6B dataset as well as the earlier ones. */
function fullSet() {
  return [
    withMetroData(
      cityWith(A, {
        housing: 1_200,
        transport: 22,
        healthcare: 5,
        climate: 62,
        career: 4,
      }),
      {
        career: {
          medianAnnualWage: 120_000,
          locationQuotient: 1.4,
          employmentPer1000: 18,
          employment: 5_000,
        },
        bedroomRents: { one: 1_100, three: 1_900 },
        safety: { violentCrimeRate: 200, propertyCrimeRate: 1_500 },
        schools: { publicSchoolCount: 900, schoolAgePopulation: 300_000 },
      },
    ),
    withMetroData(
      cityWith(B, {
        housing: 1_800,
        transport: 34,
        healthcare: 14,
        climate: 48,
        career: 6,
      }),
      {
        career: {
          medianAnnualWage: 95_000,
          locationQuotient: 0.9,
          employmentPer1000: 11,
          employment: 2_500,
        },
        bedroomRents: { one: 1_600, three: 2_600 },
        safety: { violentCrimeRate: 650, propertyCrimeRate: 3_100 },
        schools: { publicSchoolCount: 300, schoolAgePopulation: 300_000 },
      },
    ),
  ];
}

describe("earlier dimensions are unchanged", () => {
  it("keeps occupation-specific Career Fit behaving as before", () => {
    const scores = scoreCareerFit(fullSet(), NURSE);
    const a = scores.get(A)!;

    expect(a.detail.basis).toBe("occupation_specific");
    expect(a.detail.evidenceConfidence).toBe(1);
    expect(a.score).toBe(a.detail.rawScore);
    expect(CAREER_EVIDENCE_CONFIDENCE.occupation_data_fallback).toBe(0.65);
  });

  it("keeps the no-occupation career path behaving as before", () => {
    const scores = scoreCareerFit(GOLDEN_CITIES, null);

    for (const [, result] of scores) {
      if (!result) continue;
      expect(result.detail.basis).toBe("general_labor_market");
      expect(result.detail.evidenceConfidence).toBe(1);
      expect(result.score).toBe(result.detail.rawScore);
    }
  });

  it("keeps bedroom-aware Housing Fit behaving as before", () => {
    const [a] = fullSet();
    const one = resolveHousingBenchmark(a!, "one");
    const three = resolveHousingBenchmark(a!, "three");

    expect(one!.rent).toBe(1_100);
    expect(one!.basis).toBe("bedroom_specific");
    expect(three!.rent).toBe(1_900);
    expect(resolveHousingBenchmark(a!, null)!.basis).toBe("overall_median");
  });

  it("keeps personalised Climate Fit behaving as before", () => {
    expect(scoreClimate(62, "mild")!.score).toBe(100);
    expect(scoreClimate(62, "no_preference")).toBeNull();
    expect(scoreClimate(62, null)).toBeNull();
  });

  it("produces the same career, housing and climate scores with the new data present", () => {
    // The only difference between the two runs is the presence of FBI and NCES
    // rows. Neither may move a dimension it has nothing to do with.
    const weights = normalizeWeights(
      weightsWith({ career: 1, housing: 1, climate: 1 }),
    );
    const personalization = personalizationFor(
      testProfile({ climatePreference: "mild" }),
      NURSE,
    );

    const withNewData = scoreCities(fullSet(), weights, personalization);
    const withoutNewData = scoreCities(
      fullSet().map((city) => ({ ...city, safety: null, schools: null })),
      weights,
      personalization,
    );

    for (const dimension of ["career", "housing", "climate"] as const) {
      expect(
        withNewData.map((c) => c.dimensions[dimension].normalizedScore),
      ).toEqual(
        withoutNewData.map((c) => c.dimensions[dimension].normalizedScore),
      );
    }
  });
});

describe("top-level weighting semantics survive", () => {
  it("keeps DreamScore the weighted sum of its dimensions", () => {
    const result = generateMatches(
      fullSet(),
      testProfile({ climatePreference: "mild" }),
      weightsWith({ safety: 1, family: 1, housing: 1, career: 0.5 }),
      { limit: 2, occupation: NURSE },
    );

    for (const recommendation of result.recommendations) {
      const summed = Object.values(recommendation.dimensions).reduce(
        (total, dimension) => total + dimension.contribution,
        0,
      );
      expect(summed).toBeCloseTo(recommendation.totalScore, 10);
    }
  });

  it("does not inflate safety or family beyond the weight the user gave them", () => {
    const result = generateMatches(
      fullSet(),
      testProfile({ climatePreference: "mild" }),
      weightsWith({ safety: 1, family: 1 }),
      { limit: 2 },
    );

    const top = result.recommendations[0]!;
    // Two equally weighted dimensions, nothing else: each carries half.
    expect(top.dimensions.safety.effectiveWeight).toBeCloseTo(0.5, 10);
    expect(top.dimensions.family.effectiveWeight).toBeCloseTo(0.5, 10);
  });

  it("keeps the internal sub-weights out of the user's top-level weights", () => {
    // Safety's 70/30 and family's 50/30/10/10 describe what each dimension
    // means, never how much it counts.
    const result = generateMatches(
      fullSet(),
      testProfile({ climatePreference: "mild" }),
      weightsWith({ safety: 0.2, housing: 0.8 }),
      { limit: 2 },
    );

    const top = result.recommendations[0]!;
    expect(top.dimensions.safety.effectiveWeight).toBeCloseTo(0.2, 10);
    expect(top.dimensions.housing.effectiveWeight).toBeCloseTo(0.8, 10);
  });

  it("keeps every total score inside 0-100", () => {
    const result = generateMatches(
      fullSet(),
      testProfile({ climatePreference: "mild" }),
      weightsWith({
        safety: 1,
        family: 1,
        housing: 1,
        career: 1,
        climate: 1,
        transport: 1,
        healthcare: 1,
      }),
      { limit: 2, occupation: NURSE },
    );

    for (const recommendation of result.recommendations) {
      expect(recommendation.totalScore).toBeGreaterThanOrEqual(0);
      expect(recommendation.totalScore).toBeLessThanOrEqual(100);
      for (const dimension of Object.values(recommendation.dimensions)) {
        if (dimension.normalizedScore === null) continue;
        expect(dimension.normalizedScore).toBeGreaterThanOrEqual(0);
        expect(dimension.normalizedScore).toBeLessThanOrEqual(100);
      }
    }
  });

  it("stays deterministic with both new dimensions in play", () => {
    const run = () =>
      generateMatches(
        fullSet(),
        testProfile({ climatePreference: "mild" }),
        weightsWith({ safety: 1, family: 1, housing: 0.5 }),
        { limit: 2 },
      );

    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it("still generates recommendations for a legacy profile", () => {
    // No bedrooms, no climate preference, no occupation — a profile written
    // before any personalisation existed.
    const result = generateMatches(
      fullSet(),
      testProfile({ desiredBedrooms: null, climatePreference: null }),
      weightsWith({ safety: 1, family: 1, housing: 1 }),
      { limit: 2 },
    );

    expect(result.recommendations.length).toBe(2);
    for (const recommendation of result.recommendations) {
      expect(recommendation.dimensions.safety.available).toBe(true);
      expect(recommendation.dimensions.family.available).toBe(true);
    }
  });
});

describe("Safety Fit is untouched by the family evidence correction", () => {
  it("still returns the unscaled composite for a fully covered metro", () => {
    const scores = scoreSafetyFit(fullSet());
    const a = scores.get(A)!;

    // Both rates published, so both components are present and the score is
    // the plain 70/30 composite with no evidence scaling of any kind.
    expect(a.detail.coverage).toBe(1);
    expect(a.detail.components).toHaveLength(2);
    expect(a.score).toBeCloseTo(
      a.detail.components.reduce((t, c) => t + c.score * c.weight, 0),
      10,
    );
  });

  it("carries no evidence-confidence field of its own", () => {
    const detail = scoreSafetyFit(fullSet()).get(A)!.detail;

    expect("evidenceConfidence" in detail).toBe(false);
    expect("rawScore" in detail).toBe(false);
  });

  it("still renormalises rather than scaling when one rate is missing", () => {
    const partial = scoreSafetyFit(
      fullSet().map((city) =>
        city.id === A
          ? {
              ...city,
              safety: { ...city.safety!, propertyCrimeRate: null },
            }
          : city,
      ),
    ).get(A)!;

    expect(partial.detail.coverage).toBeCloseTo(0.7, 10);
    // The surviving component carries the whole dimension, unscaled.
    expect(partial.score).toBe(partial.detail.components[0]!.score);
  });
});

describe("algorithm version", () => {
  it("stays at v2.1", () => {
    expect(MATCHING_ALGORITHM_VERSION).toBe("v2.1");
  });

  it("matches the database's widened version format", () => {
    // `recommendations.algorithm_version` accepts `^v[0-9]+(\.[0-9]+)?$`.
    const format = /^v\d+(\.\d+)?$/;

    expect(format.test(MATCHING_ALGORITHM_VERSION)).toBe(true);
    // Historical versions must still satisfy it, so no stored row is
    // invalidated by the change.
    expect(format.test("v1")).toBe(true);
    expect(format.test("v2")).toBe(true);
  });

  it("leaves safety and family out of the unscored registry", () => {
    expect(UNSCORED_DIMENSIONS).not.toContain("safety");
    expect(UNSCORED_DIMENSIONS).not.toContain("family");
  });
});

describe("deterministic explanations", () => {
  function reasonFor(dimension: "safety" | "family") {
    const scored = scoreCities(
      fullSet(),
      normalizeWeights(weightsWith({ [dimension]: 1 })),
      personalizationFor(testProfile({ climatePreference: "mild" })),
    );
    const best = scored.find((city) => city.city.id === A)!;
    return (
      buildReasons(best).find((reason) => reason.dimension === dimension) ??
      buildTradeoffs(best).find((reason) => reason.dimension === dimension)
    );
  }

  it("quotes both published crime rates and the source year", () => {
    const detail = reasonFor("safety")?.detail ?? "";

    expect(detail).toContain("FBI 2025");
    expect(detail).toContain("per 100,000");
    expect(detail).toContain("violent");
    expect(detail).toContain("property");
  });

  it("says the safety figure describes the whole metro area", () => {
    const detail = reasonFor("safety")?.detail ?? "";

    expect(detail).toContain("whole metro area");
  });

  it("never claims a city is safe or describes personal risk", () => {
    const detail = (reasonFor("safety")?.detail ?? "").toLowerCase();

    for (const forbidden of [
      "is safe",
      "safe city",
      "neighborhood",
      "neighbourhood",
      "downtown",
      "your risk",
      "personal safety",
    ]) {
      expect(detail).not.toContain(forbidden);
    }
  });

  it("distinguishes reported from estimated as the source does", () => {
    const detail = reasonFor("safety")?.detail ?? "";

    expect(detail).toMatch(/\b(reported|estimated)\b/);
  });

  it("frames partial family coverage as an evidence gap, not a judgement", () => {
    // B has schools but no FBI row, and scores poorly enough on the family
    // components to surface as a tradeoff, which is where the wording appears.
    const scored = scoreCities(
      fullSet().map((city) =>
        city.id === B ? { ...city, safety: null } : city,
      ),
      normalizeWeights(weightsWith({ family: 1 })),
      personalizationFor(testProfile({ climatePreference: "mild" })),
    );
    const partial = scored.find((city) => city.city.id === B)!;

    expect(partial.dimensions.family.detail).toMatchObject({
      kind: "family",
      coverage: 0.7,
      evidenceConfidence: 0.7,
    });

    const detail =
      (
        buildReasons(partial).find((r) => r.dimension === "family") ??
        buildTradeoffs(partial).find((r) => r.dimension === "family")
      )?.detail ?? "";

    expect(detail).toContain("Family evidence is incomplete");
    expect(detail).toContain("70% evidence coverage");
    expect(detail).toContain("reduced their ranking influence");

    // None of these framings is supportable from a missing dataset.
    const lower = detail.toLowerCase();
    for (const forbidden of [
      "less family-friendly",
      "unsafe",
      "dangerous",
      "confidence interval",
      "probability",
    ]) {
      expect(lower).not.toContain(forbidden);
    }
  });

  it("names the family components that were actually used", () => {
    const detail = reasonFor("family")?.detail ?? "";

    expect(detail).toContain("public schools");
    expect(detail).toContain("per 10,000 residents aged 5-17");
    expect(detail).toContain("metro safety");
    expect(detail).toContain("commute times");
    expect(detail).toContain("health-insurance coverage");
  });

  it("never presents school counts as school quality", () => {
    const detail = (reasonFor("family")?.detail ?? "").toLowerCase();

    for (const forbidden of [
      "quality",
      "best schools",
      "top schools",
      "rating",
      "ranked",
      "achievement",
      "test score",
    ]) {
      expect(detail).not.toContain(forbidden);
    }
  });
});
