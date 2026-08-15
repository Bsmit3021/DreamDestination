"use client";

import { useFormStatus } from "react-dom";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { FormState } from "@/lib/forms";
import { cn } from "@/lib/utils";

/**
 * Shared form feedback: field errors, form-level alerts and a submit button
 * that blocks double submission.
 */

/** Stable id for a field's error node, so inputs can point at it. */
export function errorId(field: string): string {
  return `${field}-error`;
}

export function FieldError({
  field,
  state,
}: {
  field: string;
  state: FormState;
}) {
  const messages =
    state.status === "error" ? state.fieldErrors?.[field] : undefined;

  if (!messages?.length) {
    return null;
  }

  return (
    <p id={errorId(field)} className="text-sm text-destructive">
      {messages.join(". ")}
    </p>
  );
}

/**
 * Props an input needs so assistive tech associates it with its error.
 *
 * `describedBy` is for fields that also have a hint. Both ids are merged into
 * one `aria-describedby`, because spreading this alongside a separate
 * `aria-describedby` attribute would silently drop one of them.
 */
export function fieldErrorProps(
  field: string,
  state: FormState,
  describedBy?: string,
) {
  const hasError =
    state.status === "error" && Boolean(state.fieldErrors?.[field]?.length);

  const describedByIds = [
    describedBy,
    hasError ? errorId(field) : undefined,
  ].filter((id): id is string => Boolean(id));

  return {
    "aria-invalid": hasError || undefined,
    "aria-describedby":
      describedByIds.length > 0 ? describedByIds.join(" ") : undefined,
  } as const;
}

/**
 * Form-level message. `role="alert"` so it is announced when it appears after
 * a failed submission.
 */
export function FormAlert({
  state,
  className,
}: {
  state: FormState;
  className?: string;
}) {
  if (state.status === "idle") {
    return null;
  }

  const isError = state.status === "error";
  const { message } = state;

  // A validation-only failure is already reported beside each field.
  if (!message) {
    return null;
  }

  return (
    <Alert
      role="alert"
      className={cn(
        isError
          ? "border-destructive/40 text-destructive"
          : "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
        className,
      )}
    >
      <AlertDescription
        className={
          isError
            ? "text-destructive"
            : "text-emerald-700 dark:text-emerald-400"
        }
      >
        {message}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Submit button wired to the enclosing form's pending state.
 *
 * Disabled while the action runs, which is what prevents a second submission
 * creating a duplicate write.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      aria-busy={pending}
      className={className}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}
