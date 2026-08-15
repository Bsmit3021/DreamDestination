import { redirect } from "next/navigation";

import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { getCurrentUser } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";

/**
 * Authoritative access control for /recommendations.
 *
 * Mirrors the onboarding layout: the Proxy performs an optimistic redirect on
 * the cookie, but this server-side `getUser()` is what actually enforces it.
 */
export default async function RecommendationsLayout({
  children,
}: LayoutProps<"/recommendations">) {
  const user = await getCurrentUser();

  if (!user) {
    redirect(ROUTES.signIn);
  }

  return <AuthenticatedShell email={user.email}>{children}</AuthenticatedShell>;
}
