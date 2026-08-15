"use server";

import { revalidatePath } from "next/cache";

import {
  DataAccessError,
  MissingProfileError,
  NotAuthenticatedError,
} from "@/lib/data/errors";
import {
  NoCityDataError,
  OnboardingIncompleteError,
  generateRecommendationsForCurrentUser,
} from "@/lib/matching/service";
import type { FormState } from "@/lib/forms";
import { ROUTES } from "@/lib/routes";

/**
 * Regenerates the signed-in user's recommendations.
 *
 * Takes no arguments describing *who* to generate for — the service resolves
 * that from the session. There is deliberately no way for the browser to name
 * a profile.
 */
export async function generateRecommendationsAction(
  _prevState: FormState,
): Promise<FormState> {
  try {
    const result = await generateRecommendationsForCurrentUser();

    if (result.recommendations.length === 0) {
      return {
        status: "error",
        message:
          "No city could be scored against your priorities. The dimensions " +
          "you weighted most heavily do not have data yet.",
      };
    }

    revalidatePath(ROUTES.recommendations);

    return {
      status: "success",
      message: `Generated ${result.recommendations.length} matches.`,
    };
  } catch (error) {
    if (
      error instanceof NotAuthenticatedError ||
      error instanceof MissingProfileError ||
      error instanceof OnboardingIncompleteError ||
      error instanceof NoCityDataError ||
      error instanceof DataAccessError
    ) {
      return { status: "error", message: error.message };
    }

    throw error;
  }
}
