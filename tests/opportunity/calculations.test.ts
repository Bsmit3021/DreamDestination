import { describe, expect, it } from "vitest";

import {
  compareBudget,
  describeConcentration,
} from "@/lib/opportunity/calculations";

describe("compareBudget", () => {
  it("reports a surplus when the budget exceeds the benchmark", () => {
    const result = compareBudget(1600, 1420);

    expect(result).not.toBeNull();
    expect(result!.difference).toBe(180);
    expect(result!.monthlyBudget).toBe(1600);
    expect(result!.benchmarkRent).toBe(1420);
    // 1420 / 1600 = 88.75%
    expect(result!.benchmarkPercentOfBudget).toBeCloseTo(88.75, 4);
  });

  it("reports a shortfall when the benchmark exceeds the budget", () => {
    const result = compareBudget(1600, 1850);

    expect(result!.difference).toBe(-250);
    expect(result!.benchmarkPercentOfBudget).toBeCloseTo(115.625, 4);
  });

  it("reports exactly zero when budget equals the benchmark", () => {
    const result = compareBudget(1500, 1500);

    expect(result!.difference).toBe(0);
    expect(result!.benchmarkPercentOfBudget).toBe(100);
  });

  it("returns null for a zero budget rather than claiming a shortfall", () => {
    // Phase 3 already reads 0 as "unspecified". Reporting "$1,420 short" to
    // someone who never stated a budget would be inventing a finding.
    expect(compareBudget(0, 1420)).toBeNull();
  });

  it("returns null for a missing budget", () => {
    expect(compareBudget(null, 1420)).toBeNull();
    expect(compareBudget(undefined, 1420)).toBeNull();
  });

  it("returns null for a negative budget", () => {
    expect(compareBudget(-100, 1420)).toBeNull();
  });

  it("returns null when the metro has no published rent benchmark", () => {
    // Missing rent must never be treated as $0 rent.
    expect(compareBudget(1600, null)).toBeNull();
  });

  it("returns null for a non-finite budget", () => {
    expect(compareBudget(Number.NaN, 1420)).toBeNull();
    expect(compareBudget(Number.POSITIVE_INFINITY, 1420)).toBeNull();
  });

  it("never produces a probability or verdict, only arithmetic", () => {
    const result = compareBudget(2000, 1500);

    expect(Object.keys(result!).sort()).toEqual([
      "benchmarkPercentOfBudget",
      "benchmarkRent",
      "difference",
      "monthlyBudget",
    ]);
  });
});

describe("describeConcentration", () => {
  it.each([
    [7.09, "Much more concentrated"],
    [1.6, "Much more concentrated"],
    [1.2, "More concentrated"],
    [1.0, "About as concentrated"],
    [0.9, "About as concentrated"],
    [0.6, "Less concentrated"],
    [0.2, "Much less concentrated"],
  ])("describes a location quotient of %s", (lq, expected) => {
    expect(describeConcentration(lq)).toContain(expected);
  });

  it("returns null when no location quotient is published", () => {
    expect(describeConcentration(null)).toBeNull();
  });

  it("never claims anything about hiring probability", () => {
    for (const lq of [0.1, 1, 5, 140]) {
      const text = describeConcentration(lq)!.toLowerCase();
      expect(text).not.toContain("hire");
      expect(text).not.toContain("chance");
      expect(text).not.toContain("probability");
      expect(text).not.toContain("opening");
    }
  });

  it("describes concentration relative to the national average, not jobs available", () => {
    expect(describeConcentration(1.0)).toContain("national average");
  });
});
