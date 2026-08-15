import { redirect } from "next/navigation";

import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { getCurrentUser } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";

/**
 * Authoritative access control for everything under /onboarding.
 *
 * The Proxy already redirects unauthenticated visitors, but that is an
 * optimistic check on a cookie. This runs `getUser()`, which verifies the token
 * with Supabase Auth, and it runs on the server for every render of every child
 * route — so a forged or stale cookie cannot get past it.
 */
export default async function OnboardingLayout({
  children,
}: LayoutProps<"/onboarding">) {
  const user = await getCurrentUser();

  if (!user) {
    redirect(ROUTES.signIn);
  }

  return <AuthenticatedShell email={user.email}>{children}</AuthenticatedShell>;
}
