import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import type { Database } from "@/types/database";
import type {
  PreferenceWeightKey,
  PreferenceWeights,
  Preferences,
} from "@/types/profile";

/**
 * Boundary between the flat `*_weight` columns and the nested `weights`
 * domain object.
 *
 * The database stores one column per dimension; the domain model keeps them in
 * a single record so scoring can iterate dimensions without naming each one.
 */

type PreferencesRow = Database["public"]["Tables"]["preferences"]["Row"];
type PreferencesInsert = Database["public"]["Tables"]["preferences"]["Insert"];

/**
 * Dimension -> column name.
 *
 * `satisfies` makes this exhaustive: adding a dimension to
 * PREFERENCE_WEIGHT_KEYS without adding it here is a compile error, and a
 * typo in a column name is caught against the generated row type.
 */
const WEIGHT_COLUMNS = {
  career: "career_weight",
  housing: "housing_weight",
  cost: "cost_weight",
  safety: "safety_weight",
  education: "education_weight",
  social: "social_weight",
  transport: "transport_weight",
  climate: "climate_weight",
  family: "family_weight",
  healthcare: "healthcare_weight",
} satisfies Record<PreferenceWeightKey, keyof PreferencesRow>;

/** Database row -> nested domain weights. */
export function toPreferenceWeights(row: PreferencesRow): PreferenceWeights {
  const weights = {} as PreferenceWeights;

  for (const key of PREFERENCE_WEIGHT_KEYS) {
    weights[key] = row[WEIGHT_COLUMNS[key]];
  }

  return weights;
}

/** Database row -> full domain object. */
export function toPreferences(row: PreferencesRow): Preferences {
  return {
    id: row.id,
    profileId: row.profile_id,
    weights: toPreferenceWeights(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Validated weights + owning profile -> database row.
 *
 * `profileId` is passed separately so it can only come from a profile the
 * caller has already resolved from the authenticated session.
 */
export function toPreferencesUpsert(
  weights: PreferenceWeights,
  profileId: string,
): PreferencesInsert {
  const row = { profile_id: profileId } as PreferencesInsert;

  for (const key of PREFERENCE_WEIGHT_KEYS) {
    row[WEIGHT_COLUMNS[key]] = weights[key];
  }

  return row;
}
