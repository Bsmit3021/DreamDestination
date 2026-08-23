import { describe, expect, it } from "vitest";

import {
  CAREER_COMPONENT_WEIGHTS,
  CAREER_EVIDENCE_CONFIDENCE,
  MIN_OCCUPATION_INDICATORS,
  employmentDepthValue,
  scoreCareerFit,
  type OccupationTarget,
} from "@/lib/matching/career";
import { generateMatches } from "@/lib/matching/ranking";

import {
  GOLDEN_CITIES,
  cityWith,
  testProfile,
  weightsWith,
  withMetroData,
} from "./fixtures";

/**
 * Career Fit V2.
 *
 * The behaviour that matters: the user's own occupation must be able to move
 * the score and the ranking, suppressed BLS fields must never read as zero,
 * and a score built on too little occupational evidence must say so rather
 * than pretend.
 */

/** Three metros carrying OEWS rows for one occupation. */
function careerSet(
  rows: {
    id: string;
    wage?: number | null;
    lq?: number | null;
    per1000?: number | null;
    employment?: number | null;
    unemployment?: number;
  }[],
) {
  return rows.map((row) =>
    withMetroData(cityWith(row.id, { career: row.unemployment ?? 4 }), {
      career: {
        medianAnnualWage: row.wage ?? null,
        locationQuotient: row.lq ?? null,
        employmentPer1000: row.per1000 ?? null,
        employment: row.employment ?? null,
      },
    }),
  );
}

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const C = "00000000-0000-4000-8000-0000000000c1";

describe("occupation changes Career Fit", () => {
  it("gives the same metro different scores for two different occupations", () => {
    // Same city, same unemployment; only the OEWS row differs.
    const asDeveloper = careerSet([
      { id: A, wage: 130_000, lq: 1.6, per1000: 22, employment: 6_000 },
      { id: B, wage: 90_000, lq: 0.7, per1000: 8, employment: 2_000 },
    ]);
    const asNurse = careerSet([
      { id: A, wage: 78_000, lq: 0.6, per1000: 9, employment: 3_000 },
      { id: B, wage: 96_000, lq: 1.4, per1000: 21, employment: 7_000 },
    ]);

    const devScore = scoreCareerFit(asDeveloper).get(A)!.score;
    const nurseScore = scoreCareerFit(asNurse).get(A)!.score;

    expect(devScore).not.toBeCloseTo(nurseScore, 5);
    expect(devScore).toBeGreaterThan(nurseScore);
  });

  it("can reorder recommendations when career carries real weight", () => {
    const base = [
      cityWith(A, { career: 4, housing: 1200, cost: 28 }),
      cityWith(B, { career: 4, housing: 1200, cost: 28 }),
    ];

    // Identical on everything except which metro the occupation thrives in.
    const favoursA = base.map((city, index) =>
      withMetroData(city, {
        career:
          index === 0
            ? {
                medianAnnualWage: 140_000,
                locationQuotient: 1.8,
                employmentPer1000: 24,
                employment: 8_000,
              }
            : {
                medianAnnualWage: 85_000,
                locationQuotient: 0.5,
                employmentPer1000: 6,
                employment: 1_500,
              },
      }),
    );
    const favoursB = base.map((city, index) =>
      withMetroData(city, {
        career:
          index === 0
            ? {
                medianAnnualWage: 85_000,
                locationQuotient: 0.5,
                employmentPer1000: 6,
                employment: 1_500,
              }
            : {
                medianAnnualWage: 140_000,
                locationQuotient: 1.8,
                employmentPer1000: 24,
                employment: 8_000,
              },
      }),
    );

    const weights = weightsWith({ career: 1 });
    const profile = testProfile();

    const firstWhenAFavoured = generateMatches(favoursA, profile, weights, {
      limit: 2,
    }).recommendations[0]!.city.id;
    const firstWhenBFavoured = generateMatches(favoursB, profile, weights, {
      limit: 2,
    }).recommendations[0]!.city.id;

    expect(firstWhenAFavoured).toBe(A);
    expect(firstWhenBFavoured).toBe(B);
  });
});

