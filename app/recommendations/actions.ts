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
 * Recalculates the signed-in user's recommendations.
 *
 * Reruns the deterministic engine from the user's latest saved profile and
 * priorities and atomically replaces their stored snapshot — best matches and
 * alternatives together, from one scoring run. The same inputs give the same
 * ranking, so an unchanged top five is a correct result, not a failure.
 *
 * Takes no arguments describing *who* to generate for — the service resolves
 * that from the session. There is deliberately no way for the browser to name
 * a profile.
 */
export async function recalculateRecommendationsAction(
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

    // The layout covers the matches page, the comparison and destination pages,
    // which all read the snapshot that was just replaced.
    revalidatePath(ROUTES.recommendations, "layout");

    return {
      status: "success",
      message:
        "Your best matches were recalculated using your latest profile and priorities.",
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
