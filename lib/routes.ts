/**
 * Route constants and the single definition of which routes require auth.
 *
 * Both the Proxy (optimistic redirect) and the protected layout (authoritative
 * check) read from here, so the two can never disagree about what is
 * protected.
 */

export const ROUTES = {
  home: "/",
  signIn: "/auth/sign-in",
  signUp: "/auth/sign-up",
  onboarding: "/onboarding",
  onboardingProfile: "/onboarding/profile",
  onboardingPreferences: "/onboarding/preferences",
  onboardingOccupation: "/onboarding/occupation",
  recommendations: "/recommendations",
} as const;

/** Prefixes that require an authenticated user. */
const PROTECTED_PREFIXES = [ROUTES.onboarding, ROUTES.recommendations] as const;

/** Pages that a signed-in user has no reason to see. */
const AUTH_PREFIXES = [ROUTES.signIn, ROUTES.signUp] as const;

function matches(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isProtectedRoute(pathname: string): boolean {
  return matches(pathname, PROTECTED_PREFIXES);
}

export function isAuthRoute(pathname: string): boolean {
  return matches(pathname, AUTH_PREFIXES);
}

/**
 * Where a request should be sent, given who is making it, or `null` to let it
 * through.
 *
 * Pure and free of Next.js types so the redirect rules can be tested directly
 * rather than through a mocked request pipeline. The Proxy applies the result;
 * the protected layout enforces the same rule authoritatively.
 */
export function resolveAuthRedirect({
  pathname,
  isAuthenticated,
}: {
  pathname: string;
  isAuthenticated: boolean;
}): string | null {
  if (!isAuthenticated && isProtectedRoute(pathname)) {
    return ROUTES.signIn;
  }

  if (isAuthenticated && isAuthRoute(pathname)) {
    return ROUTES.onboarding;
  }

  return null;
}

/**
 * Constrains a post-sign-in redirect to a path inside this app.
 *
 * Without this, `?redirectTo=https://evil.example` would turn the sign-in form
 * into an open redirect. Only root-relative single-slash paths are accepted.
 */
export function safeRedirectPath(
  value: string | null | undefined,
  fallback: string = ROUTES.onboarding,
): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  // Reject protocol-relative ("//host") and backslash-smuggled variants.
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
