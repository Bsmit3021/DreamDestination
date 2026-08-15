import type { z } from "zod";

/**
 * The shape every server action returns to `useActionState`.
 *
 * One shape for all forms means the error-rendering markup is identical
 * everywhere and a new form cannot invent its own convention.
 */

/** Field name -> messages. Keys match the Zod schema's field names. */
export type FieldErrors = Record<string, string[] | undefined>;

/**
 * Values echoed back so a rejected submission can be re-rendered.
 *
 * React 19 resets uncontrolled inputs once a form action settles, which would
 * otherwise wipe an eleven-field profile form on a single validation error.
 * Passwords are deliberately never placed in here.
 */
export type SubmittedValues = Record<string, string>;

export type FormState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | {
      status: "error";
      /** Shown above the form: auth failures, database errors. */
      message?: string;
      /** Shown beneath the offending input. */
      fieldErrors?: FieldErrors;
      /** Re-populates the form so the user does not retype everything. */
      values?: SubmittedValues;
    };

export const IDLE_FORM_STATE: FormState = { status: "idle" };

/** Groups a Zod error into the per-field shape the forms render. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};

  for (const issue of error.issues) {
    // Issues with an empty path are form-level (e.g. a cross-field refine
    // without an explicit path); bucket them under a reserved key.
    const key = issue.path.length > 0 ? issue.path.join(".") : "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }

  return fieldErrors;
}

/** Convenience constructor for a validation failure. */
export function validationFailed(
  error: z.ZodError,
  values?: SubmittedValues,
): FormState {
  return {
    status: "error",
    message: "Please correct the highlighted fields.",
    fieldErrors: toFieldErrors(error),
    values,
  };
}

/**
 * Collects the named fields as strings, for echoing back on failure.
 *
 * Only pass field names that are safe to re-render. Never pass a password.
 */
export function collectValues(
  formData: FormData,
  keys: readonly string[],
): SubmittedValues {
  const values: SubmittedValues = {};

  for (const key of keys) {
    const value = formData.get(key);
    if (typeof value === "string") {
      values[key] = value;
    }
  }

  return values;
}

/** Reads an echoed-back value, falling back to a saved or empty default. */
export function valueFor(
  state: FormState,
  key: string,
  fallback: string | number | null | undefined,
): string | number {
  if (state.status === "error" && state.values?.[key] !== undefined) {
    return state.values[key];
  }

  return fallback ?? "";
}

/**
 * FormData readers.
 *
 * Everything in a FormData is a string or a File. These normalise values into
 * the shapes the domain schemas expect, without repeating any validation rule:
 * a missing or unparseable value becomes `undefined`, and Zod produces the
 * error message.
 */

export function formString(
  formData: FormData,
  key: string,
): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

/** Trims, and maps an empty string to null for nullable text columns. */
export function formNullableString(
  formData: FormData,
  key: string,
): string | null {
  const value = formString(formData, key)?.trim();
  return value ? value : null;
}

/**
 * Returns `undefined` rather than `NaN` for blank or non-numeric input, so the
 * resulting Zod issue reads as a missing field instead of a type error.
 */
export function formNumber(
  formData: FormData,
  key: string,
): number | undefined {
  const raw = formString(formData, key)?.trim();

  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}
