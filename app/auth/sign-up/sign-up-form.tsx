"use client";

import { useActionState } from "react";

import { signUpAction } from "@/app/auth/actions";
import {
  FieldError,
  FormAlert,
  SubmitButton,
  fieldErrorProps,
} from "@/components/forms/form-feedback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IDLE_FORM_STATE, valueFor } from "@/lib/forms";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/auth";

export function SignUpForm() {
  const [state, formAction] = useActionState(signUpAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormAlert state={state} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={valueFor(state, "email", "")}
          required
          {...fieldErrorProps("email", state)}
        />
        <FieldError field="email" state={state} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          {...fieldErrorProps("password", state, "password-hint")}
        />
        <p id="password-hint" className="text-xs text-muted-foreground">
          At least {PASSWORD_MIN_LENGTH} characters.
        </p>
        <FieldError field="password" state={state} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          {...fieldErrorProps("confirmPassword", state)}
        />
        <FieldError field="confirmPassword" state={state} />
      </div>

      <SubmitButton pendingLabel="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}
