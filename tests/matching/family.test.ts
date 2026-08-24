import { describe, expect, it } from "vitest";

import {
  FAMILY_COMPONENT_WEIGHTS,
  SCHOOL_ACCESS_PER,
  schoolAccessRate,
  scoreFamilyFit,
  type FamilyInputs,
} from "@/lib/matching/family";
import { generateMatches } from "@/lib/matching/ranking";
import { scoreCities } from "@/lib/matching/scoring";
import { normalizeWeights } from "@/lib/matching/weights";

import {
  cityWith,
  personalizationFor,
  testProfile,
  weightsWith,
  withMetroData,
} from "./fixtures";

/**
 * Family Fit.
 *
 * The behaviour that matters: the composite must weight what it says it
 * weights, must refuse to produce a score without school evidence, and must
 * never be switched off because of what a user said about children.
 */

const A = "00000000-0000-4000-8000-00000000a001";
const B = "00000000-0000-4000-8000-00000000a002";
const C = "00000000-0000-4000-8000-00000000a003";

function schoolSet(
  rows: {
    id: string;
    schools?: number;
    schoolAge?: number | null;
    commute?: number;
    uninsured?: number;
    noRow?: boolean;
  }[],
) {
  return rows.map((row) =>
    withMetroData(
      cityWith(row.id, {
        housing: 1_200,
        transport: row.commute ?? 25,
        healthcare: row.uninsured ?? 8,
      }),
      {
        schools: row.noRow
          ? null
          : {
              publicSchoolCount: row.schools ?? 500,
              schoolAgePopulation:
                row.schoolAge === undefined ? 300_000 : row.schoolAge,
            },
      },
    ),
  );
}

/** Secondary inputs, all present unless a test removes one. */
function inputs(
  overrides: Record<string, Partial<FamilyInputs>> = {},
): Map<string, FamilyInputs> {
  const base: FamilyInputs = {
    safetyScore: 50,
    commuteScore: 50,
    healthcareScore: 50,
  };
  return new Map(
    [A, B, C].map((id) => [id, { ...base, ...(overrides[id] ?? {}) }]),
  );
}

describe("school access rate", () => {
  it("uses the school-age population as the denominator", () => {
    const rate = schoolAccessRate({
      schoolYear: "2024-2025",
      publicSchoolCount: 600,
      schoolAgePopulation: 300_000,
      populationPeriod: "2019-2023",
      source: null,
    });

    // 600 / 300,000 * 10,000 = 20 schools per 10k aged 5-17.
    expect(rate).toBe(20);
    expect(SCHOOL_ACCESS_PER).toBe(10_000);
  });

  it("returns null rather than Infinity for a zero denominator", () => {
    const rate = schoolAccessRate({
      schoolYear: "2024-2025",
      publicSchoolCount: 600,
      schoolAgePopulation: 0,
      populationPeriod: "2019-2023",
      source: null,
    });

    expect(rate).toBeNull();
  });

  it("returns null, not zero, when the denominator is unpublished", () => {
    // Missing population means an unknown rate. Zero would rank the metro as
    // having the worst school access in the country.
    const rate = schoolAccessRate({
      schoolYear: "2024-2025",
      publicSchoolCount: 600,
      schoolAgePopulation: null,
      populationPeriod: "2019-2023",
      source: null,
    });

    expect(rate).toBeNull();
  });

  it("treats a genuine zero school count as a real measurement", () => {
    const rate = schoolAccessRate({
      schoolYear: "2024-2025",
      publicSchoolCount: 0,
      schoolAgePopulation: 300_000,
      populationPeriod: "2019-2023",
      source: null,
    });

    expect(rate).toBe(0);
  });

  it("is deterministic", () => {
    const cities = schoolSet([
      { id: A, schools: 600, schoolAge: 300_000 },
      { id: B, schools: 300, schoolAge: 300_000 },
    ]);

    expect(JSON.stringify([...scoreFamilyFit(cities, inputs())])).toBe(
      JSON.stringify([...scoreFamilyFit(cities, inputs())]),
    );
  });

  it("ranks more schools per school-age resident higher", () => {
    const scores = scoreFamilyFit(
      schoolSet([
        { id: A, schools: 900, schoolAge: 300_000 },
        { id: B, schools: 300, schoolAge: 300_000 },
      ]),
      inputs(),
    );

    expect(scores.get(A)!.score).toBeGreaterThan(scores.get(B)!.score);
  });
});

