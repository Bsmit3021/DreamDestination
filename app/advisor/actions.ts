"use server";

import { revalidatePath } from "next/cache";

import { askAdvisor } from "@/lib/ai/service";
import { createConversation, getLatestConversation } from "@/lib/data/advisor";
import {
  DataAccessError,
  MissingProfileError,
  NotAuthenticatedError,
} from "@/lib/data/errors";
import type { FormState } from "@/lib/forms";
import { ROUTES } from "@/lib/routes";

/**
 * Advisor mutations.
 *
 * The browser supplies only a question and a conversation id. Neither is
 * trusted as authority: the service re-derives the user from the session and
 * verifies conversation ownership before anything is written or sent.
 */

export async function askAdvisorAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const question = String(formData.get("question") ?? "").trim();
  const conversationId = String(formData.get("conversationId") ?? "");

  if (!question) {
    return { status: "error", message: "Enter a question to ask the advisor." };
  }

  try {
    const outcome = await askAdvisor({ conversationId, question });

    revalidatePath(ROUTES.advisor);

    if (!outcome.ok) {
      return { status: "error", message: outcome.message };
    }

    return { status: "success", message: "" };
  } catch (error) {
    if (
      error instanceof NotAuthenticatedError ||
      error instanceof MissingProfileError ||
      error instanceof DataAccessError
    ) {
      return { status: "error", message: error.message };
    }
    throw error;
  }
}

/** Starts a fresh thread. Previous conversations are retained, not deleted. */
export async function startNewConversationAction(): Promise<void> {
  await createConversation();
  revalidatePath(ROUTES.advisor);
}

/** Ensures a thread exists so the page always has somewhere to write. */
export async function ensureConversationAction(): Promise<string> {
  const existing = await getLatestConversation();
  if (existing) return existing.id;

  const created = await createConversation();
  return created.id;
}