describe("suppressed and missing OEWS data", () => {
  it("never turns a suppressed wage into zero", () => {
    const cities = careerSet([
      { id: A, wage: null, lq: 1.2, per1000: 15, employment: 4_000 },
      { id: B, wage: 120_000, lq: 1.1, per1000: 14, employment: 4_100 },
    ]);

    const detail = scoreCareerFit(cities).get(A)!.detail;

    expect(detail.medianAnnualWage).toBeNull();
    expect(detail.components.some((c) => c.key === "medianWage")).toBe(false);
    // A metro missing only its wage keeps a real score, not a zeroed one.
    expect(scoreCareerFit(cities).get(A)!.score).toBeGreaterThan(0);
  });

  it("keeps a top-coded wage out of scoring rather than treating it as high", () => {
    const cities = careerSet([
      { id: A, lq: 1.2, per1000: 15, employment: 4_000 },
      { id: B, lq: 0.8, per1000: 9, employment: 2_000 },
    ]).map((city, index) =>
      index === 0
        ? withMetroData(city, {
            career: {
              medianAnnualWage: 239_200,
              wageTopCoded: true,
              locationQuotient: 1.2,
              employmentPer1000: 15,
              employment: 4_000,
            },
          })
        : city,
    );

    const detail = scoreCareerFit(cities).get(A)!.detail;

    expect(detail.wageTopCoded).toBe(true);
    expect(detail.medianAnnualWage).toBeNull();
    expect(detail.components.some((c) => c.key === "medianWage")).toBe(false);
  });

  it("one suppressed field does not invalidate an otherwise supported score", () => {
    // Three of four occupational indicators present.
    const cities = careerSet([
      { id: A, wage: null, lq: 1.3, per1000: 16, employment: 5_000 },
      { id: B, wage: 100_000, lq: 0.9, per1000: 10, employment: 2_500 },
    ]);

    const result = scoreCareerFit(cities).get(A)!;

    expect(result.detail.basis).toBe("occupation_specific");
    expect(result.detail.occupationIndicators).toBe(3);
    expect(result.detail.coverage).toBeLessThan(1);
    expect(result.detail.coverage).toBeGreaterThan(0);
  });

  it("renormalises component weights over what survived", () => {
    const cities = careerSet([
      { id: A, wage: null, lq: 1.3, per1000: 16, employment: 5_000 },
      { id: B, wage: 100_000, lq: 0.9, per1000: 10, employment: 2_500 },
    ]);

    const components = scoreCareerFit(cities).get(A)!.detail.components;
    const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);

    expect(totalWeight).toBeCloseTo(1, 10);
  });

  it("falls back to the general labour market below the evidence threshold", () => {
    // Only one occupational indicator: not enough to claim it is occupational.
    const cities = careerSet([
      { id: A, lq: 1.4, unemployment: 3 },
      {
        id: B,
        wage: 100_000,
        lq: 0.9,
        per1000: 10,
        employment: 2_500,
        unemployment: 6,
      },
    ]);

    const detail = scoreCareerFit(cities).get(A)!.detail;

    expect(detail.occupationIndicators).toBeLessThan(MIN_OCCUPATION_INDICATORS);
    expect(detail.basis).toBe("general_labor_market");
    expect(detail.components.map((c) => c.key)).toEqual(["generalLaborMarket"]);
  });

  it("uses the general labour market when the user has no occupation at all", () => {
    const cities = [
      withMetroData(cityWith(A, { career: 3 }), { career: null }),
      withMetroData(cityWith(B, { career: 7 }), { career: null }),
    ];

    const result = scoreCareerFit(cities).get(A)!;

    expect(result.detail.basis).toBe("general_labor_market");
    expect(result.detail.occupation).toBeNull();
    // Lower unemployment still wins, so recommendations stay usable.
    expect(result.score).toBeGreaterThan(scoreCareerFit(cities).get(B)!.score);
  });

  it("returns null only when there is no career evidence whatsoever", () => {
    const cities = [
      withMetroData(cityWith(A, { housing: 1200 }), { career: null }),
    ];

    expect(scoreCareerFit(cities).get(A)).toBeNull();
  });
});

