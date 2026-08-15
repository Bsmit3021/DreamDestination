import { describe, expect, it } from "vitest";

import {
  ROUTES,
  isAuthRoute,
  isProtectedRoute,
  resolveAuthRedirect,
  safeRedirectPath,
} from "@/lib/routes";

describe("isProtectedRoute", () => {
  it.each([
    "/onboarding",
    "/onboarding/profile",
    "/onboarding/preferences",
    "/onboarding/anything/deeper",
  ])("treats %s as protected", (pathname) => {
    expect(isProtectedRoute(pathname)).toBe(true);
  });

  it.each(["/", "/auth/sign-in", "/auth/sign-up"])(
    "treats %s as public",
    (pathname) => {
      expect(isProtectedRoute(pathname)).toBe(false);
    },
  );

  it("does not treat a lookalike prefix as protected", () => {
    // "/onboarding-public" starts with "/onboarding" as a string but is a
    // different route; matching must be segment-aware.
    expect(isProtectedRoute("/onboarding-public")).toBe(false);
  });
});

describe("isAuthRoute", () => {
  it.each(["/auth/sign-in", "/auth/sign-up"])(
    "treats %s as an auth page",
    (pathname) => {
      expect(isAuthRoute(pathname)).toBe(true);
    },
  );

  it.each(["/", "/onboarding"])("treats %s as not an auth page", (pathname) => {
    expect(isAuthRoute(pathname)).toBe(false);
  });
});

describe("resolveAuthRedirect", () => {
  it("sends an unauthenticated visitor away from onboarding", () => {
    expect(
      resolveAuthRedirect({
        pathname: "/onboarding/profile",
        isAuthenticated: false,
      }),
    ).toBe(ROUTES.signIn);
  });

  it("sends an unauthenticated visitor away from every onboarding child", () => {
    for (const pathname of [
      ROUTES.onboarding,
      ROUTES.onboardingProfile,
      ROUTES.onboardingPreferences,
    ]) {
      expect(resolveAuthRedirect({ pathname, isAuthenticated: false })).toBe(
        ROUTES.signIn,
      );
    }
  });

  it("lets an authenticated user into onboarding", () => {
    expect(
      resolveAuthRedirect({
        pathname: "/onboarding/preferences",
        isAuthenticated: true,
      }),
    ).toBeNull();
  });

  it("moves an authenticated user off the auth pages", () => {
    expect(
      resolveAuthRedirect({ pathname: "/auth/sign-in", isAuthenticated: true }),
    ).toBe(ROUTES.onboarding);
  });

  it("leaves public pages alone for everyone", () => {
    expect(
      resolveAuthRedirect({ pathname: "/", isAuthenticated: false }),
    ).toBeNull();
    expect(
      resolveAuthRedirect({ pathname: "/", isAuthenticated: true }),
    ).toBeNull();
  });

  it("lets an unauthenticated visitor reach the auth pages", () => {
    expect(
      resolveAuthRedirect({
        pathname: "/auth/sign-up",
        isAuthenticated: false,
      }),
    ).toBeNull();
  });
});

describe("safeRedirectPath", () => {
  it("keeps an in-app path", () => {
    expect(safeRedirectPath("/onboarding/profile")).toBe("/onboarding/profile");
  });

  it.each([
    ["absolute http url", "https://evil.example/steal"],
    ["protocol-relative url", "//evil.example"],
    ["backslash smuggling", "/\\evil.example"],
    ["scheme without slashes", "javascript:alert(1)"],
    ["empty string", ""],
  ])("falls back for an off-site target (%s)", (_label, value) => {
    expect(safeRedirectPath(value)).toBe(ROUTES.onboarding);
  });

  it("falls back when absent", () => {
    expect(safeRedirectPath(null)).toBe(ROUTES.onboarding);
    expect(safeRedirectPath(undefined)).toBe(ROUTES.onboarding);
  });

  it("honours an explicit fallback", () => {
    expect(safeRedirectPath(null, ROUTES.home)).toBe(ROUTES.home);
  });
});
