/**
 * Centralised domain constants.
 *
 * These arrays are the single source of truth for the closed value sets used
 * across the app. Domain types (`types/*.ts`) and Zod schemas
 * (`lib/validation/*.ts`) both derive from them, so a value is never written
 * out as a magic string twice on the TypeScript side.
 *
 * The database mirrors these sets with Postgres enums / CHECK constraints in
 * `supabase/migrations`. Keep the two in sync when a set changes.
 */

export const AGE_RANGES = [
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55-64",
  "65+",
] as const;

export const RELATIONSHIP_STATUSES = [
  "single",
  "partnered",
  "married",
  "divorced",
  "widowed",
] as const;

export const WORK_PREFERENCES = [
  "remote",
  "hybrid",
  "onsite",
  "flexible",
] as const;

/**
 * The housing size a user says they want.
 *
 * Deliberately an explicit answer rather than something inferred from
 * household size: two people may want a one-bedroom or a three-bedroom, and
 * guessing would silently change which ACS rent a metro is judged on. Each
 * value maps to exactly one bedroom-specific ACS B25031 rent already stored in
 * `housing_market_stats`.
 */
export const DESIRED_BEDROOMS = [
  "studio",
  "one",
  "two",
  "three",
  "four_plus",
] as const;

/**
 * The climate a user says they want to live in.
 *
 * `no_preference` is a real answer, not a missing one: it means climate should
 * neither reward nor punish a metro, which the engine implements by removing
 * the dimension's weight rather than by inventing a target temperature.
 */
export const CLIMATE_PREFERENCES = [
  "warm",
  "mild",
  "four_seasons",
  "cool",
  "no_preference",
] as const;

/**
 * Lifestyle categories a user can say they care about.
 *
 * These are DreamDestination product definitions, not Overture labels. Each is
 * backed by an explicit, committed mapping from verified Overture
 * `basic_category` values — see scripts/lifestyle/taxonomy-mapping.json.
 *
 * `community_spaces` is deliberately narrow: Overture has no broad "community
 * space" concept, so it covers community centres, public plazas and libraries
 * rather than the civic organisations and government offices that dominate its
 * community root. Those are organisations, not places people go.
 */
export const LIFESTYLE_CATEGORIES = [
  "food_drink",
  "nightlife",
  "arts_culture",
  "live_entertainment",
  "fitness_recreation",
  "parks_outdoors",
  "shopping",
  "community_spaces",
] as const;

/** How many lifestyle categories a user may select. Selecting none is valid. */
export const MAX_LIFESTYLE_SELECTIONS = 5;

/**
 * The scoring dimensions a user can weight during onboarding. The same keys
 * name the `*_weight` columns on `preferences` and the `*_score` columns on
 * `city_metrics`.
 */
export const PREFERENCE_WEIGHT_KEYS = [
  "career",
  "housing",
  "cost",
  "safety",
  "education",
  "social",
  "transport",
  "climate",
  "family",
  "healthcare",
] as const;

/**
 * Scoring dimensions that carry a corresponding normalised city metric today.
 * `social` and `family` are user-side weights only until the relevant data
 * sources land, so they are deliberately absent here.
 */
export const CITY_SCORE_KEYS = [
  "career",
  "housing",
  "education",
  "safety",
  "transport",
  "climate",
  "healthcare",
  "cost",
] as const;

/** USPS codes for the 50 states plus the District of Columbia. */
export const US_STATE_CODES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
] as const;

/** Inclusive bounds for every normalised weight and score in the system. */
export const NORMALIZED_MIN = 0;
export const NORMALIZED_MAX = 1;

/** Upper bound on the free-text goals field, mirrored by a CHECK constraint. */
export const FREE_TEXT_GOALS_MAX_LENGTH = 2000;