describe("employment depth does not smuggle in metro size", () => {
  it("compresses raw employment logarithmically", () => {
    expect(employmentDepthValue(0)).toBe(0);
    // A 10x larger market is better placed, but nowhere near 10x better.
    const small = employmentDepthValue(1_000);
    const large = employmentDepthValue(10_000);

    expect(large).toBeGreaterThan(small);
    expect(large / small).toBeLessThan(2);
  });

  it("does not let a huge metro dominate on employment alone", () => {
    // B employs 50x more people, but is worse on every per-capita measure.
    const cities = careerSet([
      { id: A, wage: 130_000, lq: 1.9, per1000: 25, employment: 2_000 },
      { id: B, wage: 95_000, lq: 0.6, per1000: 5, employment: 100_000 },
    ]);

    const scores = scoreCareerFit(cities);

    expect(scores.get(A)!.score).toBeGreaterThan(scores.get(B)!.score);
  });

  it("caps employment depth at its declared share of the dimension", () => {
    expect(CAREER_COMPONENT_WEIGHTS.employmentDepth).toBe(0.1);
    expect(
      Object.values(CAREER_COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0),
    ).toBeCloseTo(1, 10);
  });
});

describe("career scores stay in range and deterministic", () => {
  it("keeps every score within 0-100", () => {
    const cities = careerSet([
      { id: A, wage: 200_000, lq: 5, per1000: 60, employment: 90_000 },
      { id: B, wage: 40_000, lq: 0.1, per1000: 1, employment: 20 },
      { id: C, wage: 100_000, lq: 1, per1000: 12, employment: 3_000 },
    ]);

    for (const [, result] of scoreCareerFit(cities)) {
      if (!result) continue;
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(Number.isFinite(result.score)).toBe(true);
    }
  });

  it("produces identical output on repeated runs", () => {
    const cities = careerSet([
      { id: A, wage: 130_000, lq: 1.6, per1000: 22, employment: 6_000 },
      { id: B, wage: 90_000, lq: 0.7, per1000: 8, employment: 2_000 },
    ]);

    const first = scoreCareerFit(cities).get(A)!.score;
    const second = scoreCareerFit(cities).get(A)!.score;

    expect(first).toBe(second);
  });

  it("leaves the golden fixture's careerless cities scoring on unemployment", () => {
    const scores = scoreCareerFit(GOLDEN_CITIES);

    for (const city of GOLDEN_CITIES) {
      const result = scores.get(city.id);
      if (result) expect(result.detail.basis).toBe("general_labor_market");
    }
  });
});

