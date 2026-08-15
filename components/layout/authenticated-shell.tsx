import Link from "next/link";

import { signOutAction } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ROUTES } from "@/lib/routes";

/**
 * Common chrome for signed-in pages: wordmark, current account, sign out.
 *
 * Shared by the onboarding and recommendations layouts so the two cannot drift
 * apart. It renders chrome only — each layout still performs its own
 * server-side authentication check.
 */
export function AuthenticatedShell({
  email,
  children,
}: {
  email: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={ROUTES.onboarding}
          className="font-heading text-xl font-semibold tracking-tight"
        >
          DreamDestination
        </Link>

        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{email}</span>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      <Separator />

      {children}
    </div>
  );
}
