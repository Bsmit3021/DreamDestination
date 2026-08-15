import { DIMENSIONS } from "@/lib/matching/dimensions";
import type { CandidateCity } from "@/lib/matching/types";
import type { Profile } from "@/types/profile";

/**
 * Hard filters: requirements that remove a city entirely, as opposed to
 * preferences that merely push it down the list.
 *
 * Only one filter is implemented, because only one is genuinely supported by
 * the data onboarding collects today. The rest of the profile is recorded in
 * UNUSED_PROFILE_FIELDS below rather than turned into invented rules.
 */

/**
 * How far above a user's stated budget the typical rent may sit before a metro
 * is treated as out of reach.
 *
 * Median rent above budget does not by itself make a city impossible — half of
 * all rentals cost less than the median. The multiplier allows for renting
 * below the middle of the market; beyond it, even a modest home is a stretch.
 */
export const BUDGET_TOLERANCE_MULTIPLIER = 1.5;

/**
 * Minimum share of the user's weight that must land on measurable dimensions
 * for a city to be ranked at all.
 *
 * Below this, a "fit score" would be extrapolating from too little of what the
 * user said they cared about, so the city is dropped rather than shown with a
 * quietly unreliable number.
 */
export const MINIMUM_DATA_COVERAGE = 0.6;

/**
 * Profile fields that are collected but deliberately not used as filters yet,
 * with the reason. Kept in code so the gap stays visible.
 */
export const UNUSED_PROFILE_FIELDS = {
  ageRange: "No metric currently varies meaningfully by the user's age band.",
  relationshipStatus:
    "No dimension is measured differently by relationship status.",
  children:
    "Would justify weighting education more heavily, but that is the user's call via the sliders, not ours.",
  householdSize:
    "Would need bedroom-count rents to be actionable; ACS median gross rent is not split by unit size.",
  occupation:
    "Would need occupation-level employment data by metro; only the overall unemployment rate is wired up.",
  workPreference:
    "Remote work plausibly reduces how much the local job market matters, but silently rewriting a user's career weight would misrepresent what they asked for.",
  currentCity: "Used for context only; the user's own metro is still eligible.",
  currentState:
    "Not treated as a constraint — a relocation tool should not assume the user wants to stay put.",
  freeTextGoals: "Free text is not parsed; that is the later LLM work package.",
} as const;

export interface FilterOutcome {
  passed: boolean;
  reason?: "budget";
  detail?: string;
}

/**
 * Excludes metros whose typical rent is far beyond the user's stated budget.
 *
 * Skipped entirely when the budget is zero or negative: the schema permits
 * zero, but it means "unspecified" far more often than "I can pay nothing", and
 * filtering on it would eliminate every city.
 */
export function applyHardFilters(
  city: CandidateCity,
  profile: Profile,
): FilterOutcome {
  const budget = profile.housingBudget;

  if (!Number.isFinite(budget) || budget <= 0) {
    return { passed: true };
  }

  const rentMetricKey = DIMENSIONS.housing.metric?.key;
  const observation = city.observations.housing;

  if (!observation || observation.metricKey !== rentMetricKey) {
    // No rent measurement means no basis to rule the city out.
    return { passed: true };
  }

  const ceiling = budget * BUDGET_TOLERANCE_MULTIPLIER;

  if (observation.rawValue > ceiling) {
    return {
      passed: false,
      reason: "budget",
      detail:
        `Median rent is $${Math.round(observation.rawValue)}/mo, more than ` +
        `${BUDGET_TOLERANCE_MULTIPLIER}× the $${Math.round(budget)}/mo budget.`,
    };
  }

  return { passed: true };
}
