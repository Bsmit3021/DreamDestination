import { describe, expect, it } from "vitest";

import { DIMENSIONS, UNSCORED_DIMENSIONS } from "@/lib/matching/dimensions";
import { buildReasons, buildTradeoffs } from "@/lib/matching/explanations";
import { generateMatches } from "@/lib/matching/ranking";
import { scoreCities } from "@/lib/matching/scoring";
import { normalizeWeights } from "@/lib/matching/weights";

import {
  GOLDEN_CITIES,
  personalizationFor,
  testProfile,
  weightsWith,
} from "./fixtures";

const BALANCED = weightsWith({ housing: 1, career: 1, climate: 1 });

/** A confirmed occupation the golden fixture publishes no OEWS data for. */
const NURSE = { socCode: "29-1141", title: "Registered Nurses" };

function scoreFor(
  slug: string,
  weights = BALANCED,
  occupation: { socCode: string; title: string } | null = null,
) {
  const scored = scoreCities(
    GOLDEN_CITIES,
    normalizeWeights(weights),
    personalizationFor(testProfile(), occupation),
  );
  return scored.find((s) => s.city.slug === slug)!;
}

describe("buildReasons", () => {
  it("leads with the dimension that contributed most", () => {
    // Housing-first user, Alpha: housing contributes ~72.9 of ~77.3.
    const reasons = buildReasons(
      scoreFor(
        "alpha",
        weightsWith({ housing: 1.0, career: 0.1, climate: 0.1 }),
      ),
    );

    expect(reasons[0]?.dimension).toBe("housing");
  });

  it("quotes the actual measurement, not just a score", () => {
    const reasons = buildReasons(scoreFor("alpha"));
    const housing = reasons.find((r) => r.dimension === "housing");

    expect(housing?.detail).toContain("$900/mo");
    expect(housing?.detail).toContain("Median gross rent");
  });

  it("flags the user's highest-weighted dimension", () => {
    // Gamma is inside the requested mild band, so climate scores 100 and
    // clears the strength threshold on its own merits.
    const reasons = buildReasons(
      scoreFor("gamma", weightsWith({ climate: 1.0, housing: 0.05 })),
    );

    expect(reasons[0]?.dimension).toBe("climate");
    expect(reasons[0]?.detail).toContain("highest-weighted priority");
  });

  it("stops offering a discounted fallback career score as a strength", () => {
    // Beta has the best unemployment rate in the fixture (87.5 percentile) but
    // no OEWS data for the nurse's occupation, so the effective score is
    // 56.875 — below the strength threshold. A generic labour-market number
    // must not be sold as evidence that this is a good city for nursing.
    const reasons = buildReasons(
      scoreFor("beta", weightsWith({ career: 1.0, housing: 0.05 }), NURSE),
    );

    expect(reasons.map((r) => r.dimension)).not.toContain("career");
  });

  it("still offers the same score as a strength when no occupation was asked about", () => {
    // Identical city, identical unemployment rate, no occupation named: the
    // metro-wide labour market is what this user asked for, so 87.5 stands.
    const reasons = buildReasons(
      scoreFor("beta", weightsWith({ career: 1.0, housing: 0.05 })),
    );

    expect(reasons.map((r) => r.dimension)).toContain("career");
  });

  it("says plainly that an occupation fallback is not about the occupation", () => {
    const tradeoffs = buildTradeoffs(
      scoreFor("alpha", weightsWith({ career: 1.0 }), NURSE),
    );
    const detail = tradeoffs[0]?.detail ?? "";

    expect(detail).toContain("metro-wide, not Registered Nurses");
    expect(detail).toContain("scaled back for the weaker evidence");
  });

  it("does not claim missing evidence when no occupation was selected", () => {
    const tradeoffs = buildTradeoffs(
      scoreFor("alpha", weightsWith({ career: 1.0 })),
    );
    const detail = tradeoffs[0]?.detail ?? "";

    expect(detail).toContain("no occupation selected");
    expect(detail).toContain("rather than a specific occupation");
    // Nothing was substituted, so nothing may be described as held back.
    expect(detail).not.toContain("scaled back");
    expect(detail).not.toContain("weaker evidence");
    expect(detail).not.toContain("publishes too little");
  });

  it("omits dimensions that scored poorly", () => {
    // Alpha's career score is 12.5 — never a selling point.
    const reasons = buildReasons(scoreFor("alpha"));

    expect(reasons.map((r) => r.dimension)).not.toContain("career");
  });

  it("never mentions a dimension the city has no data for", () => {
    const reasons = buildReasons(scoreFor("gamma"));

    for (const reason of reasons) {
      expect(UNSCORED_DIMENSIONS).not.toContain(reason.dimension);
      expect(GOLDEN_CITIES[2]!.observations[reason.dimension]).toBeDefined();
    }
  });

  it("returns nothing when a user weights only unmeasurable dimensions", () => {
    const scored = scoreCities(
      GOLDEN_CITIES,
      normalizeWeights(weightsWith({ safety: 1 })),
    );

    expect(buildReasons(scored[0]!)).toEqual([]);
  });
});

