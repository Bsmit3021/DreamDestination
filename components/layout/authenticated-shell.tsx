import { Compass } from "lucide-react";
import Link from "next/link";

import { signOutAction } from "@/app/auth/actions";
import {
  AppNavigation,
  WorkspaceLocation,
} from "@/components/layout/app-navigation";
import { Button } from "@/components/ui/button";
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
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-background p-3 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh flex-col gap-10 overflow-y-auto border-r bg-sidebar px-4 py-7 lg:flex">
        <Link
          href={ROUTES.onboarding}
          className="flex items-center gap-2 px-2 text-base font-semibold tracking-tight"
        >
          <Compass
            aria-hidden="true"
            className="size-5 shrink-0 text-primary"
          />
          DreamDestination
        </Link>
        <AppNavigation />
        <div className="mt-auto border-t px-3 pt-5 text-xs leading-relaxed text-muted-foreground">
          <p className="mb-1 font-medium text-foreground">
            A more informed move.
          </p>
          Compare places through the priorities that matter to you.
        </div>
      </aside>
      <div className="min-w-0">
        <header className="border-b bg-background">
          <div className="mx-auto flex min-h-20 max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-10">
            <Link
              href={ROUTES.onboarding}
              className="font-semibold tracking-tight lg:hidden"
            >
              DreamDestination
            </Link>
            <div className="hidden items-center gap-2 text-sm lg:flex">
              <span className="text-muted-foreground">Workspace</span>
              <span aria-hidden="true" className="text-muted-foreground">
                /
              </span>
              <WorkspaceLocation />
            </div>
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="hidden max-w-64 truncate text-sm text-muted-foreground sm:block"
                title={email}
              >
                {email}
              </span>
              <form action={signOutAction}>
                <Button type="submit" variant="outline" size="sm">
                  Sign out
                </Button>
              </form>
            </div>
          </div>
          <AppNavigation mobile />
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-7 sm:px-6 lg:px-10 lg:py-10"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