describe("evidence confidence separates the three career bases", () => {
  /**
   * The distinction this proves.
   *
   * `fallback` has the best unemployment rate in the set but no OEWS row. What
   * that means depends entirely on whether an occupation was asked about:
   *
   *  - asked about, not published here  → a substitution, discounted
   *  - never asked about                → the intended measurement, not discounted
   *
   * Collapsing those two into one basis was the bug. The real-data case was
   * Registered Nurses, where Durham led the field at 89.5 with no published RN
   * wage at all.
   */
  const NURSE: OccupationTarget = {
    socCode: "29-1141",
    title: "Registered Nurses",
  };

  function mixedSet() {
    return careerSet([
      // Full OEWS, mid-pack unemployment.
      {
        id: A,
        wage: 120_000,
        lq: 1.4,
        per1000: 18,
        employment: 5_000,
        unemployment: 4.5,
      },
      {
        id: B,
        wage: 95_000,
        lq: 0.9,
        per1000: 11,
        employment: 2_500,
        unemployment: 5.0,
      },
      // No OEWS at all, best unemployment in the set.
      { id: C, unemployment: 2.0 },
    ]);
  }

  /** Cities with no OEWS rows at all, as a user with no occupation sees them. */
  function genericSet() {
    return careerSet([
      { id: A, unemployment: 4.5 },
      { id: B, unemployment: 5.0 },
      { id: C, unemployment: 2.0 },
    ]);
  }

  it("uses a confidence of 1.0 for an occupation-specific score", () => {
    const result = scoreCareerFit(mixedSet(), NURSE).get(A)!;

    expect(result.detail.basis).toBe("occupation_specific");
    expect(result.detail.evidenceConfidence).toBe(1);
    expect(CAREER_EVIDENCE_CONFIDENCE.occupation_specific).toBe(1);
  });

  it("uses a confidence of 0.65 when a requested occupation is unpublished", () => {
    const result = scoreCareerFit(mixedSet(), NURSE).get(C)!;

    expect(result.detail.basis).toBe("occupation_data_fallback");
    expect(result.detail.evidenceConfidence).toBe(0.65);
    expect(CAREER_EVIDENCE_CONFIDENCE.occupation_data_fallback).toBe(0.65);
  });

  it("uses a confidence of 1.0 when no occupation was selected", () => {
    const result = scoreCareerFit(genericSet(), null).get(C)!;

    expect(result.detail.basis).toBe("general_labor_market");
    expect(result.detail.evidenceConfidence).toBe(1);
    expect(CAREER_EVIDENCE_CONFIDENCE.general_labor_market).toBe(1);
  });

  it("makes the effective occupation-fallback score exactly raw x 0.65", () => {
    const result = scoreCareerFit(mixedSet(), NURSE).get(C)!;

    expect(result.score).toBeCloseTo(result.detail.rawScore * 0.65, 10);
    expect(result.score).toBeLessThan(result.detail.rawScore);
  });

  it("makes the no-occupation effective score equal to the raw score", () => {
    for (const [, result] of scoreCareerFit(genericSet(), null)) {
      if (!result) continue;
      expect(result.detail.basis).toBe("general_labor_market");
      expect(result.score).toBe(result.detail.rawScore);
    }
  });

  it("leaves an occupation-specific score completely unpenalised", () => {
    const result = scoreCareerFit(mixedSet(), NURSE).get(A)!;

    expect(result.score).toBe(result.detail.rawScore);
  });

  it("scores the same city differently depending only on whether an occupation was asked about", () => {
    // The single fact that changes is the caller's occupation argument.
    const asked = scoreCareerFit(mixedSet(), NURSE).get(C)!;
    const notAsked = scoreCareerFit(mixedSet(), null).get(C)!;

    expect(asked.detail.rawScore).toBe(notAsked.detail.rawScore);
    expect(asked.score).toBeLessThan(notAsked.score);
    expect(notAsked.score).toBe(notAsked.detail.rawScore);
  });

  it("stops a high unpublished-occupation score keeping an occupation-equivalent value", () => {
    const fallback = scoreCareerFit(mixedSet(), NURSE).get(C)!;

    // It holds the best unemployment rate of the three, so the raw score tops
    // the general-labour-market population: mid-rank percentile 83.33.
    expect(fallback.detail.rawScore).toBeCloseTo(83.3333, 4);
    // But the score that ranks it is not an occupation-equivalent 83.
    expect(fallback.score).toBeCloseTo(54.1667, 4);
  });

  it("no longer lets an unpublished-occupation metro outrank a fully supported one", () => {
    const scores = scoreCareerFit(mixedSet(), NURSE);
    const supported = scores.get(A)!;
    const fallback = scores.get(C)!;

    // Pre-correction the generic metro won on raw score alone.
    expect(fallback.detail.rawScore).toBeGreaterThan(supported.detail.rawScore);
    // After it, occupational evidence carries the ranking.
    expect(fallback.score).toBeLessThan(supported.score);
  });

  it("names the requested occupation even where BLS returned no row at all", () => {
    // Not merely an all-null OEWS row: no row whatsoever, which is what a
    // metro looks like when BLS publishes nothing for the occupation. The
    // explanation still has to be able to say which occupation went missing.
    const cities = [...mixedSet().slice(0, 2), cityWith(C, { career: 2.0 })];

    const fallback = scoreCareerFit(cities, NURSE).get(C)!;

    expect(fallback.detail.basis).toBe("occupation_data_fallback");
    expect(fallback.detail.occupation).toEqual(NURSE);
    expect(fallback.detail.evidenceConfidence).toBe(0.65);
  });

  it("reports no occupation when none was asked about", () => {
    const generic = scoreCareerFit(
      [cityWith(A, { career: 4 }), cityWith(B, { career: 6 })],
      null,
    ).get(A)!;

    expect(generic.detail.basis).toBe("general_labor_market");
    expect(generic.detail.occupation).toBeNull();
  });

  it("does not apply the fallback factor for a merely partial occupation score", () => {
    // Two of four indicators: enough to stay occupation-specific, so the
    // component renormalisation handles the gap and confidence stays 1.0.
    // Charging for the same suppression twice would penalise a metro for BLS
    // publication rules rather than for missing occupational evidence.
    const cities = careerSet([
      { id: A, wage: 120_000, lq: 1.4 },
      { id: B, wage: 95_000, lq: 0.9, per1000: 11, employment: 2_500 },
    ]);

    const partial = scoreCareerFit(cities, NURSE).get(A)!;

    expect(partial.detail.occupationIndicators).toBe(MIN_OCCUPATION_INDICATORS);
    expect(partial.detail.basis).toBe("occupation_specific");
    expect(partial.detail.evidenceConfidence).toBe(1);
    expect(partial.detail.coverage).toBeLessThan(1);
    expect(partial.score).toBe(partial.detail.rawScore);
  });

  it("keeps suppression handling untouched by the basis split", () => {
    // A suppressed wage is still excluded rather than zeroed, and still leaves
    // an otherwise-supported metro occupation-specific.
    const cities = careerSet([
      { id: A, wage: null, lq: 1.4, per1000: 18, employment: 5_000 },
      { id: B, wage: 95_000, lq: 0.9, per1000: 11, employment: 2_500 },
    ]);

    const suppressed = scoreCareerFit(cities, NURSE).get(A)!;

    expect(suppressed.detail.basis).toBe("occupation_specific");
    expect(suppressed.detail.medianAnnualWage).toBeNull();
    expect(suppressed.detail.evidenceConfidence).toBe(1);
    expect(suppressed.score).toBeGreaterThan(0);
    expect(
      suppressed.detail.components.some((c) => c.key === "medianWage"),
    ).toBe(false);
  });

  it("does not weaken the career priority of a user who named no occupation", () => {
    // The same weights, the same cities, the only difference being that no
    // occupation was asked about. Career must contribute its full weight.
    const cities = genericSet();
    const weights = weightsWith({ career: 1 });

    const { recommendations } = generateMatches(
      cities,
      testProfile(),
      weights,
      { limit: 3 },
    );

    for (const recommendation of recommendations) {
      const career = recommendation.dimensions.career;
      expect(career.available).toBe(true);
      expect(career.detail?.kind).toBe("career");
      if (career.detail?.kind !== "career") continue;

      expect(career.detail.basis).toBe("general_labor_market");
      expect(career.detail.evidenceConfidence).toBe(1);
      expect(career.normalizedScore).toBe(career.detail.rawScore);
      // Career is the only weighted dimension, so its contribution is the total.
      expect(career.contribution).toBeCloseTo(recommendation.totalScore, 10);
    }
  });

  it("still produces valid recommendations when no occupation is known", () => {
    const { recommendations } = generateMatches(
      GOLDEN_CITIES,
      testProfile(),
      weightsWith({ career: 1 }),
      { limit: 4 },
    );

    expect(recommendations).toHaveLength(4);
    for (const recommendation of recommendations) {
      const career = recommendation.dimensions.career;
      expect(career.available).toBe(true);
      expect(career.normalizedScore).toBeGreaterThanOrEqual(0);
      expect(career.normalizedScore).toBeLessThanOrEqual(100);
      if (career.detail?.kind !== "career") continue;
      expect(career.detail.evidenceConfidence).toBe(1);
    }
  });

  it("keeps the adjustment rank-preserving within a single basis", () => {
    const scores = scoreCareerFit(genericSet(), NURSE);

    const byRaw = [A, B, C].sort(
      (x, y) => scores.get(y)!.detail.rawScore - scores.get(x)!.detail.rawScore,
    );
    const byEffective = [A, B, C].sort(
      (x, y) => scores.get(y)!.score - scores.get(x)!.score,
    );

    expect(byEffective).toEqual(byRaw);
  });

  it("keeps DreamScore deterministic for a no-occupation user", () => {
    const cities = genericSet();
    const weights = weightsWith({ career: 1, housing: 0.5, climate: 0.3 });

    const first = generateMatches(cities, testProfile(), weights, { limit: 3 });
    const second = generateMatches(cities, testProfile(), weights, {
      limit: 3,
    });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("keeps DreamScore deterministic with an occupation in play", () => {
    const cities = mixedSet();
    const weights = weightsWith({ career: 1, housing: 0.5, climate: 0.3 });
    const options = { limit: 3, occupation: NURSE };

    const first = generateMatches(cities, testProfile(), weights, options);
    const second = generateMatches(cities, testProfile(), weights, options);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("keeps every effective score inside 0-100", () => {
    for (const [, result] of scoreCareerFit(mixedSet(), NURSE)) {
      if (!result) continue;
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.detail.rawScore).toBeGreaterThanOrEqual(result.score);
    }
  });
});
