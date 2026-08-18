"use server";

import { revalidatePath } from "next/cache";

import {
  loadOccupationTitleIndex,
  saveCareerTarget,
} from "@/lib/data/career-targets";
import { DataAccessError, NotAuthenticatedError } from "@/lib/data/errors";
import { getCurrentUserProfile } from "@/lib/data/profiles";
import { type FormState } from "@/lib/forms";
import { resolveOccupation } from "@/lib/occupations/resolver";
import { ROUTES } from "@/lib/routes";

/**
 * Confirms which SOC occupation the user's free-text job title refers to.
 *
 * The submitted SOC code is validated against the resolver's own candidate list
 * for that user's occupation text — a client cannot post an arbitrary code and
 * have it stored. The profile is resolved from the session, never from input.
 */
export async function confirmOccupationAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const socCode = formData.get("socCode");

  if (typeof socCode !== "string" || !/^\d{2}-\d{4}$/.test(socCode)) {
    return { status: "error", message: "Select an occupation from the list." };
  }

  try {
    const profile = await getCurrentUserProfile();
    if (!profile) {
      return { status: "error", message: "Complete your profile first." };
    }

    const index = await loadOccupationTitleIndex();
    const resolution = resolveOccupation(profile.occupation, index);

    // Only a code the resolver actually proposed for this user's own job title
    // may be stored. This is what stops a crafted request writing an arbitrary
    // occupation onto the profile.
    const chosen = resolution.candidates.find((c) => c.socCode === socCode);
    if (!chosen) {
      return {
        status: "error",
        message: "That occupation was not one of the suggested matches.",
      };
    }

    await saveCareerTarget({
      socCode: chosen.socCode,
      sourceText: profile.occupation,
      matchMethod: "user_selected",
      matchConfidence: chosen.confidence,
      confirmedByUser: true,
    });
  } catch (error) {
    if (
      error instanceof NotAuthenticatedError ||
      error instanceof DataAccessError
    ) {
      return { status: "error", message: error.message };
    }
    throw error;
  }

  revalidatePath(ROUTES.recommendations);
  revalidatePath("/onboarding/occupation");

  return { status: "success", message: "Occupation saved." };
}