describe("internal component weighting", () => {
  it("declares 50/30/10/10", () => {
    expect(FAMILY_COMPONENT_WEIGHTS.schoolAccess).toBe(0.5);
    expect(FAMILY_COMPONENT_WEIGHTS.safety).toBe(0.3);
    expect(FAMILY_COMPONENT_WEIGHTS.commute).toBe(0.1);
    expect(FAMILY_COMPONENT_WEIGHTS.healthcare).toBe(0.1);
    expect(
      Object.values(FAMILY_COMPONENT_WEIGHTS).reduce((a, b) => a + b, 0),
    ).toBeCloseTo(1, 10);
  });

  it("applies the declared weights when all four components exist", () => {
    const detail = scoreFamilyFit(
      schoolSet([
        { id: A, schools: 900, schoolAge: 300_000 },
        { id: B, schools: 300, schoolAge: 300_000 },
      ]),
      inputs(),
    ).get(A)!.detail;

    const weightOf = (key: string) =>
      detail.components.find((c) => c.key === key)!.weight;

    expect(weightOf("schoolAccess")).toBeCloseTo(0.5, 10);
    expect(weightOf("safety")).toBeCloseTo(0.3, 10);
    expect(weightOf("commute")).toBeCloseTo(0.1, 10);
    expect(weightOf("healthcare")).toBeCloseTo(0.1, 10);
    expect(detail.coverage).toBeCloseTo(1, 10);
  });

  it("computes the total as the weighted sum of its components", () => {
    const result = scoreFamilyFit(
      schoolSet([
        { id: A, schools: 900, schoolAge: 300_000 },
        { id: B, schools: 300, schoolAge: 300_000 },
      ]),
      inputs(),
    ).get(A)!;

    const expected = result.detail.components.reduce(
      (total, component) => total + component.score * component.weight,
      0,
    );

    expect(result.score).toBeCloseTo(expected, 10);
  });

  it("renormalises when a secondary component is missing", () => {
    const detail = scoreFamilyFit(
      schoolSet([
        { id: A, schools: 900, schoolAge: 300_000 },
        { id: B, schools: 300, schoolAge: 300_000 },
      ]),
      inputs({ [A]: { safetyScore: null } }),
    ).get(A)!.detail;

    expect(detail.components.map((c) => c.key)).not.toContain("safety");
    // 0.5 + 0.1 + 0.1 = 0.7 of intended weight survives, rescaled to 1.
    expect(detail.coverage).toBeCloseTo(0.7, 10);
    expect(detail.components.reduce((sum, c) => sum + c.weight, 0)).toBeCloseTo(
      1,
      10,
    );
    expect(
      detail.components.find((c) => c.key === "schoolAccess")!.weight,
    ).toBeCloseTo(0.5 / 0.7, 10);
  });

  it("does not recompute safety, it reuses the Safety Fit it is given", () => {
    const withStrongSafety = scoreFamilyFit(
      schoolSet([
        { id: A, schools: 600, schoolAge: 300_000 },
        { id: B, schools: 600, schoolAge: 300_000 },
      ]),
      inputs({ [A]: { safetyScore: 100 } }),
    ).get(A)!;

    expect(
      withStrongSafety.detail.components.find((c) => c.key === "safety")!.score,
    ).toBe(100);
  });
});

