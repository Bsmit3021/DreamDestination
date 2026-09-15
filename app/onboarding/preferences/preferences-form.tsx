"use client";

import { useActionState, useState } from "react";

import { savePreferencesAction } from "@/app/onboarding/actions";
import {
  FieldError,
  FormAlert,
  SubmitButton,
} from "@/components/forms/form-feedback";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  NORMALIZED_MAX,
  NORMALIZED_MIN,
  PREFERENCE_WEIGHT_KEYS,
} from "@/lib/constants";
import { IDLE_FORM_STATE } from "@/lib/forms";
import { PREFERENCE_LABELS } from "@/lib/labels";
import type { PreferenceWeights } from "@/types/profile";

/** Granularity of the sliders. The database column holds three decimals. */
const WEIGHT_STEP = 0.05;

/**
 * Neutral starting point when the user has not set anything yet, and the value
 * "Reset to equal importance" restores.
 */
const DEFAULT_WEIGHT = 0.5;

const RESET_HINT_ID = "reset-weights-hint";

function formatWeight(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Every slider at the same value: equal importance, chosen explicitly. */
function equalWeights(): PreferenceWeights {
  return Object.fromEntries(
    PREFERENCE_WEIGHT_KEYS.map((key) => [key, DEFAULT_WEIGHT]),
  ) as PreferenceWeights;
}

/**
 * Preferences step.
 *
 * Native range inputs, so each slider submits its own value with the form and
 * is keyboard- and screen-reader-accessible without extra wiring. React state
 * exists only to render the live percentage next to each label.
 */
export function PreferencesForm({
  weights: savedWeights,
}: {
  weights: PreferenceWeights | null;
}) {
  const [state, formAction] = useActionState(
    savePreferencesAction,
    IDLE_FORM_STATE,
  );

  const [weights, setWeights] = useState<PreferenceWeights>(
    () => savedWeights ?? equalWeights(),
  );

  // Announced once after a reset, and cleared as soon as a slider moves again,
  // so it never describes values that are no longer on screen.
  const [resetMessage, setResetMessage] = useState("");

  // Only updates the sliders. Nothing is saved until the form is submitted.
  function resetToEqualImportance() {
    setWeights(equalWeights());
    setResetMessage(
      `Every priority is now set to ${formatWeight(DEFAULT_WEIGHT)}. Save priorities to keep this choice.`,
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <FormAlert state={state} />

      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {PREFERENCE_WEIGHT_KEYS.map((key) => {
          const { label, description } = PREFERENCE_LABELS[key];
          const descriptionId = `${key}-description`;

          return (
            <li
              key={key}
              className="flex min-w-0 flex-col gap-3 rounded-lg border p-4"
            >
              <div className="flex items-baseline justify-between gap-4">
                <Label htmlFor={key}>{label}</Label>
                <span
                  className="text-sm text-muted-foreground tabular-nums"
                  aria-hidden="true"
                >
                  {formatWeight(weights[key])}
                </span>
              </div>

              <p id={descriptionId} className="text-sm text-muted-foreground">
                {description}
              </p>

              <input
                id={key}
                name={key}
                type="range"
                min={NORMALIZED_MIN}
                max={NORMALIZED_MAX}
                step={WEIGHT_STEP}
                value={weights[key]}
                aria-describedby={descriptionId}
                aria-valuetext={formatWeight(weights[key])}
                onChange={(event) => {
                  setWeights((current) => ({
                    ...current,
                    [key]: Number(event.target.value),
                  }));
                  setResetMessage("");
                }}
                className="mt-auto h-6 w-full cursor-pointer accent-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />

              <FieldError field={key} state={state} />
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Saving…">Save priorities</SubmitButton>
          <Button
            type="button"
            variant="outline"
            size="lg"
            aria-describedby={RESET_HINT_ID}
            onClick={resetToEqualImportance}
          >
            Reset to equal importance
          </Button>
        </div>
        <p id={RESET_HINT_ID} className="text-sm text-muted-foreground">
          Equal importance sets every slider to the same value, so no priority
          counts more than another. Nothing is saved until you choose Save
          priorities.
        </p>
        <p role="status" className="text-sm text-muted-foreground">
          {resetMessage}
        </p>
      </div>
    </form>
  );
}
