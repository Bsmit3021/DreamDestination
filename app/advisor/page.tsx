import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AdvisorForm } from "@/app/advisor/advisor-form";
import { startNewConversationAction } from "@/app/advisor/actions";
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
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Advisor not ready yet</CardTitle>
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

  const recommendations = await getStoredRecommendations();
  const suggestions = buildSuggestedQuestions(
    recommendations.map((r) => ({
      name: `${r.city.city}, ${r.city.state}`,
      rank: r.rank,
    })),
  );

  const configured = isAdvisorConfigured();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight">
          <Sparkles aria-hidden="true" className="size-5" />
          DreamDestination Advisor
        </h1>
        <p className="text-sm text-muted-foreground">
          Grounded in your current matches, career data and housing data. The
          advisor explains your results — it never changes your Fit Scores or
          rankings.
        </p>
      </header>

      {!configured && (
        <Card role="status">
          <CardHeader>
            <CardTitle className="text-base">Advisor unavailable</CardTitle>
            <CardDescription>
              The DreamDestination advisor is not configured on this server.
              Your recommendation, career and housing data are still available.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {messages.length > 0 && (
        <ol className="flex flex-col gap-4">
          {messages.map((message) => (
            <li key={message.id}>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm">
                    {message.role === "user" ? "You" : "Advisor"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {/* Plain text: model output is never rendered as HTML. */}
                  <p className="text-sm whitespace-pre-wrap">
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

      <form action={startNewConversationAction}>
        <Button type="submit" variant="outline" size="sm">
          Start a new conversation
        </Button>
      </form>

      <footer className="text-xs text-muted-foreground">
        The advisor interprets published statistics. It does not provide
        financial advice, guarantee a salary, or establish that housing is
        available at any price.
      </footer>
    </div>
  );
}
