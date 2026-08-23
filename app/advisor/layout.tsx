import { redirect } from "next/navigation";

import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { getCurrentUser } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";

/**
 * Authoritative access control for /advisor.
 *
 * Mirrors the onboarding and recommendations layouts: the Proxy performs an
 * optimistic cookie check, this verifies the token with Supabase Auth.
 */
export default async function AdvisorLayout({
  children,
}: LayoutProps<"/advisor">) {
  const user = await getCurrentUser();
  if (!user) redirect(ROUTES.signIn);

  return <AuthenticatedShell email={user.email}>{children}</AuthenticatedShell>;
}
