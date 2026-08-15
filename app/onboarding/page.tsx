import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getOnboardingStatus } from "@/lib/data/preferences";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Onboarding · DreamDestination",
};

/**
 * Onboarding hub.
 *
 * Sends the user to whichever step is still outstanding; once both are done it
 * becomes the summary, with links back into either step for editing.
 */
export default async function OnboardingPage() {
  const { hasProfile, hasPreferences } = await getOnboardingStatus();

  if (!hasProfile) {
    redirect(ROUTES.onboardingProfile);
  }

  if (!hasPreferences) {
    redirect(ROUTES.onboardingPreferences);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Your profile is ready</CardTitle>
        <CardDescription>
          Both onboarding steps are complete. You can revisit either one
          whenever your situation changes.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <ul className="flex flex-col gap-3">
          <CompletedStep
            title="Profile complete"
            href={ROUTES.onboardingProfile}
          />
          <CompletedStep
            title="Preferences complete"
            href={ROUTES.onboardingPreferences}
          />
        </ul>

        <Separator />

        <div className="flex flex-col items-start gap-2">
          <p className="text-sm">
            Your DreamDestination profile is ready for matching.
          </p>
          <Button size="lg" asChild>
            <Link href={ROUTES.recommendations}>See your matches</Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            Matches are scored against measured metro data. Recommendation
            explanations are generated from those numbers, not by an AI model.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function CompletedStep({ title, href }: { title: string; href: string }) {
  return (
    <li className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2">
        <Check
          aria-hidden="true"
          className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
        />
        <span className="font-medium">{title}</span>
      </span>
      <Link
        href={href}
        className="text-sm font-medium underline underline-offset-4"
      >
        Edit
      </Link>
    </li>
  );
}
