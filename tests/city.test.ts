import { describe, expect, it } from "vitest";

import { cityInputSchema } from "@/lib/validation/city";

const VALID_CITY = {
  slug: "austin-tx",
  city: "Austin",
  state: "TX",
  metro: "Austin-Round Rock",
  population: 961_855,
  latitude: 30.267153,
  longitude: -97.743057,
};

function parseWith(overrides: Record<string, unknown>) {
  return cityInputSchema.safeParse({ ...VALID_CITY, ...overrides });
}

describe("cityInputSchema", () => {
  it("accepts a well-formed city", () => {
    expect(cityInputSchema.safeParse(VALID_CITY).success).toBe(true);
  });

  it("accepts a city with no metro or population", () => {
    expect(parseWith({ metro: null, population: null }).success).toBe(true);
  });

  it.each([
    ["above the maximum", 90.0001],
    ["below the minimum", -90.0001],
  ])("rejects a latitude %s", (_label, latitude) => {
    const result = parseWith({ latitude });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "latitude",
    ]);
  });

  it.each([
    ["above the maximum", 180.0001],
    ["below the minimum", -180.0001],
  ])("rejects a longitude %s", (_label, longitude) => {
    const result = parseWith({ longitude });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "longitude",
    ]);
  });

  it("accepts the inclusive coordinate bounds", () => {
    expect(parseWith({ latitude: 90, longitude: -180 }).success).toBe(true);
    expect(parseWith({ latitude: -90, longitude: 180 }).success).toBe(true);
  });

  it.each(["Austin-TX", "austin_tx", "austin--tx", "-austin-tx", "austin-tx-"])(
    "rejects the malformed slug %s",
    (slug) => {
      const result = parseWith({ slug });

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual(
        ["slug"],
      );
    },
  );

  it("rejects a negative population", () => {
    const result = parseWith({ population: -1 });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "population",
    ]);
  });

  it("rejects an unknown state code", () => {
    const result = parseWith({ state: "XX" });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "state",
    ]);
  });
});
