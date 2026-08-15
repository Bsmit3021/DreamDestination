import { describe, expect, it } from "vitest";

import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import {
  toPreferenceWeights,
  toPreferences,
  toPreferencesUpsert,
} from "@/lib/mappers/preferences";
import { toProfile, toProfileInsert } from "@/lib/mappers/profile";
import type { Database } from "@/types/database";
import type { PreferenceWeights, ProfileInput } from "@/types/profile";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type PreferencesRow = Database["public"]["Tables"]["preferences"]["Row"];

const PROFILE_ROW: ProfileRow = {
  id: "11111111-1111-1111-1111-111111111111",
  user_id: "22222222-2222-2222-2222-222222222222",
  age_range: "25-34",
  household_income: 118000,
  occupation: "Software Engineer",
  relationship_status: "married",
  children: 2,
  household_size: 4,
  current_city: "Brooklyn",
  current_state: "NY",
  housing_budget: 3200,
  work_preference: "remote",
  free_text_goals: "More space.",
  created_at: "2026-08-14T00:00:00.000Z",
  updated_at: "2026-08-14T00:00:00.000Z",
};

const PREFERENCES_ROW: PreferencesRow = {
  id: "33333333-3333-3333-3333-333333333333",
  profile_id: PROFILE_ROW.id,
  career_weight: 0.9,
  housing_weight: 0.8,
  cost_weight: 0.7,
  safety_weight: 0.6,
  education_weight: 0.5,
  social_weight: 0.4,
  transport_weight: 0.3,
  climate_weight: 0.2,
  family_weight: 0.1,
  healthcare_weight: 0,
  created_at: "2026-08-14T00:00:00.000Z",
  updated_at: "2026-08-14T00:00:00.000Z",
};

describe("profile mapper", () => {
  it("renames every column to its camelCase counterpart", () => {
    expect(toProfile(PROFILE_ROW)).toEqual({
      id: PROFILE_ROW.id,
      userId: PROFILE_ROW.user_id,
      ageRange: "25-34",
      householdIncome: 118000,
      occupation: "Software Engineer",
      relationshipStatus: "married",
      children: 2,
      householdSize: 4,
      currentCity: "Brooklyn",
      currentState: "NY",
      housingBudget: 3200,
      workPreference: "remote",
      freeTextGoals: "More space.",
      createdAt: PROFILE_ROW.created_at,
      updatedAt: PROFILE_ROW.updated_at,
    });
  });

  it("preserves a null free_text_goals rather than coercing it", () => {
    const profile = toProfile({ ...PROFILE_ROW, free_text_goals: null });

    expect(profile.freeTextGoals).toBeNull();
  });

  it("writes the owner from the supplied user id", () => {
    const input: ProfileInput = {
      ageRange: "35-44",
      householdIncome: 90000,
      occupation: "Nurse",
      relationshipStatus: "single",
      children: 0,
      householdSize: 1,
      currentCity: "Denver",
      currentState: "CO",
      housingBudget: 1800,
      workPreference: "onsite",
      freeTextGoals: null,
    };

    const row = toProfileInsert(input, "44444444-4444-4444-4444-444444444444");

    expect(row.user_id).toBe("44444444-4444-4444-4444-444444444444");
    expect(row.household_size).toBe(1);
    expect(row.current_state).toBe("CO");
    expect(row.free_text_goals).toBeNull();
  });

  it("round-trips domain input through the database shape unchanged", () => {
    const profile = toProfile(PROFILE_ROW);
    const row = toProfileInsert(profile, profile.userId);

    // Every column the insert controls should match the original row.
    for (const key of Object.keys(row) as (keyof typeof row)[]) {
      expect(row[key]).toEqual(PROFILE_ROW[key as keyof ProfileRow]);
    }
  });

  it("does not leak server-managed columns into the insert payload", () => {
    const row = toProfileInsert(toProfile(PROFILE_ROW), PROFILE_ROW.user_id);

    expect(row).not.toHaveProperty("id");
    expect(row).not.toHaveProperty("created_at");
    expect(row).not.toHaveProperty("updated_at");
  });
});

describe("preferences mapper", () => {
  it("collapses the flat weight columns into the nested domain shape", () => {
    expect(toPreferenceWeights(PREFERENCES_ROW)).toEqual({
      career: 0.9,
      housing: 0.8,
      cost: 0.7,
      safety: 0.6,
      education: 0.5,
      social: 0.4,
      transport: 0.3,
      climate: 0.2,
      family: 0.1,
      healthcare: 0,
    });
  });

  it("maps every declared dimension", () => {
    const weights = toPreferenceWeights(PREFERENCES_ROW);

    expect(Object.keys(weights).sort()).toEqual(
      [...PREFERENCE_WEIGHT_KEYS].sort(),
    );
  });

  it("builds the full domain object", () => {
    const preferences = toPreferences(PREFERENCES_ROW);

    expect(preferences.id).toBe(PREFERENCES_ROW.id);
    expect(preferences.profileId).toBe(PREFERENCES_ROW.profile_id);
    expect(preferences.weights.career).toBe(0.9);
    expect(preferences.createdAt).toBe(PREFERENCES_ROW.created_at);
  });

  it("expands nested weights back into flat columns", () => {
    const weights = toPreferenceWeights(PREFERENCES_ROW);
    const row = toPreferencesUpsert(weights, "profile-id");

    expect(row).toEqual({
      profile_id: "profile-id",
      career_weight: 0.9,
      housing_weight: 0.8,
      cost_weight: 0.7,
      safety_weight: 0.6,
      education_weight: 0.5,
      social_weight: 0.4,
      transport_weight: 0.3,
      climate_weight: 0.2,
      family_weight: 0.1,
      healthcare_weight: 0,
    });
  });

  it("round-trips weights without drift", () => {
    const original = toPreferenceWeights(PREFERENCES_ROW);
    const rebuilt = toPreferenceWeights({
      ...PREFERENCES_ROW,
      ...toPreferencesUpsert(original, PREFERENCES_ROW.profile_id),
    } as PreferencesRow);

    expect(rebuilt).toEqual(original);
  });

  it("preserves the boundary values 0 and 1 exactly", () => {
    const weights = Object.fromEntries(
      PREFERENCE_WEIGHT_KEYS.map((key, index) => [
        key,
        index % 2 === 0 ? 0 : 1,
      ]),
    ) as PreferenceWeights;

    const row = toPreferencesUpsert(weights, "profile-id");

    expect(row.career_weight).toBe(0);
    expect(row.housing_weight).toBe(1);
  });
});
