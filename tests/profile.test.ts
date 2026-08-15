import { describe, expect, it } from "vitest";

import { FREE_TEXT_GOALS_MAX_LENGTH } from "@/lib/constants";
import { profileInputSchema } from "@/lib/validation/profile";
import type { ProfileInput } from "@/types/profile";

const VALID_PROFILE: ProfileInput = {
  ageRange: "25-34",
  householdIncome: 118_000,
  occupation: "Software Engineer",
  relationshipStatus: "married",
  children: 2,
  householdSize: 4,
  currentCity: "Brooklyn",
  currentState: "NY",
  housingBudget: 3_200,
  workPreference: "remote",
  freeTextGoals: "More space, a shorter commute and a real backyard.",
};

function parseWith(overrides: Partial<Record<keyof ProfileInput, unknown>>) {
  return profileInputSchema.safeParse({ ...VALID_PROFILE, ...overrides });
}

describe("profileInputSchema", () => {
  it("accepts a fully valid profile", () => {
    const result = profileInputSchema.safeParse(VALID_PROFILE);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(VALID_PROFILE);
  });

  it("accepts a profile with no free-text goals", () => {
    const result = parseWith({ freeTextGoals: null });

    expect(result.success).toBe(true);
  });

  it("rejects a household size below 1", () => {
    const result = parseWith({ householdSize: 0, children: 0 });

    expect(result.success).toBe(false);
    // A household of 0 trips both the lower bound and the "user plus every
    // child" rule, so every issue must still point at householdSize.
    expect(
      new Set(result.error?.issues.map((issue) => issue.path.join("."))),
    ).toEqual(new Set(["householdSize"]));
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      "Household size must include at least one person",
    );
  });

  it("rejects a fractional household size", () => {
    const result = parseWith({ householdSize: 2.5 });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "householdSize",
    ]);
  });

  it("rejects a household smaller than the user plus their children", () => {
    const result = parseWith({ children: 3, householdSize: 2 });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "householdSize",
    ]);
    expect(result.error?.issues[0]?.message).toBe(
      "Household size must account for the user and every child",
    );
  });

  it("accepts a household exactly covering the user and their children", () => {
    const result = parseWith({ children: 3, householdSize: 4 });

    expect(result.success).toBe(true);
  });

  it("rejects negative household income", () => {
    const result = parseWith({ householdIncome: -1 });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "householdIncome",
    ]);
  });

  it("rejects a negative housing budget", () => {
    const result = parseWith({ housingBudget: -0.01 });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "housingBudget",
    ]);
  });

  it("accepts zero income and zero budget", () => {
    const result = parseWith({ householdIncome: 0, housingBudget: 0 });

    expect(result.success).toBe(true);
  });

  it("rejects a negative number of children", () => {
    const result = parseWith({ children: -1 });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain(
      "children",
    );
  });

  it("rejects an unknown state code", () => {
    const result = parseWith({ currentState: "ZZ" });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "currentState",
    ]);
  });

  it("rejects an unknown work preference", () => {
    const result = parseWith({ workPreference: "part-time" });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "workPreference",
    ]);
  });

  it("rejects an occupation that is blank once trimmed", () => {
    const result = parseWith({ occupation: "   " });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "occupation",
    ]);
  });

  it("trims surrounding whitespace from free-text fields", () => {
    const result = parseWith({
      occupation: "  Nurse  ",
      currentCity: "  Denver  ",
    });

    expect(result.success).toBe(true);
    expect(result.data?.occupation).toBe("Nurse");
    expect(result.data?.currentCity).toBe("Denver");
  });

  it("rejects free-text goals beyond the documented limit", () => {
    const result = parseWith({
      freeTextGoals: "x".repeat(FREE_TEXT_GOALS_MAX_LENGTH + 1),
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "freeTextGoals",
    ]);
  });

  it("reports each invalid field when several are wrong at once", () => {
    const result = parseWith({
      householdIncome: -5,
      currentState: "XX",
      ageRange: "toddler",
    });

    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map((issue) => issue.path.join(".")).sort(),
    ).toEqual(["ageRange", "currentState", "householdIncome"]);
  });
});
