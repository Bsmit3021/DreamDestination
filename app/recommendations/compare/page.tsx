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
import {
  NO_ALTERNATIVES_MESSAGE,
  parseRecommendationView,
} from "@/lib/matching/snapshot";
import { getDestinationComparisonForCurrentUser } from "@/lib/opportunity/service";
import {
  ROUTES,
  recommendationsViewPath,
  resolveOnboardingDestination,
} from "@/lib/routes";

export const metadata: Metadata = {
  title: "Compare matches · DreamDestination",
};

export default async function ComparePage({
  searchParams,
}: PageProps<"/recommendations/compare">) {
  const status = await getOnboardingStatus();
  if (!status.hasProfile || !status.hasPreferences) {
    redirect(resolveOnboardingDestination(status));
  }

  // Compares the best matches by default. The alternatives view compares only
  // the other places the matches page is showing, from the same snapshot.
  const view = parseRecommendationView((await searchParams).view);
  const comparison = await getDestinationComparisonForCurrentUser(view);
  const matchesPath = recommendationsViewPath(view);
  const isAlternatives = view === "alternatives";

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader
        eyebrow="Side by side"
        title={
          isAlternatives
            ? "Compare other places worth exploring"
            : "Compare your matches"
        }
        description={
          isAlternatives
            ? "Cities ranked immediately below your best matches that meet the minimum DreamScore, in their overall fit ranking."
            : "See fit, career wages, and housing benchmarks together. Your destinations stay in their original fit ranking, so you can weigh the tradeoffs without losing sight of your priorities."
        }
        actions={
          <Button variant="outline" asChild>
            <Link href={matchesPath}>
              {isAlternatives ? "Back to other places" : "Back to matches"}
            </Link>
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
      ) : isAlternatives && comparison.hasRecommendations ? (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle as="h2">No other places to compare</CardTitle>
            <CardDescription>{NO_ALTERNATIVES_MESSAGE}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={matchesPath}>Back to other places</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="max-w-2xl">
          <CardHeader>
            {/* Nothing saved yet, in either view: "no alternatives" would
                wrongly imply a ranking had been calculated. */}
            <CardTitle as="h2">
              Find your matches before comparing places
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
