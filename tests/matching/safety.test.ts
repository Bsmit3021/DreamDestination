import { describe, expect, it } from "vitest";

import {
  SAFETY_COMPONENT_WEIGHTS,
  scoreSafetyFit,
} from "@/lib/matching/safety";

import { cityWith, withMetroData } from "./fixtures";

/**
 * Safety Fit.
 *
 * The behaviour that matters: lower published crime must rank better, violent
 * crime must carry the weight it claims to, and an unpublished rate must never
 * become a zero — which would rank a metro the FBI said nothing about as the
 * safest in the country.
 */

const A = "00000000-0000-4000-8000-0000000000f1";
const B = "00000000-0000-4000-8000-0000000000f2";
const C = "00000000-0000-4000-8000-0000000000f3";
const D = "00000000-0000-4000-8000-0000000000f4";

/** Metros carrying FBI rates, built from violent/property pairs. */
function safetySet(
  rows: {
    id: string;
    violent?: number | null;
    property?: number | null;
    estimated?: boolean;
    noRow?: boolean;
  }[],
) {
  return rows.map((row) =>
    withMetroData(cityWith(row.id, { housing: 1_200 }), {
      safety: row.noRow
        ? null
        : {
            violentCrimeRate: row.violent ?? null,
            propertyCrimeRate: row.property ?? null,
            isEstimated: row.estimated ?? false,
          },
    }),
  );
}

describe("crime rates rank lower-is-better", () => {
  it("scores the metro with less violent crime higher", () => {
    const scores = scoreSafetyFit(
      safetySet([
        { id: A, violent: 150, property: 1_500 },
        { id: B, violent: 600, property: 1_500 },
      ]),
    );

    expect(scores.get(A)!.score).toBeGreaterThan(scores.get(B)!.score);
  });

  it("scores the metro with less property crime higher", () => {
    const scores = scoreSafetyFit(
      safetySet([
        { id: A, violent: 300, property: 900 },
        { id: B, violent: 300, property: 3_200 },
      ]),
    );

    expect(scores.get(A)!.score).toBeGreaterThan(scores.get(B)!.score);
  });

  it("keeps the published rates on the detail rather than only a score", () => {
    const detail = scoreSafetyFit(
      safetySet([
        { id: A, violent: 337.7, property: 1_301.6 },
        { id: B, violent: 500, property: 2_000 },
      ]),
    ).get(A)!.detail;

    expect(detail.violentCrimeRate).toBe(337.7);
    expect(detail.propertyCrimeRate).toBe(1_301.6);
    expect(detail.dataYear).toBe(2025);
  });
});

describe("internal component weighting", () => {
  it("declares 70/30 in favour of violent crime", () => {
    expect(SAFETY_COMPONENT_WEIGHTS.violentCrime).toBe(0.7);
    expect(SAFETY_COMPONENT_WEIGHTS.propertyCrime).toBe(0.3);
    expect(
      SAFETY_COMPONENT_WEIGHTS.violentCrime +
        SAFETY_COMPONENT_WEIGHTS.propertyCrime,
    ).toBe(1);
  });

  it("gives violent crime 70% of the weight when both rates exist", () => {
    const detail = scoreSafetyFit(
      safetySet([
        { id: A, violent: 150, property: 900 },
        { id: B, violent: 600, property: 3_200 },
      ]),
    ).get(A)!.detail;

    const violent = detail.components.find((c) => c.key === "violentCrime")!;
    const property = detail.components.find((c) => c.key === "propertyCrime")!;

    expect(violent.weight).toBeCloseTo(0.7, 10);
    expect(property.weight).toBeCloseTo(0.3, 10);
  });

  it("lets violent crime outweigh property crime in the total", () => {
    // A wins violent and loses property; B is the mirror image. The 70/30
    // split must put A ahead.
    const scores = scoreSafetyFit(
      safetySet([
        { id: A, violent: 100, property: 3_000 },
        { id: B, violent: 700, property: 800 },
      ]),
    );

    expect(scores.get(A)!.score).toBeGreaterThan(scores.get(B)!.score);
  });

  it("weights sum to 1 whatever survives", () => {
    for (const [, result] of scoreSafetyFit(
      safetySet([
        { id: A, violent: 150, property: 900 },
        { id: B, violent: 600 },
        { id: C, property: 3_200 },
      ]),
    )) {
      if (!result) continue;
      const total = result.detail.components.reduce(
        (sum, component) => sum + component.weight,
        0,
      );
      expect(total).toBeCloseTo(1, 10);
    }
  });
});

