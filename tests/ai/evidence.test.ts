import { describe, expect, it } from "vitest";

import {
  buildEvidenceRegistry,
  evidenceId,
  resolveSources,
  validateCitations,
} from "@/lib/ai/evidence";

import { DES_MOINES, DESTINATIONS, MADISON, SAN_JOSE } from "./fixtures";

const USER_FACTS = {
  housingBudget: 3_600,
  confirmedOccupation: { socCode: "15-1252", title: "Software Developers" },
  topPriorities: [{ label: "Career opportunity", weightPercent: 32 }],
};

function registry() {
  return buildEvidenceRegistry(DESTINATIONS, USER_FACTS, "v1");
}

describe("evidenceId", () => {
  it("is deterministic", () => {
    expect(evidenceId("fit", ["madison-wi", "score"])).toBe(
      evidenceId("fit", ["madison-wi", "score"]),
    );
  });

  it("normalises separators and case", () => {
    expect(evidenceId("career", ["Madison WI", "15-1252", "Median Wage"])).toBe(
      "career:madison-wi:15-1252:median-wage",
    );
  });

  it("contains no database uuid", () => {
    const built = registry();
    for (const item of built.items) {
      expect(item.id).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    }
  });
});

describe("buildEvidenceRegistry", () => {
  it("produces unique ids", () => {
    const built = registry();
    const ids = built.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("throws rather than emitting a duplicate id", () => {
    // Same city twice would collide; ambiguity must fail loudly.
    expect(() =>
      buildEvidenceRegistry([MADISON, MADISON], USER_FACTS, "v1"),
    ).toThrow(/Duplicate evidence id/);
  });

  it("attributes Fit facts to the matching algorithm, not a dataset", () => {
    const built = registry();
    const score = built.byId.get("fit:madison-wi:score");

    expect(score?.value).toBe(81);
    expect(score?.source).toEqual({
      organization: "DreamDestination",
      dataset: "Matching Algorithm",
      period: "v1",
    });
  });

  it("represents a suppressed wage as null with an explanatory note", () => {
    const built = registry();
    const wage = built.byId.get(
      "career:des-moines-ia:15-1252:median-annual-wage",
    );

    expect(wage).toBeDefined();
    // The whole point: absent, not zero.
    expect(wage?.value).toBeNull();
    expect(wage?.value).not.toBe(0);
    expect(wage?.note).toMatch(/suppressed|not published/i);
    expect(wage?.note).toMatch(/not mean the wage is zero/i);
  });

  it("represents a top-coded wage as a bound, not a point estimate", () => {
    const built = registry();
    const wage = built.byId.get(
      "career:san-jose-ca:15-1252:median-annual-wage",
    );

    expect(wage?.value).toBe(239_200);
    expect(wage?.unit).toMatch(/lower bound/i);
    expect(wage?.note).toMatch(/at or above/i);
  });

  it("labels employment so it cannot be read as job openings", () => {
    const built = registry();
    const employment = built.byId.get("career:madison-wi:15-1252:employment");

    expect(employment?.value).toBe(4_120);
    expect(employment?.note).toMatch(/NOT a count of current job openings/i);
  });

  it("labels location quotient so it cannot be read as hiring probability", () => {
    const built = registry();
    const lq = built.byId.get("career:madison-wi:15-1252:location-quotient");

    expect(lq?.value).toBe(1.03);
    expect(lq?.note).toMatch(/NOT a probability/i);
  });

  it("labels rent as a benchmark rather than availability", () => {
    const built = registry();
    const rent = built.byId.get("housing:madison-wi:median-gross-rent");

    expect(rent?.value).toBe(1_310);
    expect(rent?.note).toMatch(/not a listing/i);
  });

  it("carries the real budget difference", () => {
    const built = registry();
    expect(built.byId.get("housing:madison-wi:budget-difference")?.value).toBe(
      2_290,
    );
  });

  it("omits the budget item when no budget is stated", () => {
    const built = buildEvidenceRegistry(
      DESTINATIONS,
      { ...USER_FACTS, housingBudget: null },
      "v1",
    );
    expect(built.byId.has("preference:user:housing-budget")).toBe(false);
  });

  it("emits no career evidence when the destination has none", () => {
    const noCareer = { ...MADISON, career: null };
    const built = buildEvidenceRegistry([noCareer], USER_FACTS, "v1");

    expect(
      built.items.filter((item) => item.category === "career"),
    ).toHaveLength(0);
  });
});

describe("validateCitations", () => {
  it("accepts ids present in the registry", () => {
    const built = registry();
    const result = validateCitations(
      ["fit:madison-wi:score", "housing:omaha-ne:median-gross-rent"],
      built,
    );

    expect(result.valid).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
  });

  it("rejects a fabricated id", () => {
    const built = registry();
    const result = validateCitations(["evidence:fake:secret"], built);

    expect(result.valid).toEqual([]);
    expect(result.rejected).toEqual(["evidence:fake:secret"]);
  });

  it("rejects a city that was never supplied", () => {
    // Seattle is not in the user's set; a citation for it must not resolve.
    const built = registry();
    const result = validateCitations(
      ["housing:seattle-wa:median-gross-rent"],
      built,
    );

    expect(result.valid).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it("does not treat an id as a database selector", () => {
    const built = registry();
    const result = validateCitations(
      ["fit:madison-wi:score'; drop table profiles; --"],
      built,
    );

    expect(result.valid).toEqual([]);
  });

  it("deduplicates repeated citations", () => {
    const built = registry();
    const result = validateCitations(
      ["fit:madison-wi:score", "fit:madison-wi:score"],
      built,
    );

    expect(result.valid).toHaveLength(1);
  });
});

describe("resolveSources", () => {
  it("resolves labels from our own stored provenance", () => {
    const built = registry();
    const sources = resolveSources(
      [
        "career:madison-wi:15-1252:median-annual-wage",
        "housing:madison-wi:median-gross-rent",
        "fit:madison-wi:score",
      ],
      built,
    );

    expect(sources).toEqual([
      {
        organization: "DreamDestination",
        dataset: "Matching Algorithm",
        period: "v1",
      },
      {
        organization: "U.S. Bureau of Labor Statistics",
        dataset: "Occupational Employment and Wage Statistics (OEWS)",
        period: "May 2025",
      },
      {
        organization: "U.S. Census Bureau",
        dataset: "American Community Survey 5-Year Estimates",
        period: "2019-2023",
      },
    ]);
  });

  it("returns nothing for rejected ids", () => {
    const built = registry();
    expect(resolveSources(["evidence:fake:secret"], built)).toEqual([]);
  });

  it("does not invent a source for the suppressed-wage item's absence", () => {
    const built = registry();
    const sources = resolveSources(
      ["career:des-moines-ia:15-1252:median-annual-wage"],
      built,
    );
    // Still BLS-attributed: BLS is who declined to publish it.
    expect(sources[0]?.organization).toBe("U.S. Bureau of Labor Statistics");
    expect(DES_MOINES.career?.wages.availability).toBe("not_released");
    expect(SAN_JOSE.career?.wages.availability).toBe("top_coded");
  });
});
