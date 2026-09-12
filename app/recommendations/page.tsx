import { ArrowDown, ArrowUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EqualWeightingNotice } from "@/app/recommendations/equal-weighting-notice";
import { GenerateButton } from "@/app/recommendations/generate-button";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  getCurrentUserPreferences,
  getOnboardingStatus,
} from "@/lib/data/preferences";
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

  const [recommendations, preferences] = await Promise.all([
    getStoredRecommendations(),
    getCurrentUserPreferences(),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Your research"
        title="Your best matches"
        description="Ranked by how closely each metro’s measured data lines up with your priorities. A fit score compares candidate metros — it does not predict how happy you would be."
        actions={<GenerateButton hasExisting={recommendations.length > 0} />}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-y py-3">
        <p className="text-sm text-muted-foreground">
          {recommendations.length} ranked destinations
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={ROUTES.compare}>Compare matches</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={ROUTES.onboardingPreferences}>Edit priorities</Link>
          </Button>
          {recommendations.length > 0 && (
            <Button variant="ghost" size="sm" asChild>
              <Link href={ROUTES.advisor}>Ask the advisor</Link>
            </Button>
          )}
        </div>
      </div>

      <EqualWeightingNotice weights={preferences?.weights ?? null} />

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
        <ul className="grid items-start gap-5 xl:grid-cols-2">
          {recommendations.map((recommendation) => (
            <li key={recommendation.id} className="min-w-0">
              <RecommendationCard recommendation={recommendation} />
            </li>
          ))}
        </ul>
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
            Coverage varies by metro and priority. Review each breakdown for
            measured dimensions and sources; missing data is not a zero score.
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
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="border-b bg-muted/30">
        <div className="flex items-start justify-between gap-3">
          <CardTitle as="h2" className="min-w-0 text-xl">
            <span className="mb-2 block text-xs font-medium text-muted-foreground">
              MATCH {String(recommendation.rank).padStart(2, "0")}
            </span>
            <Link
              href={`/recommendations/${city.id}`}
              className="underline-offset-4 hover:underline"
            >
              {city.city}, {city.state}
            </Link>
          </CardTitle>
          <span className="shrink-0 rounded-lg bg-primary/10 px-3 py-2 font-heading text-xl font-semibold text-primary tabular-nums">
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

          <div
            className="mt-3 overflow-x-auto rounded-md focus-visible:outline-2 focus-visible:outline-ring"
            role="region"
            aria-label={`Score breakdown for ${city.city}`}
            tabIndex={0}
          >
            <table className="w-full min-w-80 text-sm">
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
                      <th
                        scope="row"
                        className="py-2 pr-2 text-left font-normal"
                      >
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
          </div>

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
