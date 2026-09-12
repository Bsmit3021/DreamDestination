import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DestinationComparison } from "@/app/recommendations/comparison";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getOnboardingStatus } from "@/lib/data/preferences";
import { getDestinationComparisonForCurrentUser } from "@/lib/opportunity/service";
import { ROUTES, resolveOnboardingDestination } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Compare matches · DreamDestination",
};

export default async function ComparePage() {
  const status = await getOnboardingStatus();
  if (!status.hasProfile || !status.hasPreferences) {
    redirect(resolveOnboardingDestination(status));
  }

  const comparison = await getDestinationComparisonForCurrentUser();

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader
        eyebrow="Side by side"
        title="Compare your matches"
        description="See fit, career wages, and housing benchmarks together. Your destinations stay in their original fit ranking, so you can weigh the tradeoffs without losing sight of your priorities."
        actions={
          <Button variant="outline" asChild>
            <Link href={ROUTES.recommendations}>Back to matches</Link>
          </Button>
        }
      />
      {comparison.rows.length > 0 ? (
        <>
          <DestinationComparison
            rows={comparison.rows}
            occupation={comparison.occupation}
          />
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5">
            <div className="max-w-xl space-y-1">
              <h2 className="font-medium">Put the numbers in context</h2>
              <p className="text-sm text-muted-foreground">
                Explore a destination for its sources and breakdown, or ask the
                advisor to explain the differences.
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link href={ROUTES.advisor}>Ask the advisor</Link>
            </Button>
          </div>
        </>
      ) : (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle as="h2">
              Your comparison starts with your matches
            </CardTitle>
            <CardDescription>
              Generate your recommendations first, then return here to compare
              their measured data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={ROUTES.recommendations}>Find my matches</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {!comparison.occupation && comparison.rows.length > 0 && (
        <p className="text-sm text-muted-foreground">
          <Link
            href={ROUTES.onboardingOccupation}
            className="font-medium text-foreground underline underline-offset-4"
          >
            Confirm your occupation
          </Link>{" "}
          to add occupation-specific wage comparisons.
        </p>
      )}
    </div>
  );
}
