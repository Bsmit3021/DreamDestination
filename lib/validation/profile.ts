import { z } from "zod";

import {
  AGE_RANGES,
  FREE_TEXT_GOALS_MAX_LENGTH,
  RELATIONSHIP_STATUSES,
  US_STATE_CODES,
  WORK_PREFERENCES,
} from "@/lib/constants";
import { formNullableString, formNumber, formString } from "@/lib/forms";
import type { ProfileInput } from "@/types/profile";

/** Bounds shared by the free-text and short-text profile fields. */
const SHORT_TEXT_MAX_LENGTH = 120;

/**
 * Validation for the structured onboarding answers.
 *
 * The `satisfies` clause at the bottom is a compile-time guard: if this schema
 * and the `ProfileInput` domain type ever drift apart, the build fails.
 */
export const profileInputSchema = z
  .object({
    ageRange: z.enum(AGE_RANGES),

    householdIncome: z
      .number()
      .min(0, { message: "Household income cannot be negative" }),

    occupation: z
      .string()
      .trim()
      .min(1, { message: "Occupation is required" })
      .max(SHORT_TEXT_MAX_LENGTH),

    relationshipStatus: z.enum(RELATIONSHIP_STATUSES),

    children: z
      .int({ message: "Number of children must be a whole number" })
      .min(0, { message: "Number of children cannot be negative" }),

    householdSize: z
      .int({ message: "Household size must be a whole number" })
      .min(1, { message: "Household size must include at least one person" }),

    currentCity: z
      .string()
      .trim()
      .min(1, { message: "Current city is required" })
      .max(SHORT_TEXT_MAX_LENGTH),

    currentState: z.enum(US_STATE_CODES),

    housingBudget: z
      .number()
      .min(0, { message: "Housing budget cannot be negative" }),

    workPreference: z.enum(WORK_PREFERENCES),

    freeTextGoals: z.string().max(FREE_TEXT_GOALS_MAX_LENGTH).nullable(),
  })
  .refine((profile) => profile.householdSize >= profile.children + 1, {
    message: "Household size must account for the user and every child",
    path: ["householdSize"],
  }) satisfies z.ZodType<ProfileInput>;

export type ProfileInputSchema = z.infer<typeof profileInputSchema>;

/**
 * Reads a submitted profile form and validates it with the schema above.
 *
 * Lives here so the browser form, the server action and the tests all agree on
 * how raw form values map onto the domain shape. It adds no rules of its own —
 * it only turns strings into the types `profileInputSchema` expects.
 */
export function parseProfileFormData(formData: FormData) {
  return profileInputSchema.safeParse({
    ageRange: formString(formData, "ageRange"),
    householdIncome: formNumber(formData, "householdIncome"),
    occupation: formString(formData, "occupation"),
    relationshipStatus: formString(formData, "relationshipStatus"),
    children: formNumber(formData, "children"),
    householdSize: formNumber(formData, "householdSize"),
    currentCity: formString(formData, "currentCity"),
    currentState: formString(formData, "currentState"),
    housingBudget: formNumber(formData, "housingBudget"),
    workPreference: formString(formData, "workPreference"),
    freeTextGoals: formNullableString(formData, "freeTextGoals"),
  });
}
