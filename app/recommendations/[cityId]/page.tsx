import { ArrowLeft, ArrowUp, ArrowDown } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

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
import { describeConcentration } from "@/lib/opportunity/calculations";
import {
  DestinationNotRecommendedError,
  getDestinationOpportunityForCurrentUser,
} from "@/lib/opportunity/service";
import type {
  CareerIntelligence,
  HousingIntelligence,
} from "@/lib/opportunity/types";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Destination · DreamDestination",
};

const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

export default async function DestinationPage({
  params,
}: PageProps<"/recommendations/[cityId]">) {
  const { cityId } = await params;

  let opportunity;
  try {
    opportunity = await getDestinationOpportunityForCurrentUser(cityId);
  } catch (error) {
    // Not in the caller's own recommendation set — indistinguishable from a
    // nonexistent city, which is the correct response either way.
    if (error instanceof DestinationNotRecommendedError) notFound();
    throw error;
  }

  const { city, fit, career, housing } = opportunity;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={ROUTES.recommendations}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to your matches
      </Link>

      <PageHeader
        eyebrow="Destination overview"
        title={`${city.city}, ${city.state}`}
        description={city.metro ?? city.city}
        actions={
          <Button variant="outline" asChild>
            <Link href={ROUTES.compare}>Compare matches</Link>
          </Button>
        }
      />
      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-primary/5 p-5">
          <dt className="text-sm text-muted-foreground">
            DreamDestination Fit
          </dt>
          <dd className="mt-2 text-3xl font-semibold text-primary tabular-nums">
            {Math.round(fit.score)}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              / 100
            </span>
          </dd>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <dt className="text-sm text-muted-foreground">Your match ranking</dt>
          <dd className="mt-2 text-3xl font-semibold tabular-nums">
            #{fit.rank}
          </dd>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <dt className="text-sm text-muted-foreground">
            Weighted priorities measured
          </dt>
          <dd className="mt-2 text-3xl font-semibold tabular-nums">
            {Math.round(fit.dataCoverage * 100)}%
          </dd>
        </div>
      </dl>
      <nav
        aria-label="Destination sections"
        className="flex flex-wrap gap-5 border-b pb-3 text-sm font-medium"
      >
        <a href="#fit" className="underline-offset-4 hover:underline">
          Why it matched
        </a>
        <a href="#career" className="underline-offset-4 hover:underline">
          Career
        </a>
        <a href="#housing" className="underline-offset-4 hover:underline">
          Housing
        </a>
      </nav>

      {/* ---- Phase 3 match, passed through unchanged ---- */}
      <Card id="fit" className="scroll-mt-6">
        <CardHeader>
          <CardTitle as="h2" className="text-lg">
            Why it matched
          </CardTitle>
          <CardDescription>
            From your saved priorities. {Math.round(fit.dataCoverage * 100)}% of
            what you weighted could be measured here.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          {fit.reasons.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-medium">
                <ArrowUp
                  aria-hidden="true"
                  className="size-3.5 text-emerald-600"
                />
                Best for
              </h3>
              <ul className="flex flex-col gap-1.5">
                {fit.reasons.map((line) => (
                  <li key={line.label} className="text-sm">
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
          {fit.tradeoffs.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-medium">
                <ArrowDown
                  aria-hidden="true"
                  className="size-3.5 text-amber-600"
                />
                Watch-outs
              </h3>
              <ul className="flex flex-col gap-1.5">
                {fit.tradeoffs.map((line) => (
                  <li key={line.label} className="text-sm">
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
        </CardContent>
      </Card>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <section
          id="career"
          aria-label="Career intelligence"
          className="min-w-0 scroll-mt-6"
        >
          <CareerSection
            career={career}
            careerTarget={opportunity.careerTarget}
          />
        </section>
        <section
          id="housing"
          aria-label="Housing intelligence"
          className="min-w-0 scroll-mt-6"
        >
          <HousingSection housing={housing} />
        </section>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-lg">
            Current opportunities
          </CardTitle>
          <CardDescription>
            No live job or property listing provider is configured, so none are
            shown. The figures above describe the market, not vacancies or
            available homes.
          </CardDescription>
        </CardHeader>
      </Card>

      <footer className="text-xs text-muted-foreground">
        These figures describe the metropolitan market and do not guarantee an
        individual salary, job offer, rent or housing availability. Fit Score is
        produced by matching algorithm {fit.algorithmVersion} and is not
        affected by the career or housing figures on this page.
      </footer>
    </div>
  );
}

function CareerSection({
  career,
  careerTarget,
}: {
  career: CareerIntelligence | null;
  careerTarget: { socCode: string; title: string } | null;
}) {
  // No occupation chosen yet — ask for one.
  if (!careerTarget) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-lg">
            Career
          </CardTitle>
          <CardDescription>
            Confirm which standard occupation matches your job title to see
            local employment and wage estimates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href={ROUTES.onboardingOccupation}
            className="text-sm font-medium underline underline-offset-4"
          >
            Confirm your occupation
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Occupation chosen, but BLS publishes nothing for it here. Saying so is very
  // different from asking the user to confirm an occupation they already did.
  if (!career) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-lg">
            Career
          </CardTitle>
          <CardDescription>
            {careerTarget.title} · SOC {careerTarget.socCode}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm">
            The Bureau of Labor Statistics does not publish an estimate for this
            occupation in this metro. That usually means too few people are
            employed in it locally for a reliable figure — it does not mean
            there is no such work here.
          </p>
          <Link
            href={ROUTES.onboardingOccupation}
            className="text-sm font-medium underline underline-offset-4"
          >
            Choose a different occupation
          </Link>
        </CardContent>
      </Card>
    );
  }

  const concentration = describeConcentration(career.locationQuotient);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="text-lg">
          Career
        </CardTitle>
        <CardDescription>
          {career.occupation.title} · SOC {career.occupation.socCode}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col gap-3">
          <Row
            label="Employment in this metro"
            hint="Total people employed in this occupation — not current job openings."
            value={
              career.employment === null
                ? "Not published"
                : career.employment.toLocaleString("en-US")
            }
          />
          <Row
            label="Jobs per 1,000 local jobs"
            value={
              career.employmentPer1000 === null
                ? "Not published"
                : career.employmentPer1000.toFixed(1)
            }
          />
          <Row
            label="Employment concentration"
            hint="Location quotient: how concentrated this occupation is here versus the national average. It does not describe an individual's chance of being hired."
            value={
              career.locationQuotient === null
                ? "Not published"
                : `${career.locationQuotient.toFixed(2)}×${concentration ? ` — ${concentration.toLowerCase()}` : ""}`
            }
          />

          <Separator />

          {career.wages.availability === "top_coded" ? (
            <Row
              label="Median annual wage"
              hint="BLS does not publish a point estimate above its top code."
              value={
                career.wages.topCodeAnnual
                  ? `At or above ${usd(career.wages.topCodeAnnual)}`
                  : "At or above the published top code"
              }
            />
          ) : (
            <>
              <Row
                label="Median annual wage"
                value={
                  career.wages.medianAnnual === null
                    ? "Not released for this metro"
                    : usd(career.wages.medianAnnual)
                }
              />
              <Row
                label="25th–75th percentile"
                value={
                  career.wages.percentile25 === null ||
                  career.wages.percentile75 === null
                    ? "Not released for this metro"
                    : `${usd(career.wages.percentile25)} – ${usd(career.wages.percentile75)}`
                }
              />
              <Row
                label="Mean annual wage"
                value={
                  career.wages.meanAnnual === null
                    ? "Not released for this metro"
                    : usd(career.wages.meanAnnual)
                }
              />
            </>
          )}
        </dl>

        {career.source && (
          <p className="text-xs text-muted-foreground">
            Source: {career.source.organization} — {career.source.dataset},{" "}
            {career.period}. Metro estimate.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function HousingSection({ housing }: { housing: HousingIntelligence | null }) {
  if (!housing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="text-lg">
            Housing
          </CardTitle>
          <CardDescription>
            No housing benchmarks are loaded for this metro.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { bedrooms, budgetComparison } = housing;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="text-lg">
          Housing
        </CardTitle>
        <CardDescription>
          Median gross rent includes utilities. Bedroom figures are shown
          separately — your household size is not used to assume how many
          bedrooms you need.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col gap-3">
          <Row
            label="Median gross rent"
            value={
              housing.medianGrossRent === null
                ? "Not published"
                : `${usd(housing.medianGrossRent)}/mo`
            }
          />
          <Row
            label="Studio"
            value={
              bedrooms.studio === null
                ? "Not published"
                : `${usd(bedrooms.studio)}/mo`
            }
          />
          <Row
            label="1 bedroom"
            value={
              bedrooms.one === null
                ? "Not published"
                : `${usd(bedrooms.one)}/mo`
            }
          />
          <Row
            label="2 bedroom"
            value={
              bedrooms.two === null
                ? "Not published"
                : `${usd(bedrooms.two)}/mo`
            }
          />
          <Row
            label="3 bedroom"
            value={
              bedrooms.three === null
                ? "Not published"
                : `${usd(bedrooms.three)}/mo`
            }
          />
          <Row
            label="4 bedroom"
            value={
              bedrooms.four === null
                ? "Not published"
                : `${usd(bedrooms.four)}/mo`
            }
          />
          <Row
            label="Median home value"
            value={
              housing.medianHomeValue === null
                ? "Not published"
                : usd(housing.medianHomeValue)
            }
          />
        </dl>

        <Separator />

        {budgetComparison ? (
          <dl className="flex flex-col gap-3">
            <Row
              label="Your stated monthly budget"
              value={`${usd(budgetComparison.monthlyBudget)}/mo`}
            />
            <Row
              label="Difference from benchmark"
              value={
                budgetComparison.difference >= 0
                  ? `${usd(budgetComparison.difference)} above the median rent`
                  : `${usd(Math.abs(budgetComparison.difference))} below the median rent`
              }
            />
            <Row
              label="Median rent as share of budget"
              value={`${Math.round(budgetComparison.benchmarkPercentOfBudget)}%`}
            />
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            No monthly housing budget is recorded on your profile, so no
            comparison is shown.
          </p>
        )}

        {housing.source && (
          <p className="text-xs text-muted-foreground">
            Source: {housing.source.organization} — {housing.source.dataset},{" "}
            {housing.period}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <dt className="text-sm">{label}</dt>
        <dd className="text-sm font-medium tabular-nums">{value}</dd>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
