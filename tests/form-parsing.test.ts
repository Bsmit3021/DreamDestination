import { describe, expect, it } from "vitest";

import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import { formNullableString, formNumber, toFieldErrors } from "@/lib/forms";
import { parsePreferencesFormData } from "@/lib/validation/preferences";
import { parseProfileFormData } from "@/lib/validation/profile";

/**
 * These cover the boundary where untyped form input becomes validated domain
 * data — the exact path a browser submission takes through the server actions.
 */

const VALID_PROFILE_FIELDS: Record<string, string> = {
  ageRange: "25-34",
  householdIncome: "118000",
  occupation: "Software Engineer",
  relationshipStatus: "married",
  children: "2",
  householdSize: "4",
  currentCity: "Brooklyn",
  currentState: "NY",
  housingBudget: "3200",
  desiredBedrooms: "two",
  climatePreference: "warm",
  workPreference: "remote",
  freeTextGoals: "More space.",
};

function profileFormData(overrides: Record<string, string> = {}) {
  const formData = new FormData();

  for (const [key, value] of Object.entries({
    ...VALID_PROFILE_FIELDS,
    ...overrides,
  })) {
    formData.set(key, value);
  }

  return formData;
}

function preferencesFormData(overrides: Record<string, string> = {}) {
  const formData = new FormData();

  for (const key of PREFERENCE_WEIGHT_KEYS) {
    formData.set(key, "0.5");
  }
  for (const [key, value] of Object.entries(overrides)) {
    formData.set(key, value);
  }

  return formData;
}

describe("formNumber", () => {
  it("parses a numeric string", () => {
    const formData = new FormData();
    formData.set("value", "42.5");

    expect(formNumber(formData, "value")).toBe(42.5);
  });

  it("returns undefined for a blank or absent value", () => {
    const formData = new FormData();
    formData.set("blank", "   ");

    expect(formNumber(formData, "blank")).toBeUndefined();
    expect(formNumber(formData, "absent")).toBeUndefined();
  });

  it("returns undefined rather than NaN for junk", () => {
    const formData = new FormData();
    formData.set("value", "not a number");

    expect(formNumber(formData, "value")).toBeUndefined();
  });

  it("rejects non-finite input", () => {
    const formData = new FormData();
    formData.set("value", "Infinity");

    expect(formNumber(formData, "value")).toBeUndefined();
  });

  it("parses zero, which must not be treated as absent", () => {
    const formData = new FormData();
    formData.set("value", "0");

    expect(formNumber(formData, "value")).toBe(0);
  });
});

describe("formNullableString", () => {
  it("maps an empty textarea to null", () => {
    const formData = new FormData();
    formData.set("notes", "   ");

    expect(formNullableString(formData, "notes")).toBeNull();
  });

  it("trims a supplied value", () => {
    const formData = new FormData();
    formData.set("notes", "  hello  ");

    expect(formNullableString(formData, "notes")).toBe("hello");
  });
});

describe("toFieldErrors", () => {
  it("groups issues by field name", () => {
    const result = parseProfileFormData(
      profileFormData({ householdIncome: "-5", currentState: "ZZ" }),
    );

    expect(result.success).toBe(false);
    const grouped = toFieldErrors(result.error!);

    expect(Object.keys(grouped).sort()).toEqual([
      "currentState",
      "householdIncome",
    ]);
    expect(grouped.householdIncome?.[0]).toBe(
      "Household income cannot be negative",
    );
  });
});

describe("parseProfileFormData", () => {
  it("converts a valid submission into typed domain data", () => {
    const result = parseProfileFormData(profileFormData());

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      ageRange: "25-34",
      householdIncome: 118000,
      occupation: "Software Engineer",
      relationshipStatus: "married",
      children: 2,
      householdSize: 4,
      currentCity: "Brooklyn",
      currentState: "NY",
      housingBudget: 3200,
      desiredBedrooms: "two",
      climatePreference: "warm",
      // No checkbox was ticked, so the form yields an empty selection rather
      // than null: this submission was asked and answered "nothing specific".
      lifestylePreferences: [],
      workPreference: "remote",
      freeTextGoals: "More space.",
    });
  });

  it("reads an unanswered home-size or climate select as null, not an error", () => {
    // The two Phase 6A questions are optional: an empty select must mean
    // "unstated" rather than blocking the whole submission.
    const result = parseProfileFormData(
      profileFormData({ desiredBedrooms: "", climatePreference: "" }),
    );

    expect(result.success).toBe(true);
    expect(result.data?.desiredBedrooms).toBeNull();
    expect(result.data?.climatePreference).toBeNull();
  });

  it("rejects a home size outside the supported set", () => {
    const result = parseProfileFormData(
      profileFormData({ desiredBedrooms: "five" }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain(
      "desiredBedrooms",
    );
  });

  it("treats an omitted optional goals field as null", () => {
    const formData = profileFormData();
    formData.delete("freeTextGoals");

    const result = parseProfileFormData(formData);

    expect(result.success).toBe(true);
    expect(result.data?.freeTextGoals).toBeNull();
  });

  it("rejects a blank required select", () => {
    const result = parseProfileFormData(profileFormData({ ageRange: "" }));

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain(
      "ageRange",
    );
  });

  it("rejects a household size of zero", () => {
    const result = parseProfileFormData(
      profileFormData({ householdSize: "0", children: "0" }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain(
      "householdSize",
    );
  });

  it("enforces the household-size / children rule end to end", () => {
    const result = parseProfileFormData(
      profileFormData({ children: "3", householdSize: "2" }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Household size must account for the user and every child",
    );
  });

  it("rejects a negative income submitted as a string", () => {
    const result = parseProfileFormData(
      profileFormData({ householdIncome: "-1" }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain(
      "householdIncome",
    );
  });

  it("rejects a non-numeric income without producing a NaN error", () => {
    const result = parseProfileFormData(
      profileFormData({ householdIncome: "a lot" }),
    );

    expect(result.success).toBe(false);
    const message = result.error?.issues[0]?.message ?? "";
    expect(message).not.toContain("NaN");
  });
});

describe("parsePreferencesFormData", () => {
  it("collects every slider into a weights object", () => {
    const result = parsePreferencesFormData(preferencesFormData());

    expect(result.success).toBe(true);
    expect(Object.keys(result.data ?? {}).sort()).toEqual(
      [...PREFERENCE_WEIGHT_KEYS].sort(),
    );
  });

  it("accepts the boundary values 0 and 1", () => {
    const result = parsePreferencesFormData(
      preferencesFormData({ career: "0", housing: "1" }),
    );

    expect(result.success).toBe(true);
    expect(result.data?.career).toBe(0);
    expect(result.data?.housing).toBe(1);
  });

  it("rejects a weight above 1", () => {
    const result = parsePreferencesFormData(
      preferencesFormData({ safety: "1.2" }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "safety",
    ]);
  });

  it("rejects a weight below 0", () => {
    const result = parsePreferencesFormData(
      preferencesFormData({ climate: "-0.1" }),
    );

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "climate",
    ]);
  });

  it("rejects a submission missing a dimension", () => {
    const formData = preferencesFormData();
    formData.delete("healthcare");

    const result = parsePreferencesFormData(formData);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "healthcare",
    ]);
  });

  it("ignores extra fields that are not scoring dimensions", () => {
    const formData = preferencesFormData();
    formData.set("mode", "edit");
    formData.set("profile_id", "someone-elses-profile");

    const result = parsePreferencesFormData(formData);

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("profile_id");
  });
});