describe("buildTradeoffs", () => {
  it("surfaces a weak dimension the user actually cares about", () => {
    // Career-first user looking at Alpha, whose career score is 12.5.
    const tradeoffs = buildTradeoffs(
      scoreFor("alpha", weightsWith({ career: 1.0, housing: 0.1 })),
    );

    expect(tradeoffs[0]?.dimension).toBe("career");
  });

  it("ignores weak dimensions the user does not weight", () => {
    // Alpha's climate score is 40 (a tradeoff candidate) but carries no weight.
    const tradeoffs = buildTradeoffs(
      scoreFor("alpha", weightsWith({ housing: 1 })),
    );

    expect(tradeoffs.map((t) => t.dimension)).not.toContain("climate");
  });

  it("orders tradeoffs by the score they actually cost", () => {
    const tradeoffs = buildTradeoffs(
      scoreFor("alpha", weightsWith({ career: 1.0, climate: 0.2 })),
    );

    // career: 1.0 weight × 87.5 shortfall beats climate: 0.2 × 60.
    expect(tradeoffs[0]?.dimension).toBe("career");
  });

  it("quotes the measurement behind the tradeoff", () => {
    const tradeoffs = buildTradeoffs(
      scoreFor("alpha", weightsWith({ career: 1.0 })),
    );

    expect(tradeoffs[0]?.detail).toContain("7.0%");
    expect(tradeoffs[0]?.detail).toContain("Unemployment rate");
  });

  it("produces no tradeoffs for a city that is strong everywhere the user cares", () => {
    // Gamma scores 100 on climate for a climate-only user.
    const tradeoffs = buildTradeoffs(
      scoreFor("gamma", weightsWith({ climate: 1 })),
    );

    expect(tradeoffs).toEqual([]);
  });
});

describe("explanations never invent city qualities", () => {
  it("only names dimensions defined in the registry", () => {
    const { recommendations } = generateMatches(
      GOLDEN_CITIES,
      testProfile(),
      BALANCED,
      { limit: 4 },
    );

    const knownLabels = new Set(
      Object.values(DIMENSIONS).map((definition) => definition.label),
    );

    for (const recommendation of recommendations) {
      for (const line of [
        ...recommendation.reasons,
        ...recommendation.tradeoffs,
      ]) {
        expect(knownLabels.has(line.label)).toBe(true);
        // Every claim must trace back to a measurement this city actually has.
        expect(recommendation.city.observations[line.dimension]).toBeDefined();
      }
    }
  });

  it("keeps every stated raw value equal to the stored observation", () => {
    const { recommendations } = generateMatches(
      GOLDEN_CITIES,
      testProfile(),
      BALANCED,
      { limit: 4 },
    );

    for (const recommendation of recommendations) {
      for (const line of recommendation.reasons) {
        const observed =
          recommendation.city.observations[line.dimension]!.rawValue;
        const dimension = recommendation.dimensions[line.dimension];
        expect(dimension.rawValue).toBe(observed);
      }
    }
  });
});
