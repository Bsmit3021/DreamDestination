import { ArrowDown, ArrowUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DestinationComparison } from "@/app/recommendations/comparison";
import { GenerateButton } from "@/app/recommendations/generate-button";
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
import { getDestinationComparisonForCurrentUser } from "@/lib/opportunity/service";
import {
  getStoredRecommendations,
  snapshotDimensions,
  type StoredRecommendation,
} from "@/lib/data/recommendations";
import { DIMENSIONS } from "@/lib/matching/dimensions";
import { formatRawValue } from "@/lib/matching/explanations";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Your matches · DreamDestination",
};

export default async function RecommendationsPage() {
  const { hasProfile, hasPreferences } = await getOnboardingStatus();

  // The engine needs both halves of onboarding; send the user to whichever is
  // outstanding rather than showing an empty page.
  if (!hasProfile || !hasPreferences) {
    redirect(ROUTES.onboarding);
  }

  const recommendations = await getStoredRecommendations();
  const comparison = await getDestinationComparisonForCurrentUser();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Your best matches
        </h1>
        <p className="text-sm text-muted-foreground">
          Ranked by how closely each metro&apos;s measured data lines up with
          the priorities you set. A fit score is a comparison against the other
          candidate metros — not a prediction about how happy you would be.
        </p>
      </header>

      <GenerateButton hasExisting={recommendations.length > 0} />

      {recommendations.length > 0 && (
        <div className="flex flex-col items-start gap-2">
          <Button variant="outline" asChild>
            <Link href={ROUTES.advisor}>Ask DreamDestination</Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            Have the advisor explain these results in plain language. It
            interprets your matches — it never changes them.
          </p>
        </div>
      )}

      {recommendations.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">No matches yet</CardTitle>
            <CardDescription>
              Generate your matches to see how U.S. metros score against your
              priorities. You can change your{" "}
              <Link
                href={ROUTES.onboardingPreferences}
                className="font-medium underline underline-offset-4"
              >
                priorities
              </Link>{" "}
              and regenerate at any time.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {recommendations.map((recommendation) => (
            <li key={recommendation.id}>
              <RecommendationCard recommendation={recommendation} />
            </li>
          ))}
        </ul>
      )}

      {recommendations.length > 0 && (
        <DestinationComparison
          rows={comparison.rows}
          occupation={comparison.occupation}
        />
      )}

      {recommendations.length > 0 && (
        <footer className="flex flex-col gap-2 text-xs text-muted-foreground">
          <p>
            Scored with algorithm {recommendations[0]!.algorithmVersion} on{" "}
            {new Date(recommendations[0]!.createdAt).toLocaleDateString(
              "en-US",
              {
                dateStyle: "medium",
              },
            )}
            .
          </p>
          <p>
            Safety, social life and family friendliness are collected as
            priorities but are not scored yet — no authoritative dataset is
            wired up for them, so they are excluded rather than guessed at.
          </p>
        </footer>
      )}
    </div>
  );
}

function RecommendationCard({
  recommendation,
}: {
  recommendation: StoredRecommendation;
}) {
  const { city, reason } = recommendation;
  const dimensions = snapshotDimensions(reason);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-4">
          <CardTitle className="text-lg">
            {recommendation.rank}. {city.city}, {city.state}
          </CardTitle>
          <span className="font-heading text-lg font-semibold tabular-nums">
            {Math.round(recommendation.score)}
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              / 100
            </span>
          </span>
        </div>
        <CardDescription>
          {city.metro ?? city.city} · {Math.round(reason.dataCoverage * 100)}%
          of your priorities measured ({reason.dimensionsCovered} of{" "}
          {reason.dimensionsWeighted} weighted dimensions)
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {reason.reasons.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <ArrowUp
                aria-hidden="true"
                className="size-3.5 text-emerald-600"
              />
              Best for
            </h3>
            <ul className="flex flex-col gap-1.5">
              {reason.reasons.map((line) => (
                <li key={line.dimension} className="text-sm">
                  <span className="font-medium">{line.label}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    — {line.detail}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {reason.tradeoffs.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-medium">
              <ArrowDown
                aria-hidden="true"
                className="size-3.5 text-amber-600"
              />
              Watch-outs
            </h3>
            <ul className="flex flex-col gap-1.5">
              {reason.tradeoffs.map((line) => (
                <li key={line.dimension} className="text-sm">
                  <span className="font-medium">{line.label}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    — {line.detail}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Separator />

        <Link
          href={`/recommendations/${city.id}`}
          className="text-sm font-medium underline underline-offset-4"
        >
          Explore destination
        </Link>

        <details className="group">
          <summary className="cursor-pointer text-sm font-medium">
            View breakdown
          </summary>

          <table className="mt-3 w-full text-sm">
            <caption className="sr-only">
              Per-dimension scores for {city.city}
            </caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="pb-2 font-medium">
                  Dimension
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Measured
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Score
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Weight
                </th>
              </tr>
            </thead>
            <tbody>
              {dimensions.map((key) => {
                const snapshot = reason.dimensions[key]!;
                const definition = DIMENSIONS[key];

                return (
                  <tr key={key} className="border-t border-border/60">
                    <th scope="row" className="py-2 pr-2 text-left font-normal">
                      {definition.label}
                      <span className="block text-xs text-muted-foreground">
                        {definition.metric?.label}
                      </span>
                    </th>
                    <td className="py-2 text-right tabular-nums">
                      {formatRawValue(snapshot.rawValue, snapshot.unit)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {Math.round(snapshot.normalizedScore)}
                    </td>
                    <td className="py-2 text-right text-muted-foreground tabular-nums">
                      {Math.round(snapshot.effectiveWeight * 100)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="mt-3 text-xs text-muted-foreground">
            Sources:{" "}
            {[
              ...new Set(
                dimensions.map((key) => reason.dimensions[key]!.sourceKey),
              ),
            ]
              .sort()
              .join(", ")}
            . Scores are percentile ranks against the other candidate metros,
            except climate, which scores by closeness to a temperate annual
            mean.
          </p>
        </details>
      </CardContent>
    </Card>
  );
}
