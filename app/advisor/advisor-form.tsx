"use client";

import { useActionState } from "react";

import { askAdvisorAction } from "@/app/advisor/actions";
import { FormAlert, SubmitButton } from "@/components/forms/form-feedback";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IDLE_FORM_STATE } from "@/lib/forms";

/**
 * Question input.
 *
 * Suggested questions fill the textarea rather than submitting directly, so
 * the user can edit before sending and nothing is asked without an explicit
 * action.
 */
export function AdvisorForm({
  conversationId,
  suggestions,
  maxLength,
}: {
  conversationId: string;
  suggestions: string[];
  maxLength: number;
}) {
  const [state, formAction] = useActionState(askAdvisorAction, IDLE_FORM_STATE);

  return (
    <div className="flex flex-col gap-4">
      <FormAlert state={state} />

      {suggestions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Suggested questions</h2>
          <ul className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion}>
                <button
                  type="button"
                  className="rounded-full border border-border px-3 py-1.5 text-left text-xs hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={() => {
                    const field =
                      document.querySelector<HTMLTextAreaElement>("#question");
                    if (field) {
                      field.value = suggestion;
                      field.focus();
                    }
                  }}
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="conversationId" value={conversationId} />

        <div className="flex flex-col gap-2">
          <Label htmlFor="question">Ask about your matches</Label>
          <Textarea
            id="question"
            name="question"
            rows={3}
            maxLength={maxLength}
            required
            placeholder="Why did my top city rank first?"
            aria-describedby="question-hint"
          />
          <p id="question-hint" className="text-xs text-muted-foreground">
            Answers use your current DreamDestination results only.
          </p>
        </div>

        <div>
          <SubmitButton pendingLabel="Thinking…">Ask</SubmitButton>
        </div>
      </form>
    </div>
  );
}