describe("school evidence is mandatory", () => {
  it("returns null when the metro has no school row", () => {
    const scores = scoreFamilyFit(
      schoolSet([
        { id: A, schools: 600, schoolAge: 300_000 },
        { id: B, noRow: true },
      ]),
      inputs(),
    );

    expect(scores.get(B)).toBeNull();
  });

  it("returns null when the school-age denominator is unpublished", () => {
    const scores = scoreFamilyFit(
      schoolSet([
        { id: A, schools: 600, schoolAge: 300_000 },
        { id: B, schools: 600, schoolAge: null },
      ]),
      inputs(),
    );

    expect(scores.get(B)).toBeNull();
  });

  it("refuses to score family from generic dimensions alone", () => {
    // Safety, commute and healthcare are all present and all excellent. Family
    // Fit must still be null: without school evidence it would just be a
    // relabelling of three dimensions the user already weights separately.
    const scores = scoreFamilyFit(
      schoolSet([
        { id: A, schools: 600, schoolAge: 300_000 },
        { id: B, noRow: true },
      ]),
      inputs({
        [B]: { safetyScore: 100, commuteScore: 100, healthcareScore: 100 },
      }),
    );

    expect(scores.get(B)).toBeNull();
  });

  it("returns null when school access is the only component available", () => {
    const scores = scoreFamilyFit(
      schoolSet([
        { id: A, schools: 600, schoolAge: 300_000 },
        { id: B, schools: 300, schoolAge: 300_000 },
      ]),
      inputs({
        [A]: {
          safetyScore: null,
          commuteScore: null,
          healthcareScore: null,
        },
      }),
    );

    expect(scores.get(A)).toBeNull();
  });

  it("scores with school access plus a single secondary component", () => {
    const result = scoreFamilyFit(
      schoolSet([
        { id: A, schools: 600, schoolAge: 300_000 },
        { id: B, schools: 300, schoolAge: 300_000 },
      ]),
      inputs({
        [A]: { safetyScore: 80, commuteScore: null, healthcareScore: null },
      }),
    ).get(A)!;

    expect(result.detail.components.map((c) => c.key).sort()).toEqual([
      "safety",
      "schoolAccess",
    ]);
    expect(result.detail.coverage).toBeCloseTo(0.8, 10);
  });
});

describe("range", () => {
  it("keeps every score within 0-100", () => {
    const scores = scoreFamilyFit(
      schoolSet([
        { id: A, schools: 2_000, schoolAge: 100_000 },
        { id: B, schools: 10, schoolAge: 900_000 },
        { id: C, schools: 600, schoolAge: 300_000 },
      ]),
      new Map([
        [A, { safetyScore: 100, commuteScore: 100, healthcareScore: 100 }],
        [B, { safetyScore: 0, commuteScore: 0, healthcareScore: 0 }],
        [C, { safetyScore: 50, commuteScore: 50, healthcareScore: 50 }],
      ]),
    );

    for (const [, result] of scores) {
      if (!result) continue;
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(Number.isFinite(result.score)).toBe(true);
    }
  });
});

