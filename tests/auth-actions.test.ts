import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { signUpAction } from "@/app/auth/actions";
import SignInPage from "@/app/auth/sign-in/page";
import { IDLE_FORM_STATE } from "@/lib/forms";

const auth = vi.hoisted(() => ({ signUp: vi.fn(), signOut: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

function signUpData() {
  const form = new FormData();
  form.set("email", "person@example.com");
  form.set("password", "correct-horse-battery");
  form.set("confirmPassword", "correct-horse-battery");
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.signUp.mockResolvedValue({ data: { session: {} }, error: null });
  auth.signOut.mockResolvedValue({ error: null });
});

describe("sign-up returns to manual sign-in", () => {
  it("ends the automatic local session before redirecting to sign-in", async () => {
    await expect(signUpAction(IDLE_FORM_STATE, signUpData())).rejects.toThrow(
      "REDIRECT:/auth/sign-in?signup=success",
    );
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(auth.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(redirect).mock.invocationCallOrder[0]!,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("does not put credentials in the redirect URL", async () => {
    await expect(signUpAction(IDLE_FORM_STATE, signUpData())).rejects.toThrow(
      "REDIRECT:",
    );
    expect(redirect).toHaveBeenCalledWith("/auth/sign-in?signup=success");
  });

  it("does not claim an unconfirmed account is ready to sign in", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    await expect(signUpAction(IDLE_FORM_STATE, signUpData())).rejects.toThrow(
      "REDIRECT:/auth/sign-in?signup=confirmation-required",
    );
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("preserves validation and never echoes passwords", async () => {
    const form = signUpData();
    form.set("confirmPassword", "different-password");
    const state = await signUpAction(IDLE_FORM_STATE, form);
    expect(state.status).toBe("error");
    expect("values" in state ? state.values : undefined).toEqual({
      email: "person@example.com",
    });
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("does not redirect after a rejected sign-up", async () => {
    auth.signUp.mockResolvedValue({
      data: { session: null },
      error: { message: "Unable to create account." },
    });
    const state = await signUpAction(IDLE_FORM_STATE, signUpData());
    expect(state.status).toBe("error");
    expect("values" in state ? state.values : undefined).toEqual({
      email: "person@example.com",
    });
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("does not redirect with a still-active session when sign-out fails", async () => {
    auth.signOut.mockResolvedValue({
      error: { message: "Service unavailable" },
    });
    const state = await signUpAction(IDLE_FORM_STATE, signUpData());
    expect(state.status).toBe("error");
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("sign-in feedback after sign-up", () => {
  async function render(signup?: string) {
    return renderToStaticMarkup(
      await SignInPage({
        params: Promise.resolve({}),
        searchParams: Promise.resolve(signup ? { signup } : {}),
      }),
    );
  }

  it("prompts newly created users to enter their credentials", async () => {
    const html = await render("success");
    expect(html).toContain("Account created");
    expect(html).toContain(
      "Sign in with the email and password you just chose.",
    );
    expect(html).not.toContain("Check your email");
  });

  it("shows an honest fallback when confirmation remains enabled", async () => {
    const html = await render("confirmation-required");
    expect(html).toContain("Email confirmation is still required");
    expect(html).not.toContain("Account created");
  });

  it("ignores unknown notices instead of rendering query text", async () => {
    const html = await render("untrusted-signup-notice");
    expect(html).not.toContain("untrusted-signup-notice");
    expect(html).not.toContain("Account created");
  });
});
