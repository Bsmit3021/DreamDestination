import { Check, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthenticatedShell } from "@/components/layout/authenticated-shell";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/session";
import { getOnboardingStatus } from "@/lib/data/preferences";
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

  const { hasProfile, hasPreferences } = await getOnboardingStatus();
  const complete = hasProfile && hasPreferences;

  return (
    <AuthenticatedShell email={user.email}>
      <div className="flex flex-col gap-6">
        {!complete && (
          <section
            aria-label="Setup progress"
            className="rounded-xl border bg-card p-5"
          >
            <p className="mb-4 text-sm font-medium">
              Two steps to your first matches
            </p>
            <ol className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  label: "Your profile",
                  href: ROUTES.onboardingProfile,
                  done: hasProfile,
                },
                {
                  label: "Your priorities",
                  href: ROUTES.onboardingPreferences,
                  done: hasPreferences,
                },
              ].map((step, index) => (
                <li key={step.href}>
                  <Link
                    href={step.href}
                    className="flex items-center gap-3 rounded-lg bg-muted/50 p-3 text-sm hover:bg-muted"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      {step.done ? (
                        <Check aria-hidden="true" className="size-4" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span className="font-medium">{step.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {step.done ? "Complete" : "To do"}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        )}
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,48rem)_minmax(14rem,1fr)]">
          <div className="w-full max-w-3xl min-w-0">{children}</div>
          <aside className="max-w-sm space-y-4 rounded-xl border bg-card p-5 xl:sticky xl:top-6">
            <SlidersHorizontal
              aria-hidden="true"
              className="size-5 text-primary"
            />
            <h2 className="font-semibold">
              {complete
                ? "Keep your research current"
                : "Start with what matters to you"}
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Your profile describes your circumstances. Your priorities control
              how much each measured factor contributes to your city matches.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Confirming your occupation adds a more specific career comparison.
              You can revisit any of these inputs whenever your plans change.
            </p>
            {complete && (
              <>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  After saving changes, regenerate your matches to apply your
                  updated inputs. Existing results remain a snapshot until you
                  do.
                </p>
                <Button variant="outline" asChild>
                  <Link href={ROUTES.recommendations}>Go to your matches</Link>
                </Button>
              </>
            )}
          </aside>
        </div>
      </div>
    </AuthenticatedShell>
  );
}
