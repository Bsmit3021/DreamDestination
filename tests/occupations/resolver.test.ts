import { describe, expect, it } from "vitest";

import {
  normalizeTitle,
  singularize,
  tokenOverlap,
} from "@/lib/occupations/normalize";
import {
  AMBIGUITY_MARGIN,
  AUTO_ACCEPT_CONFIDENCE,
  CONFIRM_CONFIDENCE,
  resolveOccupation,
  type OccupationTitleEntry,
} from "@/lib/occupations/resolver";

/**
 * A small hand-built index. Real O*NET has 55k titles; these few reproduce the
 * shapes that matter: plural official titles, lay alternates, and several
 * occupations sharing a generic word.
 */
function entry(
  socCode: string,
  socTitle: string,
  title: string,
  kind: "primary" | "alternate",
): OccupationTitleEntry {
  return {
    socCode,
    socTitle,
    title,
    normalizedTitle: normalizeTitle(title),
    kind,
  };
}

const INDEX: OccupationTitleEntry[] = [
  entry("29-1141", "Registered Nurses", "Registered Nurses", "primary"),
  entry("29-1141", "Registered Nurses", "Staff Nurse", "alternate"),
  entry("15-1252", "Software Developers", "Software Developers", "primary"),
  entry("15-1252", "Software Developers", "Software Engineer", "alternate"),
  entry("15-1254", "Web Developers", "Web Developers", "primary"),
  entry("47-2111", "Electricians", "Electricians", "primary"),
  entry("17-2051", "Civil Engineers", "Civil Engineers", "primary"),
  entry("17-2141", "Mechanical Engineers", "Mechanical Engineers", "primary"),
  entry(
    "53-3032",
    "Heavy and Tractor-Trailer Truck Drivers",
    "Truck Driver",
    "alternate",
  ),
  entry("53-3033", "Light Truck Drivers", "Truck Driver", "alternate"),
];

describe("singularize", () => {
  it.each([
    ["nurses", "nurse"],
    ["developers", "developer"],
    ["electricians", "electrician"],
    ["technologies", "technology"],
    ["coaches", "coach"],
  ])("reduces %s to %s", (plural, singular) => {
    expect(singularize(plural)).toBe(singular);
  });

  it("leaves double-s words alone", () => {
    // "business" must not become "busines".
    expect(singularize("business")).toBe("business");
    expect(singularize("class")).toBe("class");
  });

  it("leaves short tokens alone", () => {
    expect(singularize("gas")).toBe("gas");
    expect(singularize("is")).toBe("is");
  });
});

describe("normalizeTitle", () => {
  it("folds case, punctuation and spacing", () => {
    expect(normalizeTitle("Sr. Software Engineer, II")).toBe(
      "sr software engineer ii",
    );
  });

  it("treats hyphenated and spaced forms identically", () => {
    expect(normalizeTitle("Front-End Developer")).toBe(
      normalizeTitle("front end developer"),
    );
  });

  it("makes singular user input match plural official titles", () => {
    // The whole reason singularisation exists.
    expect(normalizeTitle("registered nurse")).toBe(
      normalizeTitle("Registered Nurses"),
    );
  });

  it("returns an empty string for input with no word characters", () => {
    expect(normalizeTitle("   ---   ")).toBe("");
  });
});

describe("tokenOverlap", () => {
  it("scores a full overlap as 1", () => {
    expect(tokenOverlap("software developer", "software developers")).toBe(1);
  });

  it("is measured against the query, not the candidate", () => {
    // The candidate having extra words must not penalise the user.
    expect(
      tokenOverlap("truck driver", "heavy and tractor trailer truck drivers"),
    ).toBe(1);
  });

  it("scores a partial overlap proportionally", () => {
    expect(tokenOverlap("frontend developer", "web developer")).toBe(0.5);
  });

  it("returns 0 when nothing overlaps", () => {
    expect(tokenOverlap("electrician", "registered nurse")).toBe(0);
  });

  it("returns 0 for empty input", () => {
    expect(tokenOverlap("", "electrician")).toBe(0);
  });
});

