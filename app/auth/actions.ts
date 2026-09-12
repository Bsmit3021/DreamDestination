"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { type FormState, collectValues, validationFailed } from "@/lib/forms";
import { ROUTES, safeRedirectPath } from "@/lib/routes";
import { absoluteUrl } from "@/lib/site-url";
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
    options: {
      // Hosted Supabase enables email confirmation by default, unlike the
      // local config. Stating the destination explicitly means the link works
      // the same way on production and on a preview deployment, instead of
      // depending on whichever Site URL the project happens to carry.
      emailRedirectTo: absoluteUrl(ROUTES.onboarding),
    },
  });

  if (error) {
    return { status: "error", message: error.message, values: echoed };
  }

  // With email confirmation enabled there is no session yet, and the user must
  // confirm before signing in. Otherwise, end the automatic session so the user
  // can sign in manually. Handle both rather than assuming one.
  if (data.session) {
    const { error: signOutError } = await supabase.auth.signOut({
      scope: "local",
    });
    if (signOutError) {
      return {
        status: "error",
        message:
          "Your account was created, but we could not end the automatic session. Reload the page to continue.",
        values: echoed,
      };
    }
  }

  revalidatePath("/", "layout");
  redirect(
    `${ROUTES.signIn}?signup=${data.session ? "success" : "confirmation-required"}`,
  );
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
