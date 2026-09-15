import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AdvisorForm } from "@/app/advisor/advisor-form";
import { startNewConversationAction } from "@/app/advisor/actions";
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
import { MAX_USER_MESSAGE_LENGTH, isAdvisorConfigured } from "@/lib/ai/config";
import { buildSuggestedQuestions, getAdvisorReadiness } from "@/lib/ai/service";
import {
  createConversation,
  getLatestConversation,
  getMessages,
} from "@/lib/data/advisor";
import { getStoredRecommendations } from "@/lib/data/recommendations";
import {
  PRIMARY_MATCH_COUNT,
  partitionSnapshot,
} from "@/lib/matching/snapshot";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Advisor · DreamDestination",
};

/**
 * The advisor.
 *
 * Market intelligence and the advisor fail independently: when no provider is
 * configured the page still renders the conversation and a clear explanation,
 * because the underlying recommendation data is unaffected.
 */
export default async function AdvisorPage() {
  const readiness = await getAdvisorReadiness();

  if (!readiness.ready) {
    return (
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle as="h1" className="text-2xl">
            Advisor not ready yet
          </CardTitle>
          <CardDescription>{readiness.message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link
              href={
                readiness.reason === "no_recommendations"
                  ? ROUTES.recommendations
                  : ROUTES.onboarding
              }
            >
              {readiness.reason === "no_recommendations"
                ? "Go to recommendations"
                : "Continue onboarding"}
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const conversation =
    (await getLatestConversation()) ?? (await createConversation());
  const messages = await getMessages(conversation.id);

  // The advisor discusses the best matches only — the same ranks 1-5 its
  // answers are grounded in. Alternatives stay on the matches page.
  const { primary: primaryMatches } = partitionSnapshot(
    await getStoredRecommendations(),
  );
  const suggestions = buildSuggestedQuestions(
    primaryMatches.map((r) => ({
      name: `${r.city.city}, ${r.city.state}`,
      rank: r.rank,
    })),
  );

  const configured = isAdvisorConfigured();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Make sense of your matches"
        title="Your advisor"
        description="Grounded in your current matches, career data and housing data. The advisor explains your results — it never changes your Fit Scores or rankings."
        actions={
          <form action={startNewConversationAction}>
            <Button type="submit" variant="outline">
              New conversation
            </Button>
          </form>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <section
          aria-label="Advisor conversation"
          className="flex min-w-0 flex-col gap-6 rounded-xl border bg-card p-4 sm:p-6"
        >
          {!configured && (
            <Card role="status">
              <CardHeader>
                <CardTitle className="text-base">Advisor unavailable</CardTitle>
                <CardDescription>
                  The DreamDestination advisor is not configured on this server.
                  Your recommendation, career and housing data are still
                  available.
                </CardDescription>
              </CardHeader>
            </Card>
          )}

          {messages.length === 0 && (
            <div className="flex flex-col items-start gap-3 py-6">
              <Sparkles aria-hidden="true" className="size-7 text-primary" />
              <h2 className="text-xl font-semibold">
                A clearer picture of your next move
              </h2>
              <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                Ask why a city ranked highly, how housing compares, or which
                tradeoffs to look at more closely. Start with a suggested
                question below.
              </p>
            </div>
          )}

          {messages.length > 0 && (
            <ol className="flex flex-col gap-4">
              {messages.map((message) => (
                <li key={message.id}>
                  <Card
                    size="sm"
                    className={
                      message.role === "user" ? "bg-muted/50 ring-0" : "ring-0"
                    }
                  >
                    <CardHeader>
                      <CardTitle className="text-sm">
                        {message.role === "user" ? "You" : "Advisor"}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      {/* Plain text: model output is never rendered as HTML. */}
                      <p className="text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
                        {message.content}
                      </p>

                      {message.role === "assistant" &&
                        message.evidenceRefs.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Grounded in {message.evidenceRefs.length}{" "}
                            DreamDestination data point
                            {message.evidenceRefs.length === 1 ? "" : "s"}
                            {message.model ? ` · ${message.model}` : ""}
                            {message.promptVersion
                              ? ` · prompt ${message.promptVersion}`
                              : ""}
                          </p>
                        )}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ol>
          )}

          <Separator />

          <AdvisorForm
            conversationId={conversation.id}
            suggestions={suggestions}
            maxLength={MAX_USER_MESSAGE_LENGTH}
          />
        </section>
        <aside className="min-w-0 rounded-xl border bg-card p-5 xl:sticky xl:top-6">
          <h2 className="font-semibold">Match context</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Your best matches, in saved fit order.
          </p>
          <ol className="my-5 divide-y">
            {primaryMatches.map((recommendation) => (
              <li key={recommendation.id} className="py-3 first:pt-0">
                <Link
                  href={`/recommendations/${recommendation.city.id}`}
                  className="flex items-start justify-between gap-3 text-sm underline-offset-4 hover:underline"
                >
                  <span>
                    {recommendation.rank}. {recommendation.city.city},{" "}
                    {recommendation.city.state}
                  </span>
                  <span className="shrink-0 font-semibold text-primary tabular-nums">
                    {Math.round(recommendation.score)}
                    <span className="sr-only"> out of 100 fit score</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          <Button variant="outline" size="sm" className="w-full" asChild>
            <Link href={ROUTES.compare}>Compare all matches</Link>
          </Button>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            The advisor discusses your {PRIMARY_MATCH_COUNT} best matches. To
            change the ranking, update your priorities and recalculate your best
            matches.
          </p>
        </aside>
      </div>

      <footer className="text-xs text-muted-foreground">
        The advisor interprets published statistics. It does not provide
        financial advice, guarantee a salary, or establish that housing is
        available at any price.
      </footer>
    </div>
  );
}