describe("resolveOccupation", () => {
  it("auto-accepts an exact match on an official title", () => {
    const result = resolveOccupation("registered nurse", INDEX);

    expect(result.candidates[0]?.socCode).toBe("29-1141");
    expect(result.candidates[0]?.matchType).toBe("exact");
    expect(result.candidates[0]?.confidence).toBe(1);
    expect(result.action).toBe("auto_accept");
  });

  it("is case- and punctuation-insensitive", () => {
    for (const query of [
      "Registered Nurse",
      "REGISTERED NURSE",
      "registered-nurse",
    ]) {
      expect(resolveOccupation(query, INDEX).candidates[0]?.socCode).toBe(
        "29-1141",
      );
    }
  });

  it("maps a lay alternate title to the right occupation", () => {
    const result = resolveOccupation("software engineer", INDEX);

    // The single most important assertion in this file: a software engineer
    // must not land on a civil or mechanical engineering occupation.
    expect(result.candidates[0]?.socCode).toBe("15-1252");
    expect(result.candidates[0]?.matchType).toBe("alternate_title");

    // Other "engineer" occupations may appear as weak suggestions — they share
    // a word — but must sit far enough behind that they can never be selected.
    const unrelated = result.candidates.filter((c) =>
      ["17-2051", "17-2141"].includes(c.socCode),
    );
    for (const candidate of unrelated) {
      expect(candidate.confidence).toBeLessThan(CONFIRM_CONFIDENCE);
      expect(candidate.confidence).toBeLessThan(
        result.candidates[0]!.confidence,
      );
    }
  });

  it("never returns more than one candidate per occupation", () => {
    const result = resolveOccupation("registered nurse", INDEX);
    const socCodes = result.candidates.map((c) => c.socCode);

    expect(new Set(socCodes).size).toBe(socCodes.length);
  });

  it("asks the user to choose when a generic word matches many occupations", () => {
    const result = resolveOccupation("engineer", INDEX);

    expect(result.ambiguous).toBe(true);
    expect(result.action).not.toBe("auto_accept");
  });

  it("flags two equally-good occupations as ambiguous rather than guessing", () => {
    // "truck driver" is an alternate title for both heavy and light truck SOCs.
    const result = resolveOccupation("truck driver", INDEX);

    expect(result.ambiguous).toBe(true);
    expect(result.action).toBe("confirm");
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it("returns nothing actionable for an unknown occupation", () => {
    const result = resolveOccupation(
      "interdimensional plumber of qo'noS",
      INDEX,
    );

    expect(result.action).toBe("select");
  });

  it("returns no candidates for blank input", () => {
    for (const query of ["", "   ", "!!!"]) {
      const result = resolveOccupation(query, INDEX);
      expect(result.candidates).toEqual([]);
      expect(result.action).toBe("select");
    }
  });

  it("is deterministic and order-independent", () => {
    const forwards = resolveOccupation("software engineer", INDEX);
    const backwards = resolveOccupation(
      "software engineer",
      [...INDEX].reverse(),
    );

    expect(backwards.candidates.map((c) => c.socCode)).toEqual(
      forwards.candidates.map((c) => c.socCode),
    );
  });

  it("orders candidates by descending confidence", () => {
    const result = resolveOccupation("developer", INDEX);

    for (let i = 1; i < result.candidates.length; i += 1) {
      expect(result.candidates[i - 1]!.confidence).toBeGreaterThanOrEqual(
        result.candidates[i]!.confidence,
      );
    }
  });
});

describe("resolution thresholds", () => {
  it("keeps the documented ordering between thresholds", () => {
    expect(AUTO_ACCEPT_CONFIDENCE).toBeGreaterThan(CONFIRM_CONFIDENCE);
    expect(AMBIGUITY_MARGIN).toBeGreaterThan(0);
  });

  it("never auto-accepts a token-overlap-only match", () => {
    // Partial word matches are capped below the auto-accept threshold, so a
    // weak guess can never be persisted without the user seeing it.
    const result = resolveOccupation("developer", INDEX);
    const top = result.candidates[0];

    if (top?.matchType === "token_overlap") {
      expect(top.confidence).toBeLessThan(AUTO_ACCEPT_CONFIDENCE);
    }
    expect(result.action).not.toBe("auto_accept");
  });

  it("requires a clear lead before auto-accepting", () => {
    const result = resolveOccupation("registered nurse", INDEX);
    const [top, runnerUp] = result.candidates;

    if (result.action === "auto_accept" && runnerUp) {
      expect(top!.confidence - runnerUp.confidence).toBeGreaterThanOrEqual(
        AMBIGUITY_MARGIN,
      );
    }
  });
});
