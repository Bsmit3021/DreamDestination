"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  DataAccessError,
  MissingProfileError,
  NotAuthenticatedError,
} from "@/lib/data/errors";
import { upsertCurrentUserPreferences } from "@/lib/data/preferences";
import { upsertCurrentUserProfile } from "@/lib/data/profiles";
import {
  type FormState,
  type SubmittedValues,
  collectValues,
  validationFailed,
} from "@/lib/forms";
import { ROUTES } from "@/lib/routes";
import { parsePreferencesFormData } from "@/lib/validation/preferences";
import { parseProfileFormData } from "@/lib/validation/profile";

/**
 * Onboarding mutations.
 *
 * Each one: validates unknown input with Zod, then hands off to the data layer,
 * which resolves the owner from the authenticated session. No action reads a
 * user or profile id from the submitted form.
 *
 * `redirect()` throws to signal navigation, so it is always called after the
 * try/catch rather than inside it.
 */

/**
 * Maps a thrown data-layer error onto form state.
 *
 * Anything unrecognised is re-thrown rather than swallowed, so a genuine bug
 * surfaces as an error instead of a misleading message. This is also why
 * `redirect()` is never called inside a try block: its control-flow signal
 * would land here.
 */
function toErrorState(error: unknown, values?: SubmittedValues): FormState {
  if (
    error instanceof NotAuthenticatedError ||
    error instanceof MissingProfileError ||
    error instanceof DataAccessError
  ) {
    return { status: "error", message: error.message, values };
  }

  throw error;
}

/** Every profile field, echoed back so a rejected submission is not lost. */
const PROFILE_FIELDS = [
  "ageRange",
  "householdIncome",
  "occupation",
  "relationshipStatus",
  "children",
  "householdSize",
  "currentCity",
  "currentState",
  "housingBudget",
  "workPreference",
  "freeTextGoals",
] as const;

export async function saveProfileAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parseProfileFormData(formData);
  const echoed = collectValues(formData, PROFILE_FIELDS);

  if (!parsed.success) {
    return validationFailed(parsed.error, echoed);
  }

  const isEdit = formData.get("mode") === "edit";

  try {
    await upsertCurrentUserProfile(parsed.data);
  } catch (error) {
    return toErrorState(error, echoed);
  }

  revalidatePath(ROUTES.onboarding, "layout");

  // First time through, continue to the next step. When editing an existing
  // profile, go back to the summary instead of forcing the whole flow again.
  redirect(isEdit ? ROUTES.onboarding : ROUTES.onboardingPreferences);
}

export async function savePreferencesAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = parsePreferencesFormData(formData);

  if (!parsed.success) {
    return validationFailed(parsed.error);
  }

  try {
    await upsertCurrentUserPreferences(parsed.data);
  } catch (error) {
    return toErrorState(error);
  }

  revalidatePath(ROUTES.onboarding, "layout");
  redirect(ROUTES.onboarding);
}