describe("family priority is the user's to set, not inferred", () => {
  const familyCities = () =>
    schoolSet([
      { id: A, schools: 900, schoolAge: 300_000, commute: 22, uninsured: 5 },
      { id: B, schools: 300, schoolAge: 300_000, commute: 34, uninsured: 14 },
    ]).map((city) =>
      withMetroData(city, {
        safety: { violentCrimeRate: 200, propertyCrimeRate: 1_500 },
      }),
    );

  it("scores family for a user with no children", () => {
    // `children: 0` says nothing about whether someone is planning a family,
    // moving near relatives, or simply wants family-oriented surroundings.
    const scored = scoreCities(
      familyCities(),
      normalizeWeights(weightsWith({ family: 1 })),
      personalizationFor(testProfile({ children: 0, householdSize: 1 })),
    );

    for (const city of scored) {
      expect(city.dimensions.family.available).toBe(true);
      expect(city.dimensions.family.normalizedScore).not.toBeNull();
    }
  });

  it("gives the same family score whatever the household composition", () => {
    const scoreFor = (children: number, householdSize: number) =>
      scoreCities(
        familyCities(),
        normalizeWeights(weightsWith({ family: 1 })),
        personalizationFor(testProfile({ children, householdSize })),
      ).map((city) => city.dimensions.family.normalizedScore);

    expect(scoreFor(0, 1)).toEqual(scoreFor(3, 5));
  });

  it("lets the user's own family weight decide the contribution", () => {
    const heavy = generateMatches(
      familyCities(),
      testProfile(),
      weightsWith({ family: 1, housing: 0.1 }),
      { limit: 2 },
    ).recommendations.find((r) => r.city.id === A)!;

    const light = generateMatches(
      familyCities(),
      testProfile(),
      weightsWith({ family: 0.1, housing: 1 }),
      { limit: 2 },
    ).recommendations.find((r) => r.city.id === A)!;

    expect(heavy.dimensions.family.effectiveWeight).toBeGreaterThan(
      light.dimensions.family.effectiveWeight,
    );
    // Same underlying score; only how much of the total it carries changes.
    expect(heavy.dimensions.family.normalizedScore).toBe(
      light.dimensions.family.normalizedScore,
    );
  });

  it("no longer redistributes family weight away as unscorable", () => {
    const result = generateMatches(
      familyCities(),
      testProfile(),
      weightsWith({ family: 1 }),
      { limit: 2 },
    );

    expect(result.unscoredWeightedDimensions).not.toContain("family");
    expect(result.recommendations.length).toBeGreaterThan(0);
    // Family is the only weighted dimension, so it must carry the whole total.
    const top = result.recommendations[0]!;
    expect(top.dimensions.family.effectiveWeight).toBeCloseTo(1, 10);
    expect(top.dimensions.family.contribution).toBeCloseTo(top.totalScore, 10);
  });

  it("no longer redistributes safety weight away as unscorable", () => {
    const result = generateMatches(
      familyCities(),
      testProfile(),
      weightsWith({ safety: 1 }),
      { limit: 2 },
    );

    expect(result.unscoredWeightedDimensions).not.toContain("safety");
    const top = result.recommendations[0]!;
    expect(top.dimensions.safety.effectiveWeight).toBeCloseTo(1, 10);
    expect(top.dimensions.safety.contribution).toBeCloseTo(top.totalScore, 10);
  });
});

