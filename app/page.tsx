import { Briefcase, Home, Users } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        {/* "DreamDestination" is a single unbreakable word, so it needs a
            smaller base size and an explicit break rule to avoid overflowing
            very narrow viewports. */}
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance break-words sm:text-4xl md:text-5xl">
          DreamDestination
        </h1>
        <p className="text-lg text-balance text-muted-foreground">
          Find the place that fits the life you want.
        </p>
      </header>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">What this will do</CardTitle>
          <CardDescription>
            DreamDestination will match your circumstances, finances and goals
            against U.S. cities and metro areas, then explain the fit.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          <ul className="flex flex-col gap-4">
            {PILLARS.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex gap-3">
                <Icon
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                />
                <div className="flex flex-col gap-0.5">
                  <p className="font-medium">{title}</p>
                  <p className="text-muted-foreground">{description}</p>
                </div>
              </li>
            ))}
          </ul>

          <Separator />

          {user ? (
            <div className="flex flex-col items-start gap-2">
              <Button size="lg" asChild>
                <Link href={ROUTES.onboarding}>Continue your profile</Link>
              </Button>
              <p className="text-xs text-muted-foreground">
                Signed in as {user.email}.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" asChild>
                <Link href={ROUTES.signUp}>Start Your Profile</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href={ROUTES.signIn}>Sign in</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <footer className="text-xs text-muted-foreground">
        You can create an account and record your profile and priorities. City
        matching, recommendation scoring and AI explanations are not built yet.
      </footer>
    </main>
  );
}
