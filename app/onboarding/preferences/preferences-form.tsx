"use client";

import { useActionState, useState } from "react";

import { savePreferencesAction } from "@/app/onboarding/actions";
import {
  FieldError,
  FormAlert,
  SubmitButton,
} from "@/components/forms/form-feedback";
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

/** Neutral starting point when the user has not set anything yet. */
const DEFAULT_WEIGHT = 0.5;

function formatWeight(value: number): string {
  return `${Math.round(value * 100)}%`;
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
    () =>
      savedWeights ??
      (Object.fromEntries(
        PREFERENCE_WEIGHT_KEYS.map((key) => [key, DEFAULT_WEIGHT]),
      ) as PreferenceWeights),
  );

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
                onChange={(event) =>
                  setWeights((current) => ({
                    ...current,
                    [key]: Number(event.target.value),
                  }))
                }
                className="mt-auto h-6 w-full cursor-pointer accent-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />

              <FieldError field={key} state={state} />
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Save priorities</SubmitButton>
      </div>
    </form>
  );
}
