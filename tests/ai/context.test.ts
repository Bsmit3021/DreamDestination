import { describe, expect, it } from "vitest";

import {
  buildAdvisorContext,
  buildHypotheticalBudget,
  summarizePriorities,
} from "@/lib/ai/context";

import { DESTINATIONS, MADISON, OMAHA, testWeights } from "./fixtures";

const OCCUPATION = { socCode: "15-1252", title: "Software Developers" };

function context(budget: number | null = 3_600) {
  return buildAdvisorContext(
    DESTINATIONS,
    testWeights(),
    budget,
    OCCUPATION,
    "v1",
  );
}

describe("summarizePriorities", () => {
  it("converts weights to percentages summing to about 100", () => {
    const priorities = summarizePriorities(testWeights());
    const total = priorities.reduce((sum, p) => sum + p.weightPercent, 0);

    expect(total).toBeGreaterThanOrEqual(98);
    expect(total).toBeLessThanOrEqual(102);
  });

  it("orders strongest priority first", () => {
    const priorities = summarizePriorities(testWeights());
    expect(priorities[0]?.label).toBe("Career opportunity");
  });

  it("treats all-zero weights as equal importance, never dividing by zero", () => {
    const zero = summarizePriorities(
      Object.fromEntries(
        Object.keys(testWeights()).map((k) => [k, 0]),
      ) as ReturnType<typeof testWeights>,
    );

    expect(zero).toHaveLength(10);
    for (const entry of zero) {
      expect(Number.isFinite(entry.weightPercent)).toBe(true);
      expect(entry.weightPercent).toBe(10);
    }
  });
});

describe("buildAdvisorContext — what the model receives", () => {
  it("includes the top destinations in rank order", () => {
    const built = context();
    expect(built.destinations.map((d) => d.rank)).toEqual([1, 2, 3, 4]);
    expect(built.destinations[0]?.name).toBe("Madison, WI");
  });

  it("includes Fit Score, coverage, strengths and tradeoffs", () => {
    const madison = context().destinations[0]!;

    expect(madison.fitScore).toBe(81);
    expect(madison.dataCoverage).toBe(76);
    expect(madison.strengths.length).toBeGreaterThan(0);
    expect(madison.tradeoffs.length).toBeGreaterThan(0);
  });

  it("includes career values with their availability", () => {
    const madison = context().destinations[0]!;

    expect(madison.career?.medianAnnualWage).toBe(104_900);
    expect(madison.career?.locationQuotient).toBe(1.03);
    expect(madison.career?.wageAvailability).toBe("published");
  });

  it("preserves suppressed wages as null, never zero", () => {
    const desMoines = context().destinations.find((d) =>
      d.name.startsWith("Des Moines"),
    )!;

    expect(desMoines.career?.wageAvailability).toBe("not_released");
    expect(desMoines.career?.medianAnnualWage).toBeNull();
  });

  it("carries the top code separately from a median", () => {
    const sanJose = context().destinations.find((d) =>
      d.name.startsWith("San Jose"),
    )!;

    expect(sanJose.career?.wageAvailability).toBe("top_coded");
    expect(sanJose.career?.medianAnnualWage).toBeNull();
    expect(sanJose.career?.topCodeAnnual).toBe(239_200);
  });

  it("includes housing benchmarks and the budget comparison", () => {
    const madison = context().destinations[0]!;

    expect(madison.housing?.medianGrossRent).toBe(1_310);
    expect(madison.housing?.twoBedroomRent).toBe(1_390);
    expect(madison.housing?.budgetDifference).toBe(2_290);
  });

  it("includes the algorithm version so Fit can be attributed", () => {
    expect(context().algorithmVersion).toBe("v1");
  });

  it("treats a zero budget as unspecified", () => {
    expect(context(0).user.monthlyHousingBudget).toBeNull();
  });
});

describe("buildAdvisorContext — privacy allowlist", () => {
  it("contains no email, uuid, token or key anywhere in the payload", () => {
    const serialized = JSON.stringify(context());

    expect(serialized).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i); // email
    expect(serialized).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i); // uuid
    expect(serialized.toLowerCase()).not.toContain("token");
    expect(serialized.toLowerCase()).not.toContain("apikey");
    expect(serialized.toLowerCase()).not.toContain("password");
  });

  it("identifies cities by slug, not database id", () => {
    const built = context();

    for (const destination of built.destinations) {
      expect(destination).not.toHaveProperty("cityId");
      expect(destination.slug).toMatch(/^[a-z0-9-]+$/);
    }
    // The fixture's real uuid-ish id must not have leaked through.
    expect(JSON.stringify(built)).not.toContain(MADISON.city.id);
  });

  it("carries only the destinations supplied — no wider dataset", () => {
    const built = context();
    expect(built.destinations).toHaveLength(4);
  });
});

describe("buildHypotheticalBudget", () => {
  it("recomputes differences deterministically without touching saved data", () => {
    const built = context();
    const rows = buildHypotheticalBudget(built, 2_000);

    const madison = rows.find((row) => row.name === "Madison, WI")!;
    // 2000 − 1310 = 690
    expect(madison.difference).toBe(690);
    expect(madison.benchmarkRent).toBe(1_310);

    // The real saved comparison is untouched.
    expect(built.destinations[0]?.housing?.budgetDifference).toBe(2_290);
    expect(MADISON.housing?.budgetComparison?.monthlyBudget).toBe(3_600);
  });

  it("goes negative when the hypothetical budget falls short", () => {
    const rows = buildHypotheticalBudget(context(), 1_000);
    const sanJose = rows.find((row) => row.name === "San Jose, CA")!;

    // 1000 − 2794 = −1794
    expect(sanJose.difference).toBe(-1_794);
  });

  it("skips destinations without a rent benchmark rather than guessing", () => {
    const noRent = {
      ...OMAHA,
      housing: { ...OMAHA.housing!, medianGrossRent: null },
    };
    const built = buildAdvisorContext(
      [noRent],
      testWeights(),
      2_000,
      OCCUPATION,
      "v1",
    );

    expect(buildHypotheticalBudget(built, 2_000)).toHaveLength(0);
  });
});
