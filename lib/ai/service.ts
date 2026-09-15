import "server-only";

import { MAX_USER_MESSAGE_LENGTH, getAdvisorConfig } from "@/lib/ai/config";
import { buildAdvisorContext } from "@/lib/ai/context";
import {
  buildEvidenceRegistry,
  resolveSources,
  validateCitations,
  type EvidenceItem,
} from "@/lib/ai/evidence";
import { createOpenAIAdvisorProvider } from "@/lib/ai/openai";
import {
  ADVISOR_PROMPT_VERSION,
  ADVISOR_SYSTEM_PROMPT,
} from "@/lib/ai/prompts";
import { failureMessage, type AdvisorFailureKind } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth/session";
import {
  appendMessage,
  getOwnedConversation,
  getRecentHistory,
  isWithinRateLimit,
} from "@/lib/data/advisor";
import { getCurrentUserCareerTarget } from "@/lib/data/career-targets";
import { MissingProfileError } from "@/lib/data/errors";
import { getCurrentUserPreferences } from "@/lib/data/preferences";
import { getCurrentUserProfile } from "@/lib/data/profiles";
import { getStoredRecommendations } from "@/lib/data/recommendations";
import { partitionSnapshot } from "@/lib/matching/snapshot";
import { getDestinationOpportunityForCurrentUser } from "@/lib/opportunity/service";
import type { DestinationOpportunity } from "@/lib/opportunity/types";

/**
 * Advisor orchestration.
 *
 * Order matters and is enforced here: identity, then the caller's own data,
 * then a registry built from that data, then the model, then validation of
 * what the model claimed. The model is the last step and the least trusted.
 *
 * Nothing in this file accepts a user id, profile id or city id as authority.
 * `conversationId` is the one browser-supplied value and it is checked for
 * ownership before use.
 */

export type AdvisorOutcome =
  | {
      ok: true;
      answer: string;
      limitations: string[];
      suggestedQuestions: string[];
      evidenceUsed: EvidenceItem[];
      sources: { organization: string; dataset: string; period: string }[];
      /** Ids the model cited that did not exist. Non-empty means it fabricated. */
      rejectedCitations: string[];
    }
  | {
      ok: false;
      kind: AdvisorFailureKind | "rate_limited_local";
      message: string;
    };

export type AdvisorReadiness =
  | { ready: true }
  | {
      ready: false;
      reason: "no_profile" | "no_preferences" | "no_recommendations";
      message: string;
    };

/** Whether the user has enough saved state for a grounded conversation. */
export async function getAdvisorReadiness(): Promise<AdvisorReadiness> {
  await requireUser();

  const profile = await getCurrentUserProfile();
  if (!profile) {
    return {
      ready: false,
      reason: "no_profile",
      message:
        "Complete your profile so the advisor has something to work from.",
    };
  }

  const preferences = await getCurrentUserPreferences();
  if (!preferences) {
    return {
      ready: false,
      reason: "no_preferences",
      message:
        "Set your priorities so the advisor can explain how they shaped your matches.",
    };
  }

  const recommendations = await getStoredRecommendations();
  if (recommendations.length === 0) {
    return {
      ready: false,
      reason: "no_recommendations",
      message:
        "Generate your matches first so the advisor has grounded results to discuss.",
    };
  }

  return { ready: true };
}

/**
 * Loads the caller's best matches with full Phase 4 intelligence.
 *
 * Only the primary matches (ranks 1-5). The stored snapshot also holds the
 * alternatives, but those are an opt-in view on the matches page, not part of
 * what the advisor presents as the user's matches.
 */
async function loadDestinations(): Promise<DestinationOpportunity[]> {
  const { primary } = partitionSnapshot(await getStoredRecommendations());

  // City ids come from the user's own stored recommendations, never from input.
  const destinations = await Promise.all(
    primary.map((recommendation) =>
      getDestinationOpportunityForCurrentUser(recommendation.city.id),
    ),
  );

  return destinations.filter(
    (destination): destination is DestinationOpportunity =>
      destination !== null,
  );
}

/** Application-generated starter questions, grounded in the actual result set. */
export function buildSuggestedQuestions(
  destinations: readonly { name: string; rank: number }[],
): string[] {
  const first = destinations.find((d) => d.rank === 1);
  const second = destinations.find((d) => d.rank === 2);

  const questions: string[] = [];
  if (first) questions.push(`Why did ${first.name} rank first for me?`);
  if (first && second) {
    questions.push(
      `Compare ${first.name} and ${second.name} for my situation.`,
    );
  }
  questions.push(
    "Which of my matches has the strongest published career market?",
  );
  questions.push("Where does my housing budget go furthest?");

  return questions.slice(0, 4);
}

export interface AskAdvisorInput {
  conversationId: string;
  question: string;
}

/**
 * Answers one question.
 *
 * @throws {NotAuthenticatedError} when there is no verified session
 */
