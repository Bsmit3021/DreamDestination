"use client";

import { useActionState } from "react";

import { signInAction } from "@/app/auth/actions";
import {
  FieldError,
  FormAlert,
  SubmitButton,
  fieldErrorProps,
} from "@/components/forms/form-feedback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IDLE_FORM_STATE, valueFor } from "@/lib/forms";

export function SignInForm({ redirectTo }: { redirectTo: string }) {
  const [state, formAction] = useActionState(signInAction, IDLE_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormAlert state={state} />

      <input type="hidden" name="redirectTo" value={redirectTo} />

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
          autoComplete="current-password"
          required
          {...fieldErrorProps("password", state)}
        />
        <FieldError field="password" state={state} />
      </div>

      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
