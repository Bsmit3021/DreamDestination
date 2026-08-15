"use client";

import { useActionState } from "react";

import { generateRecommendationsAction } from "@/app/recommendations/actions";
import { FormAlert, SubmitButton } from "@/components/forms/form-feedback";
import { IDLE_FORM_STATE } from "@/lib/forms";

/**
 * Triggers a scoring run for the signed-in user.
 *
 * Sends no payload at all — the server derives the profile from the session, so
 * there is nothing here a caller could tamper with. The submit button disables
 * itself while the action runs, which prevents a double run racing on the
 * unique (profile_id, rank) constraint.
 */
export function GenerateButton({ hasExisting }: { hasExisting: boolean }) {
  const [state, formAction] = useActionState(
    generateRecommendationsAction,
    IDLE_FORM_STATE,
  );

  return (
    <div className="flex flex-col gap-3">
      <FormAlert state={state} />
      <form action={formAction}>
        <SubmitButton pendingLabel="Scoring cities…">
          {hasExisting ? "Regenerate matches" : "Find my matches"}
        </SubmitButton>
      </form>
    </div>
  );
}
