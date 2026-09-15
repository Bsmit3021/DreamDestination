"use client";

import { useActionState } from "react";

import { confirmOccupationAction } from "@/app/onboarding/occupation/actions";
import { FormAlert, SubmitButton } from "@/components/forms/form-feedback";
import { Label } from "@/components/ui/label";
import { IDLE_FORM_STATE } from "@/lib/forms";

export interface OccupationChoice {
  socCode: string;
  title: string;
  matchedTitle: string;
  confidence: number;
  matchType: string;
}

/**
 * Occupation confirmation.
 *
 * Shown when the deterministic resolver is not confident enough to decide on
 * its own. Radio buttons rather than a dropdown so every candidate — and the
 * title that caused each match — is visible without interaction.
 */
export function OccupationForm({
  sourceText,
  candidates,
  selectedSocCode,
}: {
  sourceText: string;
  candidates: OccupationChoice[];
  selectedSocCode: string | null;
}) {
  const [state, formAction] = useActionState(
    confirmOccupationAction,
    IDLE_FORM_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormAlert state={state} />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm text-muted-foreground">
          You entered{" "}
          <span className="font-medium text-foreground">{sourceText}</span>.
          Which of these best describes your work?
        </legend>

        {candidates.map((candidate, index) => (
          <div
            key={candidate.socCode}
            className="flex items-start gap-3 rounded-lg border p-4 has-checked:border-primary has-checked:bg-primary/5"
          >
            <input
              type="radio"
              id={`soc-${candidate.socCode}`}
              name="socCode"
              value={candidate.socCode}
              defaultChecked={
                selectedSocCode
                  ? candidate.socCode === selectedSocCode
                  : index === 0
              }
              className="mt-1 size-4 accent-primary"
            />
            <Label
              htmlFor={`soc-${candidate.socCode}`}
              className="flex flex-col gap-0.5 font-normal"
            >
              <span className="font-medium">{candidate.title}</span>
              <span className="text-xs text-muted-foreground">
                SOC {candidate.socCode} · matched on &ldquo;
                {candidate.matchedTitle}&rdquo;
              </span>
            </Label>
          </div>
        ))}
      </fieldset>

      <div>
        <SubmitButton pendingLabel="Saving…">Confirm occupation</SubmitButton>
      </div>
    </form>
  );
}
