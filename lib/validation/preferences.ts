import { z } from "zod";

import {
  NORMALIZED_MAX,
  NORMALIZED_MIN,
  PREFERENCE_WEIGHT_KEYS,
} from "@/lib/constants";
import { formNumber } from "@/lib/forms";
import type { PreferenceWeightKey, PreferenceWeights } from "@/types/profile";

/**
 * A single scoring weight: a number in the inclusive range 0–1.
 *
 * The same bounds are enforced in the database by CHECK constraints, so an
 * out-of-range value cannot reach storage even if it bypasses this schema.
 */
export const normalizedWeightSchema = z
  .number()
  .min(NORMALIZED_MIN, { message: "Weight must be at least 0" })
  .max(NORMALIZED_MAX, { message: "Weight must be at most 1" });

/**
 * One entry per scoring dimension.
 *
 * The `satisfies` clause makes a missing or misspelled dimension a compile-time
 * error rather than a schema that silently ignores an unknown weight.
 */
const preferenceWeightsShape = {
  career: normalizedWeightSchema,
  housing: normalizedWeightSchema,
  cost: normalizedWeightSchema,
  safety: normalizedWeightSchema,
  education: normalizedWeightSchema,
  social: normalizedWeightSchema,
  transport: normalizedWeightSchema,
  climate: normalizedWeightSchema,
  family: normalizedWeightSchema,
  healthcare: normalizedWeightSchema,
} satisfies Record<PreferenceWeightKey, typeof normalizedWeightSchema>;

export const preferenceWeightsSchema = z.object(
  preferenceWeightsShape,
) satisfies z.ZodType<PreferenceWeights>;

/** Payload accepted when a user saves their weights. */
export const preferencesInputSchema = z.object({
  weights: preferenceWeightsSchema,
});

export type PreferenceWeightsSchema = z.infer<typeof preferenceWeightsSchema>;
export type PreferencesInputSchema = z.infer<typeof preferencesInputSchema>;

/**
 * Reads a submitted preferences form and validates it with the schema above.
 *
 * One form field per dimension, named after the dimension itself. Adds no
 * rules of its own — the 0-1 bounds come from `normalizedWeightSchema`.
 */
export function parsePreferencesFormData(formData: FormData) {
  const weights: Record<string, number | undefined> = {};

  for (const key of PREFERENCE_WEIGHT_KEYS) {
    weights[key] = formNumber(formData, key);
  }

  return preferenceWeightsSchema.safeParse(weights);
}