describe("missing crime data is absence, never zero", () => {
  it("does not treat a missing violent rate as zero crime", () => {
    // C publishes no violent rate. If null became 0 it would be the safest
    // metro in the set on the component carrying 70% of the weight.
    const scores = scoreSafetyFit(
      safetySet([
        { id: A, violent: 150, property: 1_000 },
        { id: B, violent: 600, property: 2_000 },
        { id: C, property: 1_000 },
      ]),
    );

    expect(scores.get(C)!.detail.violentCrimeRate).toBeNull();
    expect(
      scores.get(C)!.detail.components.some((c) => c.key === "violentCrime"),
    ).toBe(false);
    expect(scores.get(C)!.score).toBeLessThan(scores.get(A)!.score);
  });

  it("does not treat a missing property rate as zero crime", () => {
    const scores = scoreSafetyFit(
      safetySet([
        { id: A, violent: 150, property: 1_000 },
        { id: B, violent: 150 },
      ]),
    );

    expect(scores.get(B)!.detail.propertyCrimeRate).toBeNull();
    expect(
      scores.get(B)!.detail.components.some((c) => c.key === "propertyCrime"),
    ).toBe(false);
  });

  it("keeps an unpublished rate out of the other metros' population", () => {
    // Adding a metro with no violent rate must not move anyone's percentile.
    const withoutIt = scoreSafetyFit(
      safetySet([
        { id: A, violent: 150, property: 1_000 },
        { id: B, violent: 600, property: 2_000 },
      ]),
    );
    const withIt = scoreSafetyFit(
      safetySet([
        { id: A, violent: 150, property: 1_000 },
        { id: B, violent: 600, property: 2_000 },
        { id: C, violent: null, property: null, noRow: true },
      ]),
    );

    const violentOf = (scores: ReturnType<typeof scoreSafetyFit>, id: string) =>
      scores.get(id)!.detail.components.find((c) => c.key === "violentCrime")!
        .score;

    expect(violentOf(withIt, A)).toBe(violentOf(withoutIt, A));
    expect(violentOf(withIt, B)).toBe(violentOf(withoutIt, B));
  });

  it("redistributes the weight when one component is missing", () => {
    const detail = scoreSafetyFit(
      safetySet([
        { id: A, violent: 150 },
        { id: B, violent: 600, property: 2_000 },
      ]),
    ).get(A)!.detail;

    expect(detail.components).toHaveLength(1);
    expect(detail.components[0]!.key).toBe("violentCrime");
    // The surviving component carries all of the dimension.
    expect(detail.components[0]!.weight).toBe(1);
    // Coverage still records that only 70% of the intended weight had data.
    expect(detail.coverage).toBeCloseTo(0.7, 10);
  });

  it("returns null when both components are missing", () => {
    const scores = scoreSafetyFit(
      safetySet([{ id: A, violent: 150, property: 1_000 }, { id: B }]),
    );

    expect(scores.get(B)).toBeNull();
  });

  it("returns null when the metro has no FBI row at all", () => {
    const scores = scoreSafetyFit(
      safetySet([
        { id: A, violent: 150, property: 1_000 },
        { id: B, noRow: true },
      ]),
    );

    expect(scores.get(B)).toBeNull();
  });
});

describe("range and determinism", () => {
  it("keeps every score within 0-100", () => {
    const scores = scoreSafetyFit(
      safetySet([
        { id: A, violent: 12, property: 200 },
        { id: B, violent: 1_800, property: 6_000 },
        { id: C, violent: 300, property: 1_500 },
        { id: D, violent: 0, property: 0 },
      ]),
    );

    for (const [, result] of scores) {
      if (!result) continue;
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(Number.isFinite(result.score)).toBe(true);
    }
  });

  it("gives identical rates identical scores", () => {
    const scores = scoreSafetyFit(
      safetySet([
        { id: A, violent: 400, property: 1_800 },
        { id: B, violent: 400, property: 1_800 },
        { id: C, violent: 100, property: 900 },
      ]),
    );

    expect(scores.get(A)!.score).toBe(scores.get(B)!.score);
  });

  it("produces identical output on repeated runs", () => {
    const cities = safetySet([
      { id: A, violent: 150, property: 1_000 },
      { id: B, violent: 600, property: 2_000 },
    ]);

    expect(JSON.stringify([...scoreSafetyFit(cities)])).toBe(
      JSON.stringify([...scoreSafetyFit(cities)]),
    );
  });

  it("does not depend on the order candidates are supplied in", () => {
    const cities = safetySet([
      { id: A, violent: 150, property: 1_000 },
      { id: B, violent: 600, property: 2_000 },
      { id: C, violent: 300, property: 1_500 },
    ]);

    const forwards = scoreSafetyFit(cities);
    const backwards = scoreSafetyFit([...cities].reverse());

    for (const id of [A, B, C]) {
      expect(backwards.get(id)!.score).toBe(forwards.get(id)!.score);
    }
  });
});

describe("source distinctions are carried, not flattened", () => {
  it("preserves the FBI's own reported/estimated flag", () => {
    const scores = scoreSafetyFit(
      safetySet([
        { id: A, violent: 150, property: 1_000, estimated: true },
        { id: B, violent: 600, property: 2_000, estimated: false },
      ]),
    );

    expect(scores.get(A)!.detail.isEstimated).toBe(true);
    expect(scores.get(B)!.detail.isEstimated).toBe(false);
  });

  it("keeps the FBI's own metro name so a mapping can be audited", () => {
    const detail = scoreSafetyFit(
      safetySet([
        { id: A, violent: 150, property: 1_000 },
        { id: B, violent: 600, property: 2_000 },
      ]),
    ).get(A)!.detail;

    expect(detail.fbiMetroName).toContain("M. S. A.");
  });
});
