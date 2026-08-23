import type { Profile, ProfileInput, UsStateCode } from "@/types/profile";
import type { Database } from "@/types/database";

/**
 * The one place where the `profiles` table's snake_case columns meet the
 * camelCase domain model. Nothing else in the app should rename these fields.
 */

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"];

/** Database row -> domain object. */
export function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    userId: row.user_id,
    ageRange: row.age_range,
    householdIncome: row.household_income,
    occupation: row.occupation,
    relationshipStatus: row.relationship_status,
    children: row.children,
    householdSize: row.household_size,
    currentCity: row.current_city,
    // `current_state` is a Postgres DOMAIN over text, so the generated type
    // widens to `string`. The value set is enforced by the domain's CHECK
    // constraint and by profileInputSchema on the way in.
    currentState: row.current_state as UsStateCode,
    housingBudget: row.housing_budget,
    desiredBedrooms: row.desired_bedrooms,
    climatePreference: row.climate_preference,
    workPreference: row.work_preference,
    freeTextGoals: row.free_text_goals,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Validated domain input + authenticated owner -> database row.
 *
 * `userId` is a separate argument rather than part of `input` so that a
 * caller physically cannot pass a browser-supplied owner: it has to come from
 * the session at the call site.
 */
export function toProfileInsert(
  input: ProfileInput,
  userId: string,
): ProfileInsert {
  return {
    user_id: userId,
    age_range: input.ageRange,
    household_income: input.householdIncome,
    occupation: input.occupation,
    relationship_status: input.relationshipStatus,
    children: input.children,
    household_size: input.householdSize,
    current_city: input.currentCity,
    current_state: input.currentState,
    housing_budget: input.housingBudget,
    desired_bedrooms: input.desiredBedrooms,
    climate_preference: input.climatePreference,
    work_preference: input.workPreference,
    free_text_goals: input.freeTextGoals,
  };
}
