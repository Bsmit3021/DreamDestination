import { describe, expect, it } from "vitest";

import {
  CLIMATE_BANDS,
  climateAffectsScoring,
  climateBandScore,
  scoreClimate,
} from "@/lib/matching/climate";
import {
  budgetAlignmentFactor,
  resolveHousingBenchmark,
  scoreHousing,
} from "@/lib/matching/housing";
import { buildReasons } from "@/lib/matching/explanations";
import { applyHardFilters } from "@/lib/matching/filters";
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

const A = "00000000-0000-4000-8000-0000000000d1";
const B = "00000000-0000-4000-8000-0000000000e1";

/** A metro with a full set of bedroom rents plus an overall median. */
function metro(
  id: string,
  overall: number,
  bedrooms?: Record<string, number | null>,
) {
  return withMetroData(cityWith(id, { housing: overall }), {
    bedroomRents: bedrooms ?? {
      studio: 900,
      one: 1_100,
      two: 1_400,
      three: 1_750,
      four: 2_050,
    },
  });
}

describe("bedroom-aware housing benchmark", () => {
  it("uses the bedroom-specific rent the user asked for", () => {
    const city = metro(A, 1_300);

    expect(resolveHousingBenchmark(city, "one")!.rent).toBe(1_100);
    expect(resolveHousingBenchmark(city, "three")!.rent).toBe(1_750);
  });

  it("maps four_plus to the ACS 4-bedroom field, the highest ACS publishes", () => {
    const benchmark = resolveHousingBenchmark(metro(A, 1_300), "four_plus")!;

    expect(benchmark.rent).toBe(2_050);
    expect(benchmark.basis).toBe("bedroom_specific");
  });

  it("gives a 1BR and a 3BR user different benchmarks and different scores", () => {
    const cities = [
      metro(A, 1_300),
      metro(B, 1_500, {
        studio: 1_200,
        one: 1_450,
        two: 1_600,
        three: 1_700,
        four: 1_900,
      }),
    ];

    const oneBed = cities.map((c) => resolveHousingBenchmark(c, "one")!.rent);
    const threeBed = cities.map(
      (c) => resolveHousingBenchmark(c, "three")!.rent,
    );

    expect(oneBed).toEqual([1_100, 1_450]);
    expect(threeBed).toEqual([1_750, 1_700]);
    // The cheaper metro for a 1BR renter is the pricier one for a 3BR renter.
    expect(oneBed[0]! < oneBed[1]!).toBe(true);
    expect(threeBed[0]! > threeBed[1]!).toBe(true);
  });

  it("falls back to overall median rent when the bedroom figure is absent", () => {
    const city = metro(A, 1_300, {
      studio: null,
      one: null,
      two: null,
      three: null,
      four: null,
    });
    const benchmark = resolveHousingBenchmark(city, "three")!;

    expect(benchmark.rent).toBe(1_300);
    expect(benchmark.basis).toBe("overall_median");
  });

  it("supports a legacy profile that never stated a bedroom preference", () => {
    const benchmark = resolveHousingBenchmark(metro(A, 1_300), null)!;

    expect(benchmark.rent).toBe(1_300);
    expect(benchmark.basis).toBe("overall_median");
  });

  it("returns null only when there is no rent evidence at all", () => {
    const bare = withMetroData(cityWith(A, { career: 4 }), {
      bedroomRents: null,
    });
    expect(resolveHousingBenchmark(bare, "two")).toBeNull();
  });
});

