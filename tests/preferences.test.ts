import { describe, expect, it } from "vitest";

import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import {
  preferenceWeightsSchema,
  preferencesInputSchema,
} from "@/lib/validation/preferences";
import type { PreferenceWeights } from "@/types/profile";

function weightsWith(overrides: Partial<PreferenceWeights> = {}) {
  const base = Object.fromEntries(
    PREFERENCE_WEIGHT_KEYS.map((key) => [key, 0.5]),
  ) as PreferenceWeights;

  return { ...base, ...overrides };
}

describe("preferenceWeightsSchema", () => {
  it("accepts a complete set of mid-range weights", () => {
    const result = preferenceWeightsSchema.safeParse(weightsWith());

    expect(result.success).toBe(true);
  });

  it("rejects a weight below 0", () => {
    const result = preferenceWeightsSchema.safeParse(
      weightsWith({ career: -0.01 }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "career",
    ]);
    expect(result.error?.issues[0]?.message).toBe("Weight must be at least 0");
  });

  it("rejects a weight above 1", () => {
    const result = preferenceWeightsSchema.safeParse(
      weightsWith({ housing: 1.01 }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "housing",
    ]);
    expect(result.error?.issues[0]?.message).toBe("Weight must be at most 1");
  });

  it("accepts the inclusive bounds 0 and 1", () => {
    const result = preferenceWeightsSchema.safeParse(
      weightsWith({ cost: 0, safety: 1 }),
    );

    expect(result.success).toBe(true);
  });

  it("reports every out-of-range dimension, not just the first", () => {
    const result = preferenceWeightsSchema.safeParse(
      weightsWith({ career: -1, climate: 2, family: 5 }),
    );

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map((issue) => issue.path.join(".")).sort(),
    ).toEqual(["career", "climate", "family"]);
  });

  it("requires every scoring dimension to be present", () => {
    const incomplete: Record<string, number> = { ...weightsWith() };
    delete incomplete.healthcare;

    const result = preferenceWeightsSchema.safeParse(incomplete);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "healthcare",
    ]);
  });

  it("rejects a non-numeric weight", () => {
    const result = preferenceWeightsSchema.safeParse({
      ...weightsWith(),
      transport: "0.5",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "transport",
    ]);
  });

  it("covers exactly the dimensions declared in constants", () => {
    const parsed = preferenceWeightsSchema.parse(weightsWith());

    expect(Object.keys(parsed).sort()).toEqual(
      [...PREFERENCE_WEIGHT_KEYS].sort(),
    );
  });
});

describe("preferencesInputSchema", () => {
  it("accepts a well-formed payload", () => {
    const result = preferencesInputSchema.safeParse({ weights: weightsWith() });

    expect(result.success).toBe(true);
  });

  it("surfaces the offending dimension under the weights key", () => {
    const result = preferencesInputSchema.safeParse({
      weights: weightsWith({ education: 1.5 }),
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "weights.education",
    ]);
  });
});