describe("evidence confidence scales an incompletely supported estimate", () => {
  /**
   * Renormalising gives the best estimate the available components support,
   * but it lands on the same 0-100 axis as a fully covered metro. The
   * adjustment is what stops those two being treated as equally well
   * supported. It says nothing about the metro itself.
   */
  function twoMetros() {
    return schoolSet([
      { id: A, schools: 900, schoolAge: 300_000 },
      { id: B, schools: 300, schoolAge: 300_000 },
    ]);
  }

  it("leaves a fully covered metro numerically unchanged", () => {
    const result = scoreFamilyFit(twoMetros(), inputs()).get(A)!;

    expect(result.detail.coverage).toBe(1);
    expect(result.detail.evidenceConfidence).toBe(1);
    expect(result.score).toBe(result.detail.rawScore);
  });

  it("gives confidence 0.70 when safety is missing", () => {
    const result = scoreFamilyFit(
      twoMetros(),
      inputs({ [A]: { safetyScore: null } }),
    ).get(A)!;

    expect(result.detail.coverage).toBeCloseTo(0.7, 10);
    expect(result.detail.evidenceConfidence).toBeCloseTo(0.7, 10);
    expect(result.score).toBeCloseTo(result.detail.rawScore * 0.7, 10);
  });

  it("gives confidence 0.90 when commute is missing", () => {
    const result = scoreFamilyFit(
      twoMetros(),
      inputs({ [A]: { commuteScore: null } }),
    ).get(A)!;

    expect(result.detail.evidenceConfidence).toBeCloseTo(0.9, 10);
    expect(result.score).toBeCloseTo(result.detail.rawScore * 0.9, 10);
  });

  it("gives confidence 0.90 when healthcare is missing", () => {
    const result = scoreFamilyFit(
      twoMetros(),
      inputs({ [A]: { healthcareScore: null } }),
    ).get(A)!;

    expect(result.detail.evidenceConfidence).toBeCloseTo(0.9, 10);
    expect(result.score).toBeCloseTo(result.detail.rawScore * 0.9, 10);
  });

  it("sums the intended weights actually supported when several are absent", () => {
    const result = scoreFamilyFit(
      twoMetros(),
      inputs({ [A]: { safetyScore: null, commuteScore: null } }),
    ).get(A)!;

    // school access 0.5 + healthcare 0.1 survive.
    expect(result.detail.evidenceConfidence).toBeCloseTo(0.6, 10);
    expect(result.score).toBeCloseTo(result.detail.rawScore * 0.6, 10);
  });

  it("keeps a missing component out of the raw estimate rather than zeroing it", () => {
    // If a missing safety score became 0, the raw estimate would drop. It must
    // stay the renormalised composite of what was actually available.
    const missing = scoreFamilyFit(
      twoMetros(),
      inputs({ [A]: { safetyScore: null } }),
    ).get(A)!;

    const expectedRaw = missing.detail.components.reduce(
      (total, component) => total + component.score * component.weight,
      0,
    );

    expect(missing.detail.rawScore).toBeCloseTo(expectedRaw, 10);
    expect(missing.detail.components.map((c) => c.key)).not.toContain("safety");
    // A zeroed safety component would have dragged the raw estimate below the
    // surviving components' own average; it did not.
    expect(missing.detail.rawScore).toBeGreaterThan(0);
  });

  it("stops a 70%-covered estimate ranking like a fully covered one", () => {
    // Identical underlying components; only the evidence differs.
    const scores = scoreFamilyFit(
      schoolSet([
        { id: A, schools: 900, schoolAge: 300_000 },
        { id: B, schools: 900, schoolAge: 300_000 },
      ]),
      inputs({ [B]: { safetyScore: null } }),
    );

    const covered = scores.get(A)!;
    const partial = scores.get(B)!;

    // The estimates are comparable...
    expect(partial.detail.rawScore).toBeCloseTo(covered.detail.rawScore, 10);
    // ...but the incompletely supported one carries less ranking influence.
    expect(partial.score).toBeLessThan(covered.score);
    expect(partial.score).toBeCloseTo(partial.detail.rawScore * 0.7, 10);
  });

  it("keeps evidence confidence inside 0-1", () => {
    const cases = [
      inputs(),
      inputs({ [A]: { safetyScore: null } }),
      inputs({ [A]: { commuteScore: null, healthcareScore: null } }),
    ];

    for (const input of cases) {
      for (const [, result] of scoreFamilyFit(twoMetros(), input)) {
        if (!result) continue;
        expect(result.detail.evidenceConfidence).toBeGreaterThan(0);
        expect(result.detail.evidenceConfidence).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps the effective score inside 0-100", () => {
    const scores = scoreFamilyFit(
      schoolSet([
        { id: A, schools: 2_000, schoolAge: 100_000 },
        { id: B, schools: 10, schoolAge: 900_000 },
        { id: C, schools: 600, schoolAge: 300_000 },
      ]),
      new Map([
        [A, { safetyScore: 100, commuteScore: 100, healthcareScore: 100 }],
        [B, { safetyScore: null, commuteScore: 0, healthcareScore: 0 }],
        [C, { safetyScore: 50, commuteScore: null, healthcareScore: 50 }],
      ]),
    );

    for (const [, result] of scores) {
      if (!result) continue;
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.detail.rawScore).toBeGreaterThanOrEqual(result.score);
    }
  });

  it("still returns null without school evidence, before any adjustment", () => {
    const scores = scoreFamilyFit(
      schoolSet([
        { id: A, schools: 600, schoolAge: 300_000 },
        { id: B, noRow: true },
      ]),
      inputs(),
    );

    expect(scores.get(B)).toBeNull();
  });

  it("stays deterministic with the adjustment in place", () => {
    const cities = twoMetros();
    const input = inputs({ [B]: { safetyScore: null } });

    expect(JSON.stringify([...scoreFamilyFit(cities, input)])).toBe(
      JSON.stringify([...scoreFamilyFit(cities, input)]),
    );
  });
});
