import { describe, expect, it } from "vitest";

import {
  clampScore,
  percentileRank,
  percentileScore,
  targetDistanceScore,
  winsorizedMinMaxScore,
} from "@/lib/matching/normalization";

describe("percentileRank", () => {
  it("places a value by the share of the population it beats", () => {
    // Mid-rank: (below + equal/2) / n. For 10 below out of 20, plus itself.
    expect(percentileRank(5, [1, 2, 3, 4, 5])).toBe(90);
    expect(percentileRank(1, [1, 2, 3, 4, 5])).toBe(10);
    expect(percentileRank(3, [1, 2, 3, 4, 5])).toBe(50);
  });

  it("gives tied values identical scores", () => {
    const population = [10, 10, 20, 20];

    expect(percentileRank(10, population)).toBe(percentileRank(10, population));
    expect(percentileRank(10, population)).toBe(25);
    expect(percentileRank(20, population)).toBe(75);
  });

  it("does not depend on the order the population arrives in", () => {
    const ascending = [1, 2, 3, 4];
    const shuffled = [3, 1, 4, 2];

    expect(percentileRank(3, ascending)).toBe(percentileRank(3, shuffled));
  });

  it("returns 50 when every value is identical", () => {
    // Nothing distinguishes the candidates, so nothing should be preferred.
    expect(percentileRank(7, [7, 7, 7])).toBe(50);
  });

  it("returns 50 for a single candidate", () => {
    expect(percentileRank(42, [42])).toBe(50);
  });

  it("is unmoved by an extreme outlier", () => {
    const withoutOutlier = [1, 2, 3, 4];
    const withOutlier = [1, 2, 3, 4_000_000];

    // The middle values keep their relative standing; min-max would not.
    expect(percentileRank(2, withoutOutlier)).toBe(
      percentileRank(2, withOutlier),
    );
  });

  it("handles zero and negative values", () => {
    expect(percentileRank(0, [-10, 0, 10])).toBe(50);
    expect(percentileRank(-10, [-10, 0, 10])).toBeCloseTo(16.667, 3);
  });

  it("rejects an empty population", () => {
    expect(() => percentileRank(1, [])).toThrow(/empty population/);
  });

  it("rejects non-finite input", () => {
    expect(() => percentileRank(Number.NaN, [1, 2])).toThrow();
    expect(() => percentileRank(1, [1, Number.POSITIVE_INFINITY])).toThrow();
  });
});

describe("percentileScore direction handling", () => {
  const rents = [900, 1500, 1800, 2400];

  it("scores higher-is-better metrics in rank order", () => {
    expect(percentileScore(2400, rents, "higher_is_better")).toBe(87.5);
    expect(percentileScore(900, rents, "higher_is_better")).toBe(12.5);
  });

  it("inverts lower-is-better metrics so cheap scores well", () => {
    expect(percentileScore(900, rents, "lower_is_better")).toBe(87.5);
    expect(percentileScore(2400, rents, "lower_is_better")).toBe(12.5);
  });

  it("keeps the two directions symmetric", () => {
    for (const rent of rents) {
      const up = percentileScore(rent, rents, "higher_is_better");
      const down = percentileScore(rent, rents, "lower_is_better");
      expect(up + down).toBeCloseTo(100, 10);
    }
  });
});

describe("winsorizedMinMaxScore", () => {
  it("scales linearly between the trimmed bounds", () => {
    const population = [0, 25, 50, 75, 100];

    expect(
      winsorizedMinMaxScore(50, population, "higher_is_better"),
    ).toBeCloseTo(50, 5);
  });

  it("clamps values beyond the winsorised bounds instead of exceeding the scale", () => {
    const population = [10, 20, 30, 40, 1_000_000];

    const score = winsorizedMinMaxScore(
      1_000_000,
      population,
      "higher_is_better",
    );

    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("returns 50 when the population has no spread", () => {
    expect(winsorizedMinMaxScore(5, [5, 5, 5], "higher_is_better")).toBe(50);
  });

  it("inverts for lower-is-better", () => {
    const population = [0, 50, 100];

    const high = winsorizedMinMaxScore(100, population, "lower_is_better");
    const low = winsorizedMinMaxScore(0, population, "lower_is_better");

    expect(low).toBeGreaterThan(high);
  });

  it("rejects an empty population", () => {
    expect(() => winsorizedMinMaxScore(1, [], "higher_is_better")).toThrow();
  });
});

describe("targetDistanceScore", () => {
  it("awards a perfect score exactly on target", () => {
    expect(targetDistanceScore(57, 57, 20)).toBe(100);
  });

  it("falls off linearly with distance", () => {
    expect(targetDistanceScore(67, 57, 20)).toBe(50);
    expect(targetDistanceScore(47, 57, 20)).toBe(50);
  });

  it("treats distance symmetrically above and below the target", () => {
    expect(targetDistanceScore(45, 57, 20)).toBe(
      targetDistanceScore(69, 57, 20),
    );
  });

  it("floors at zero rather than going negative", () => {
    expect(targetDistanceScore(200, 57, 20)).toBe(0);
    expect(targetDistanceScore(-200, 57, 20)).toBe(0);
  });

  it("rejects a non-positive tolerance instead of dividing by zero", () => {
    expect(() => targetDistanceScore(57, 57, 0)).toThrow(/Tolerance/);
    expect(() => targetDistanceScore(57, 57, -5)).toThrow(/Tolerance/);
  });

  it("rejects non-finite input", () => {
    expect(() => targetDistanceScore(Number.NaN, 57, 20)).toThrow();
  });
});

describe("clampScore", () => {
  it("bounds values to the 0-100 scale", () => {
    expect(clampScore(-10)).toBe(0);
    expect(clampScore(150)).toBe(100);
    expect(clampScore(42)).toBe(42);
  });

  it("rejects non-finite values rather than silently clamping them", () => {
    expect(() => clampScore(Number.NaN)).toThrow();
    expect(() => clampScore(Number.POSITIVE_INFINITY)).toThrow();
  });
});
