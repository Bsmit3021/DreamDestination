"use client";

import { useActionState } from "react";

import { saveProfileAction } from "@/app/onboarding/actions";
import {
  FieldError,
  FormAlert,
  SubmitButton,
  fieldErrorProps,
} from "@/components/forms/form-feedback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  AGE_RANGES,
  FREE_TEXT_GOALS_MAX_LENGTH,
  RELATIONSHIP_STATUSES,
  US_STATE_CODES,
  WORK_PREFERENCES,
} from "@/lib/constants";
import { IDLE_FORM_STATE, valueFor } from "@/lib/forms";
import {
  AGE_RANGE_LABELS,
  RELATIONSHIP_STATUS_LABELS,
  WORK_PREFERENCE_LABELS,
} from "@/lib/labels";
import type { Profile } from "@/types/profile";

/**
 * Profile step.
 *
 * Every field is pre-populated from `profile` when one exists, so this doubles
 * as the edit form. Submitting always upserts, so re-saving updates the single
 * row rather than creating another.
 */
export function ProfileForm({ profile }: { profile: Profile | null }) {
  const [state, formAction] = useActionState(
    saveProfileAction,
    IDLE_FORM_STATE,
  );
  const isEdit = profile !== null;

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <FormAlert state={state} />

      {/* Tells the action whether to continue the flow or return to the summary. */}
      <input type="hidden" name="mode" value={isEdit ? "edit" : "create"} />

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ageRange">Age range</Label>
          <NativeSelect
            id="ageRange"
            name="ageRange"
            defaultValue={valueFor(state, "ageRange", profile?.ageRange)}
            required
            {...fieldErrorProps("ageRange", state)}
          >
            <option value="" disabled>
              Select…
            </option>
            {AGE_RANGES.map((value) => (
              <option key={value} value={value}>
                {AGE_RANGE_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
          <FieldError field="ageRange" state={state} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="relationshipStatus">Relationship status</Label>
          <NativeSelect
            id="relationshipStatus"
            name="relationshipStatus"
            defaultValue={valueFor(
              state,
              "relationshipStatus",
              profile?.relationshipStatus,
            )}
            required
            {...fieldErrorProps("relationshipStatus", state)}
          >
            <option value="" disabled>
              Select…
            </option>
            {RELATIONSHIP_STATUSES.map((value) => (
              <option key={value} value={value}>
                {RELATIONSHIP_STATUS_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
          <FieldError field="relationshipStatus" state={state} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="householdSize">Household size</Label>
          <Input
            id="householdSize"
            name="householdSize"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            defaultValue={valueFor(
              state,
              "householdSize",
              profile?.householdSize,
            )}
            required
            {...fieldErrorProps("householdSize", state, "householdSize-hint")}
          />
          <p id="householdSize-hint" className="text-xs text-muted-foreground">
            Everyone who would move with you, including yourself.
          </p>
          <FieldError field="householdSize" state={state} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="children">Children</Label>
          <Input
            id="children"
            name="children"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            defaultValue={valueFor(state, "children", profile?.children ?? 0)}
            required
            {...fieldErrorProps("children", state)}
          />
          <FieldError field="children" state={state} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="householdIncome">Annual household income (USD)</Label>
          <Input
            id="householdIncome"
            name="householdIncome"
            type="number"
            inputMode="decimal"
            min={0}
            step={1000}
            defaultValue={valueFor(
              state,
              "householdIncome",
              profile?.householdIncome,
            )}
            required
            {...fieldErrorProps("householdIncome", state)}
          />
          <FieldError field="householdIncome" state={state} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="housingBudget">Monthly housing budget (USD)</Label>
          <Input
            id="housingBudget"
            name="housingBudget"
            type="number"
            inputMode="decimal"
            min={0}
            step={50}
            defaultValue={valueFor(
              state,
              "housingBudget",
              profile?.housingBudget,
            )}
            required
            {...fieldErrorProps("housingBudget", state)}
          />
          <FieldError field="housingBudget" state={state} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="occupation">Occupation</Label>
          <Input
            id="occupation"
            name="occupation"
            type="text"
            autoComplete="organization-title"
            maxLength={120}
            defaultValue={valueFor(state, "occupation", profile?.occupation)}
            required
            {...fieldErrorProps("occupation", state)}
          />
          <FieldError field="occupation" state={state} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="workPreference">Work preference</Label>
          <NativeSelect
            id="workPreference"
            name="workPreference"
            defaultValue={valueFor(
              state,
              "workPreference",
              profile?.workPreference,
            )}
            required
            {...fieldErrorProps("workPreference", state)}
          >
            <option value="" disabled>
              Select…
            </option>
            {WORK_PREFERENCES.map((value) => (
              <option key={value} value={value}>
                {WORK_PREFERENCE_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
          <FieldError field="workPreference" state={state} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="currentCity">Current city</Label>
          <Input
            id="currentCity"
            name="currentCity"
            type="text"
            autoComplete="address-level2"
            maxLength={120}
            defaultValue={valueFor(state, "currentCity", profile?.currentCity)}
            required
            {...fieldErrorProps("currentCity", state)}
          />
          <FieldError field="currentCity" state={state} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="currentState">Current state</Label>
          <NativeSelect
            id="currentState"
            name="currentState"
            autoComplete="address-level1"
            defaultValue={valueFor(
              state,
              "currentState",
              profile?.currentState,
            )}
            required
            {...fieldErrorProps("currentState", state)}
          >
            <option value="" disabled>
              Select…
            </option>
            {US_STATE_CODES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </NativeSelect>
          <FieldError field="currentState" state={state} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="freeTextGoals">
          What are you hoping to get out of a move?{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="freeTextGoals"
          name="freeTextGoals"
          rows={4}
          maxLength={FREE_TEXT_GOALS_MAX_LENGTH}
          defaultValue={valueFor(
            state,
            "freeTextGoals",
            profile?.freeTextGoals,
          )}
          {...fieldErrorProps("freeTextGoals", state)}
        />
        <FieldError field="freeTextGoals" state={state} />
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Saving…">
          {isEdit ? "Save changes" : "Continue"}
        </SubmitButton>
      </div>
    </form>
  );
}
