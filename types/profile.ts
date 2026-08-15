import type {
  AGE_RANGES,
  PREFERENCE_WEIGHT_KEYS,
  RELATIONSHIP_STATUSES,
  US_STATE_CODES,
  WORK_PREFERENCES,
} from "@/lib/constants";

/**
 * Domain models for the user side of DreamDestination.
 *
 * Naming convention: TypeScript models use camelCase, the database uses
 * snake_case. Mapping between the two belongs to the data-access layer, which
 * is not part of Day 1.
 */

export type AgeRange = (typeof AGE_RANGES)[number];
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];
export type WorkPreference = (typeof WORK_PREFERENCES)[number];
export type UsStateCode = (typeof US_STATE_CODES)[number];

/**
 * A value normalised to the inclusive range 0–1.
 *
 * Kept as a plain `number` rather than a branded type: the range is enforced
 * by Zod at the input boundary and by CHECK constraints in the database, so a
 * nominal wrapper would add friction without adding a guarantee.
 */
export type NormalizedValue = number;

/** The structured onboarding answers that describe a user's situation. */
export interface Profile {
  id: string;
  /** Owning `auth.users` row. */
  userId: string;
  ageRange: AgeRange;
  /** Annual gross household income in USD. */
  householdIncome: number;
  occupation: string;
  relationshipStatus: RelationshipStatus;
  /** Number of children in the household. */
  children: number;
  /** Total people in the household, including the user. */
  householdSize: number;
  currentCity: string;
  currentState: UsStateCode;
  /** Monthly housing budget in USD. */
  housingBudget: number;
  workPreference: WorkPreference;
  /** Free-form description of what the user wants out of a move. */
  freeTextGoals: string | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp. */
  updatedAt: string;
}

/** Fields a user supplies; the rest are assigned by the database. */
export type ProfileInput = Omit<
  Profile,
  "id" | "userId" | "createdAt" | "updatedAt"
>;

export type PreferenceWeightKey = (typeof PREFERENCE_WEIGHT_KEYS)[number];

/**
 * How much each scoring dimension matters to this user.
 *
 * Every dimension is present and every value uses the same 0–1 scale, so
 * downstream scoring never has to special-case a missing or differently scaled
 * weight.
 */
export type PreferenceWeights = Record<PreferenceWeightKey, NormalizedValue>;

/** A user's weighting of the scoring dimensions. One row per profile. */
export interface Preferences {
  id: string;
  profileId: string;
  weights: PreferenceWeights;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp. */
  updatedAt: string;
}

/** Fields a user supplies when setting their weights. */
export type PreferencesInput = Pick<Preferences, "weights">;
