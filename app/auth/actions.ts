"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { type FormState, collectValues, validationFailed } from "@/lib/forms";
import { ROUTES, safeRedirectPath } from "@/lib/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signInSchema, signUpSchema } from "@/lib/validation/auth";

/**
 * Authentication mutations.
 *
 * `redirect()` works by throwing a control-flow signal, so every call sits
 * outside the try/catch that handles Supabase errors. Catching it would turn a
 * successful navigation into a generic failure message.
 */

export async function signUpAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  // Email only: a password must never be echoed back into the HTML.
  const echoed = collectValues(formData, ["email"]);

  if (!parsed.success) {
    return validationFailed(parsed.error, echoed);
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { status: "error", message: error.message, values: echoed };
  }

  // With email confirmation enabled there is no session yet, and the user must
  // confirm before signing in. Locally confirmation is off and a session comes
  // back immediately. Handle both rather than assuming one.
  if (!data.session) {
    return {
      status: "success",
      message:
        "Account created. Check your email for a confirmation link, then sign in.",
    };
  }

  revalidatePath("/", "layout");
  redirect(ROUTES.onboarding);
}

export async function signInAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  const echoed = collectValues(formData, ["email"]);

  if (!parsed.success) {
    return validationFailed(parsed.error, echoed);
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Deliberately generic: distinguishing "no such account" from "wrong
    // password" would let anyone enumerate registered email addresses.
    return {
      status: "error",
      message: "Invalid email or password.",
      values: echoed,
    };
  }

  const redirectTo = safeRedirectPath(
    typeof formData.get("redirectTo") === "string"
      ? String(formData.get("redirectTo"))
      : null,
  );

  revalidatePath("/", "layout");
  redirect(redirectTo);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect(ROUTES.home);
}
