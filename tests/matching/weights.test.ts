import { describe, expect, it } from "vitest";

import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import {
  UNIFORM_WEIGHT_TOLERANCE,
  effectiveWeightsFor,
  hasUniformWeights,
  normalizeWeights,
} from "@/lib/matching/weights";
import type { PreferenceWeightKey, PreferenceWeights } from "@/types/profile";

import { weightsWith, zeroWeights } from "./fixtures";

function sum(values: Record<PreferenceWeightKey, number>): number {
  return PREFERENCE_WEIGHT_KEYS.reduce((total, key) => total + values[key], 0);
}

function uniformAt(value: number): PreferenceWeights {
  return Object.fromEntries(
    PREFERENCE_WEIGHT_KEYS.map((key) => [key, value]),
  ) as PreferenceWeights;
}

describe("hasUniformWeights", () => {
  it("reports every slider at zero as uniform", () => {
    expect(hasUniformWeights(zeroWeights())).toBe(true);
  });

  it.each([0.05, 0.5, 1])("reports every slider at %s as uniform", (value) => {
    expect(hasUniformWeights(uniformAt(value))).toBe(true);
  });

  it("agrees with normalisation: uniform sliders mean equal shares", () => {
    const normalized = normalizeWeights(uniformAt(0.7));

    for (const key of PREFERENCE_WEIGHT_KEYS) {
      expect(normalized[key]).toBeCloseTo(1 / PREFERENCE_WEIGHT_KEYS.length);
    }
  });

  it("treats one slider moved a single step as varied", () => {
    expect(hasUniformWeights({ ...uniformAt(0.5), career: 0.55 })).toBe(false);
  });

  it.each(PREFERENCE_WEIGHT_KEYS)(
    "treats the smallest storable difference on %s as varied",
    (key) => {
      // 0.001 is the precision of the numeric(4, 3) weight columns.
      expect(hasUniformWeights({ ...uniformAt(0.5), [key]: 0.501 })).toBe(
        false,
      );
      expect(hasUniformWeights({ ...uniformAt(0.5), [key]: 0.499 })).toBe(
        false,
      );
    },
  );

  it("treats a single non-zero slider as varied", () => {
    expect(hasUniformWeights(weightsWith({ safety: 0.001 }))).toBe(false);
  });

  it("absorbs floating-point noise, not user-visible differences", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in IEEE 754.
    expect(hasUniformWeights({ ...uniformAt(0.3), cost: 0.1 + 0.2 })).toBe(
      true,
    );
    expect(
      hasUniformWeights({ ...zeroWeights(), family: UNIFORM_WEIGHT_TOLERANCE }),
    ).toBe(true);
    expect(
      hasUniformWeights({
        ...zeroWeights(),
        family: UNIFORM_WEIGHT_TOLERANCE * 2,
      }),
    ).toBe(false);
  });
});

describe("normalizeWeights", () => {
  it("rescales to sum to exactly 1", () => {
    const result = normalizeWeights(
      weightsWith({ housing: 1, career: 1, climate: 2 }),
    );

    expect(sum(result)).toBeCloseTo(1, 10);
    expect(result.housing).toBeCloseTo(0.25, 10);
    expect(result.career).toBeCloseTo(0.25, 10);
    expect(result.climate).toBeCloseTo(0.5, 10);
  });

  it("preserves relative importance, not absolute slider values", () => {
    const small = normalizeWeights(weightsWith({ housing: 0.1, career: 0.2 }));
    const large = normalizeWeights(weightsWith({ housing: 0.5, career: 1.0 }));

    expect(small.housing).toBeCloseTo(large.housing, 10);
    expect(small.career).toBeCloseTo(large.career, 10);
  });

  it("spreads weight equally when every slider is zero", () => {
    const result = normalizeWeights(zeroWeights());

    expect(sum(result)).toBeCloseTo(1, 10);
    for (const key of PREFERENCE_WEIGHT_KEYS) {
      expect(result[key]).toBeCloseTo(1 / PREFERENCE_WEIGHT_KEYS.length, 10);
    }
  });

  it("gives a single non-zero dimension all of the weight", () => {
    const result = normalizeWeights(weightsWith({ safety: 0.3 }));

    expect(result.safety).toBe(1);
    expect(result.housing).toBe(0);
    expect(sum(result)).toBeCloseTo(1, 10);
  });

  it("treats every slider at maximum as equal weighting", () => {
    const allOnes = Object.fromEntries(
      PREFERENCE_WEIGHT_KEYS.map((key) => [key, 1]),
    ) as Record<PreferenceWeightKey, number>;

    const result = normalizeWeights(allOnes);

    for (const key of PREFERENCE_WEIGHT_KEYS) {
      expect(result[key]).toBeCloseTo(0.1, 10);
    }
  });

  it("rejects negative weights", () => {
    expect(() => normalizeWeights(weightsWith({ housing: -1 }))).toThrow(
      /negative/,
    );
  });

  it("rejects non-finite weights", () => {
    expect(() =>
      normalizeWeights(weightsWith({ housing: Number.NaN })),
    ).toThrow(/finite/);
  });
});

describe("effectiveWeightsFor", () => {
  it("renormalises over the available dimensions", () => {
    const normalized = normalizeWeights(
      weightsWith({ housing: 1, career: 1, safety: 2 }),
    );
    // safety unavailable: housing and career must absorb its share.
    const effective = effectiveWeightsFor(
      normalized,
      new Set<PreferenceWeightKey>(["housing", "career"]),
    );

    expect(effective.weights.housing).toBeCloseTo(0.5, 10);
    expect(effective.weights.career).toBeCloseTo(0.5, 10);
    expect(effective.weights.safety).toBe(0);
    expect(sum(effective.weights)).toBeCloseTo(1, 10);
  });

  it("reports coverage as the share of user weight that is measurable", () => {
    const normalized = normalizeWeights(
      weightsWith({ housing: 1, career: 1, safety: 2 }),
    );

    const effective = effectiveWeightsFor(
      normalized,
      new Set<PreferenceWeightKey>(["housing", "career"]),
    );

    // housing + career = 2 of 4 total weight.
    expect(effective.coverage).toBeCloseTo(0.5, 10);
    expect(effective.covered.sort()).toEqual(["career", "housing"]);
    expect(effective.missing).toEqual(["safety"]);
  });

  it("reports zero coverage when the only weighted dimension is unavailable", () => {
    const normalized = normalizeWeights(weightsWith({ safety: 1 }));

    const effective = effectiveWeightsFor(
      normalized,
      new Set<PreferenceWeightKey>(["housing"]),
    );

    expect(effective.coverage).toBe(0);
    expect(sum(effective.weights)).toBe(0);
  });

  it("does not list unweighted dimensions as missing", () => {
    const normalized = normalizeWeights(weightsWith({ housing: 1 }));

    const effective = effectiveWeightsFor(
      normalized,
      new Set<PreferenceWeightKey>(["housing"]),
    );

    // The user put no weight on the other nine, so nothing is "missing".
    expect(effective.missing).toEqual([]);
    expect(effective.coverage).toBeCloseTo(1, 10);
  });

  it("never divides by zero when nothing is available", () => {
    const normalized = normalizeWeights(weightsWith({ housing: 1 }));

    const effective = effectiveWeightsFor(
      normalized,
      new Set<PreferenceWeightKey>(),
    );

    for (const key of PREFERENCE_WEIGHT_KEYS) {
      expect(Number.isFinite(effective.weights[key])).toBe(true);
    }
    expect(effective.coverage).toBe(0);
  });
});