export async function askAdvisor(
  input: AskAdvisorInput,
): Promise<AdvisorOutcome> {
  await requireUser();

  const question = input.question.trim();
  if (question.length === 0) {
    return {
      ok: false,
      kind: "invalid_response",
      message: "Please enter a question.",
    };
  }
  if (question.length > MAX_USER_MESSAGE_LENGTH) {
    return {
      ok: false,
      kind: "invalid_response",
      message: `Please keep your question under ${MAX_USER_MESSAGE_LENGTH} characters.`,
    };
  }

  // Ownership check before anything else touches this conversation.
  const conversation = await getOwnedConversation(input.conversationId);
  if (!conversation) {
    return {
      ok: false,
      kind: "invalid_response",
      message: "That conversation is not available.",
    };
  }

  const budget = await isWithinRateLimit();
  if (!budget.allowed) {
    return {
      ok: false,
      kind: "rate_limited_local",
      message: `You have reached the advisor limit of ${budget.limit} questions per hour. Your recommendation data is still available.`,
    };
  }

  const config = getAdvisorConfig();
  if (!config) {
    return {
      ok: false,
      kind: "not_configured",
      message: failureMessage("not_configured"),
    };
  }

  const profile = await getCurrentUserProfile();
  if (!profile) throw new MissingProfileError();

  const [preferences, careerTarget, destinations] = await Promise.all([
    getCurrentUserPreferences(),
    getCurrentUserCareerTarget(),
    loadDestinations(),
  ]);

  if (!preferences || destinations.length === 0) {
    return {
      ok: false,
      kind: "invalid_response",
      message:
        "Generate your matches first so the advisor has grounded results to discuss.",
    };
  }

  const algorithmVersion = destinations[0]?.fit.algorithmVersion ?? "v1";

  const context = buildAdvisorContext(
    destinations,
    preferences.weights,
    profile.housingBudget,
    careerTarget
      ? { socCode: careerTarget.socCode, title: careerTarget.title }
      : null,
    algorithmVersion,
  );

  const registry = buildEvidenceRegistry(
    destinations,
    {
      housingBudget: context.user.monthlyHousingBudget,
      confirmedOccupation: context.user.confirmedOccupation,
      topPriorities: context.user.priorities,
    },
    algorithmVersion,
  );

  // The model sees the context and the evidence list, and nothing else.
  const groundedData = JSON.stringify(
    {
      matchingAlgorithmVersion: algorithmVersion,
      user: context.user,
      destinations: context.destinations,
      evidence: registry.items.map((item) => ({
        id: item.id,
        label: item.label,
        value: item.value,
        unit: item.unit,
        note: item.note,
      })),
    },
    null,
    1,
  );

  const history = await getRecentHistory(input.conversationId);

  // Persist the question before calling out, so a provider failure still
  // leaves an honest record of what was asked.
  await appendMessage(input.conversationId, {
    role: "user",
    content: question,
  });

  const provider = createOpenAIAdvisorProvider(config);
  const result = await provider.generate({
    systemPrompt: ADVISOR_SYSTEM_PROMPT,
    groundedData,
    history,
    question,
  });

  if (!result.ok) {
    // No fabricated assistant turn is written on failure — the user retries.
    console.info(
      JSON.stringify({
        event: "advisor_request_failed",
        kind: result.kind,
        model: result.usage?.model,
        latencyMs: result.usage?.latencyMs,
      }),
    );
    return {
      ok: false,
      kind: result.kind,
      message: failureMessage(result.kind),
    };
  }

  const { valid, rejected } = validateCitations(
    result.response.evidenceUsed,
    registry,
  );

  if (rejected.length > 0) {
    // Recorded, not surfaced as fact. A fabricated id never becomes a source.
    console.warn(
      JSON.stringify({
        event: "advisor_rejected_citations",
        count: rejected.length,
        model: result.usage.model,
      }),
    );
  }

  await appendMessage(input.conversationId, {
    role: "assistant",
    content: result.response.answer,
    evidenceRefs: valid,
    model: result.usage.model,
    promptVersion: ADVISOR_PROMPT_VERSION,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    latencyMs: result.usage.latencyMs,
  });

  console.info(
    JSON.stringify({
      event: "advisor_request",
      model: result.usage.model,
      promptVersion: ADVISOR_PROMPT_VERSION,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: result.usage.latencyMs,
      citations: valid.length,
      rejectedCitations: rejected.length,
    }),
  );

  return {
    ok: true,
    answer: result.response.answer,
    limitations: result.response.limitations,
    suggestedQuestions: result.response.suggestedQuestions,
    evidenceUsed: valid
      .map((id) => registry.byId.get(id))
      .filter((item): item is EvidenceItem => item !== undefined),
    sources: resolveSources(valid, registry),
    rejectedCitations: rejected,
  };
}
