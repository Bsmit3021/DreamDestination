import { ArrowRight, Briefcase, Compass, Home, Users } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/session";
import { ROUTES } from "@/lib/routes";

const PILLARS = [
  {
    icon: Home,
    title: "Personalized city recommendations",
    description:
      "Ranked places to live, weighted by what actually matters to you rather than a generic best-places list.",
  },
  {
    icon: Briefcase,
    title: "Career and housing compatibility",
    description:
      "Whether your work travels with you, and whether the housing you want is within the budget you have.",
  },
  {
    icon: Users,
    title: "Family and lifestyle considerations",
    description:
      "Schools, healthcare, commute and community, considered together instead of one metric at a time.",
  },
] as const;

export default async function HomePage() {
  const user = await getCurrentUser();
  const destination = user ? ROUTES.onboarding : ROUTES.signUp;

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-background p-3 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <header className="border-b bg-background">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8"
        >
          {/* "DreamDestination" is a single unbreakable word, so it needs a
              smaller base size and an explicit break rule to avoid overflowing
              very narrow viewports. */}
          <Link
            href={ROUTES.home}
            className="flex items-center gap-2 font-heading text-lg font-semibold tracking-tight break-words sm:text-xl"
          >
            <Compass
              aria-hidden="true"
              className="size-6 shrink-0 text-primary"
            />
            DreamDestination
          </Link>
          <div className="flex flex-wrap items-center gap-3 sm:gap-5">
            <a
              href="#how-it-works"
              className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline"
            >
              How it works
            </a>
            {!user && (
              <Link href={ROUTES.signIn} className="text-sm font-medium">
                Sign in
              </Link>
            )}
            <Button size="sm" asChild>
              <Link href={destination}>
                {user ? "Open workspace" : "Get started"}
              </Link>
            </Button>
          </div>
        </nav>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-[1360px] flex-1 px-5 sm:px-8"
      >
        <section className="grid items-center gap-12 py-16 md:py-24 lg:grid-cols-[1.2fr_1fr] lg:gap-20">
          <div className="max-w-2xl space-y-7">
            <p className="text-xs font-medium tracking-widest text-primary uppercase">
              A more informed move
            </p>
            <h1 className="font-heading text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Find the place that fits the life you want.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
              A new city is more than a change of address. Compare U.S. metros
              through your career, budget, and priorities — and understand the
              tradeoffs before you choose.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" asChild>
                <Link href={destination}>
                  {user ? "Continue your research" : "Find your city matches"}
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#how-it-works">See how it works</a>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Your priorities. Published data. Explained results.
            </p>
          </div>

          <div className="rounded-2xl border bg-primary/5 p-6 sm:p-8">
            <p className="mb-6 text-xs font-medium tracking-widest text-primary uppercase">
              Inside your workspace
            </p>
            <h2 className="mb-6 text-2xl font-semibold tracking-tight">
              See the bigger picture.
            </h2>
            <ol className="space-y-4">
              {[
                {
                  title: "Start with your life",
                  description:
                    "Tell us about your household, work, housing budget, and the factors you value.",
                },
                {
                  title: "Understand your matches",
                  description:
                    "Explore ranked destinations with measured strengths, tradeoffs, and source breakdowns.",
                },
                {
                  title: "Compare with context",
                  description:
                    "Bring fit, wage, and rent benchmarks together. Ask the advisor to help interpret your results when available.",
                },
              ].map((step, index) => (
                <li
                  key={step.title}
                  className="flex gap-4 rounded-xl border bg-card p-5"
                >
                  <span className="text-sm font-semibold text-primary tabular-nums">
                    0{index + 1}
                  </span>
                  <div>
                    <h3 className="mb-1 font-medium">{step.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          id="how-it-works"
          className="scroll-mt-8 border-t py-14 sm:py-20"
        >
          <div className="mb-8 max-w-2xl space-y-3">
            <p className="text-xs font-medium tracking-widest text-primary uppercase">
              Built around your priorities
            </p>
            <h2 className="text-3xl font-semibold tracking-tight">
              More than a best-places list.
            </h2>
            <p className="leading-relaxed text-muted-foreground">
              Make room for the things that matter to you, then look at the
              evidence side by side.
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {PILLARS.map(({ icon: Icon, title, description }) => (
              <Card key={title} className="[--card-spacing:--spacing(6)]">
                <CardHeader className="gap-4">
                  <Icon aria-hidden="true" className="size-6 text-primary" />
                  <CardTitle as="h3" className="text-lg">
                    {title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="leading-relaxed text-muted-foreground">
                  {description}
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="mt-6 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Metro statistics describe a market, not a personal outcome. Coverage
            varies, and your results show what was measured. Wage and housing
            benchmarks are not job offers or live property listings.
          </p>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-3 px-5 py-7 text-sm text-muted-foreground sm:px-8">
          <span className="font-medium text-foreground">DreamDestination</span>
          <span>Find the place that fits the life you want.</span>
        </div>
      </footer>
    </div>
  );
}