describe("budget alignment is continuous and safe", () => {
  it("rewards a benchmark at or below budget with the full factor", () => {
    expect(budgetAlignmentFactor(1_000, 2_000)).toBe(1);
    expect(budgetAlignmentFactor(2_000, 2_000)).toBe(1);
  });

  it("degrades smoothly rather than in a cliff as rent exceeds budget", () => {
    const slight = budgetAlignmentFactor(2_200, 2_000);
    const worse = budgetAlignmentFactor(2_800, 2_000);

    expect(slight).toBeLessThan(1);
    expect(worse).toBeLessThan(slight);
    expect(worse).toBeGreaterThanOrEqual(0.5);
  });

  it("treats an unstated or zero budget as no constraint", () => {
    expect(budgetAlignmentFactor(1_500, null)).toBe(1);
    expect(budgetAlignmentFactor(1_500, 0)).toBe(1);
  });

  it("never produces NaN or Infinity", () => {
    for (const [rent, budget] of [
      [0, 1_000],
      [1_000, 0],
      [1_000, null],
      [0, 0],
    ] as [number, number | null][]) {
      const factor = budgetAlignmentFactor(rent, budget);
      expect(Number.isFinite(factor)).toBe(true);
    }
  });

  it("keeps housing scores inside 0-100", () => {
    const benchmark = resolveHousingBenchmark(metro(A, 1_300), "two")!;
    const result = scoreHousing(benchmark, [1_000, 1_400, 2_600], 1_200);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe("budget filter is bedroom-aware", () => {
  it("filters on the selected bedroom rent when it exists", () => {
    // 3BR is 1750; a 1000 budget gives a 1500 ceiling, so this must fail.
    const city = metro(A, 1_300);
    const withThreeBed = applyHardFilters(
      city,
      testProfile({ housingBudget: 1_000, desiredBedrooms: "three" }),
    );
    const withOneBed = applyHardFilters(
      city,
      testProfile({ housingBudget: 1_000, desiredBedrooms: "one" }),
    );

    expect(withThreeBed.passed).toBe(false);
    // 1BR is 1100, under the same 1500 ceiling, so the same metro passes.
    expect(withOneBed.passed).toBe(true);
  });

  it("falls back to overall median when the bedroom rent is missing", () => {
    const city = metro(A, 1_300, {
      studio: null,
      one: null,
      two: null,
      three: null,
      four: null,
    });
    const outcome = applyHardFilters(
      city,
      testProfile({ housingBudget: 1_000, desiredBedrooms: "three" }),
    );

    // 1300 > 1000 x 1.5 = 1500? No — 1300 < 1500, so it passes on the fallback.
    expect(outcome.passed).toBe(true);
  });

  it("does not exclude a metro merely because a bedroom figure is absent", () => {
    const city = metro(A, 900, {
      studio: null,
      one: null,
      two: null,
      three: null,
      four: null,
    });
    expect(
      applyHardFilters(
        city,
        testProfile({ housingBudget: 1_000, desiredBedrooms: "four_plus" }),
      ).passed,
    ).toBe(true);
  });

  it("skips the filter entirely when no budget is stated", () => {
    const city = metro(A, 5_000);
    expect(
      applyHardFilters(
        city,
        testProfile({ housingBudget: 0, desiredBedrooms: "one" }),
      ).passed,
    ).toBe(true);
  });
});

describe("personalised climate", () => {
  it("no longer assumes a universal 57 °F target", () => {
    // Warm and cool must disagree about a hot metro.
    const hot = 78;
    const warm = scoreClimate(hot, "warm")!.score;
    const cool = scoreClimate(hot, "cool")!.score;

    expect(warm).toBeGreaterThan(cool);
  });

  it("ranks metros differently for warm versus cool preferences", () => {
    const temps = [45, 57, 78];
    const warmOrder = [...temps].sort(
      (a, b) => scoreClimate(b, "warm")!.score - scoreClimate(a, "warm")!.score,
    );
    const coolOrder = [...temps].sort(
      (a, b) => scoreClimate(b, "cool")!.score - scoreClimate(a, "cool")!.score,
    );

    expect(warmOrder[0]).toBe(78);
    expect(coolOrder[0]).toBe(45);
    expect(warmOrder).not.toEqual(coolOrder);
  });

  it("treats no_preference as climate not participating", () => {
    expect(climateAffectsScoring("no_preference")).toBe(false);
    expect(scoreClimate(57, "no_preference")).toBeNull();
    // Critically: 57 °F gets no special reward any more.
    expect(scoreClimate(57, "no_preference")).toBe(
      scoreClimate(85, "no_preference"),
    );
  });

  it("treats a legacy null preference exactly like no_preference", () => {
    expect(climateAffectsScoring(null)).toBe(false);
    expect(scoreClimate(57, null)).toBeNull();
  });

  it("scores full marks inside the preferred band and decays outside it", () => {
    const warm = CLIMATE_BANDS.warm;
    expect(climateBandScore(70, warm)).toBe(100);
    expect(climateBandScore(warm.low - 10, warm)).toBeLessThan(100);
    expect(climateBandScore(warm.low - 10, warm)).toBeGreaterThan(0);
  });

  it("floors at zero rather than going negative far from the band", () => {
    expect(climateBandScore(-40, CLIMATE_BANDS.warm)).toBe(0);
    expect(climateBandScore(120, CLIMATE_BANDS.cool)).toBe(0);
  });
});

describe("climate weight redistribution", () => {
  it("removes climate from the score rather than scoring every metro the same", () => {
    const cities = [
      withMetroData(cityWith(A, { climate: 45, housing: 1_200 }), {}),
      withMetroData(cityWith(B, { climate: 78, housing: 1_200 }), {}),
    ];
    const weights = weightsWith({ climate: 1, housing: 1 });

    const noPref = generateMatches(
      cities,
      testProfile({ climatePreference: "no_preference", housingBudget: 0 }),
      weights,
      { limit: 2 },
    );

    // With climate excluded the two metros are otherwise identical, so they tie
    // on score — no fabricated 57 °F winner.
    const [first, second] = noPref.recommendations;
    expect(first!.totalScore).toBeCloseTo(second!.totalScore, 6);
  });

  it("lets a stated preference actually separate the same two metros", () => {
    const cities = [
      withMetroData(cityWith(A, { climate: 45, housing: 1_200 }), {}),
      withMetroData(cityWith(B, { climate: 78, housing: 1_200 }), {}),
    ];
    const weights = weightsWith({ climate: 1, housing: 1 });

    const warm = generateMatches(
      cities,
      testProfile({ climatePreference: "warm", housingBudget: 0 }),
      weights,
      { limit: 2 },
    );

    expect(warm.recommendations[0]!.city.id).toBe(B);
  });
});

describe("four_seasons wording never claims measured seasonality", () => {
  /**
   * Annual mean temperature is one number; seasonality is a spread. The band
   * is a defensible proxy — cold-winter, warm-summer metros do cluster there —
   * but the sentence a user reads must not imply the app looked at seasons.
   */
  function fourSeasonsReason() {
    const profile = testProfile({ climatePreference: "four_seasons" });
    const cities = [
      cityWith(A, { climate: 51, housing: 1_200 }),
      cityWith(B, { climate: 70, housing: 1_400 }),
    ];

    const scored = scoreCities(
      cities,
      normalizeWeights(weightsWith({ climate: 1 })),
      personalizationFor(profile),
    );

    return buildReasons(scored.find((s) => s.city.id === A)!).find(
      (reason) => reason.dimension === "climate",
    );
  }

  it("says what was actually measured", () => {
    expect(fourSeasonsReason()?.detail).toContain("Annual mean temperature");
  });

  it("marks the band as an approximation rather than a measurement", () => {
    const detail = fourSeasonsReason()?.detail ?? "";

    expect(detail).toContain("approximates seasonal variation");
    expect(detail).toContain("annual averages only");
  });

  it("never tells the user four distinct seasons were found", () => {
    const detail = (fourSeasonsReason()?.detail ?? "").toLowerCase();

    expect(detail).not.toContain("four distinct seasons");
    expect(detail).not.toContain("matches the four");
  });

  it("leaves the other preferences phrased as before", () => {
    const profile = testProfile({ climatePreference: "warm" });
    const cities = [
      cityWith(A, { climate: 72, housing: 1_200 }),
      cityWith(B, { climate: 48, housing: 1_400 }),
    ];
    const scored = scoreCities(
      cities,
      normalizeWeights(weightsWith({ climate: 1 })),
      personalizationFor(profile),
    );
    const reason = buildReasons(scored.find((s) => s.city.id === A)!).find(
      (r) => r.dimension === "climate",
    );

    expect(reason?.detail).toContain("matches the warm all year climate");
    expect(reason?.detail).not.toContain("approximates");
  });
});
