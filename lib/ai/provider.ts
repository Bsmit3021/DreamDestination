import type { AdvisorResponse } from "@/lib/ai/schemas";

/**
 * Provider-agnostic advisor interface.
 *
 * Failure is modelled as data rather than exceptions so the UI can tell the
 * difference between "not set up", "try again", and "something is wrong" —
 * collapsing them into an empty answer would misinform the user.
 */

export type AdvisorFailureKind =
  /** No API key configured. Expected in local/dev; not an error state. */
  | "not_configured"
  /** Key rejected. Never retried — retrying bad credentials cannot help. */
  | "auth_error"
  /** Provider rate limit or quota. */
  | "rate_limited"
  /** Exceeded our own server-side deadline. */
  | "timeout"
  /** Provider 5xx or transport failure. */
  | "provider_error"
  /** Response did not match the structured schema. */
  | "invalid_response";

export interface AdvisorUsage {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

export type AdvisorProviderResult =
  | { ok: true; response: AdvisorResponse; usage: AdvisorUsage }
  | {
      ok: false;
      kind: AdvisorFailureKind;
      retryable: boolean;
      usage?: AdvisorUsage;
    };

export interface AdvisorTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AdvisorRequest {
  /** System instructions. Contains no user data. */
  systemPrompt: string;
  /** Untrusted, clearly-labelled JSON facts. */
  groundedData: string;
  /** Bounded recent history, oldest first. */
  history: AdvisorTurn[];
  /** The current question. */
  question: string;
}

export interface AdvisorProvider {
  readonly name: string;
  generate(request: AdvisorRequest): Promise<AdvisorProviderResult>;
}

/** User-facing copy per failure kind. Never leaks provider detail. */
export function failureMessage(kind: AdvisorFailureKind): string {
  switch (kind) {
    case "not_configured":
      return "The DreamDestination advisor is not configured on this server. Your recommendations, career and housing data are still available.";
    case "rate_limited":
      return "The advisor is handling too many requests right now. Please try again in a moment — your recommendation data is unaffected.";
    case "timeout":
      return "The advisor took too long to respond. Please try asking again — your recommendation data is unaffected.";
    case "auth_error":
    case "provider_error":
    case "invalid_response":
      return "The DreamDestination advisor is temporarily unavailable. Your recommendation, career and housing data are still available.";
  }
}
