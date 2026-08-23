import "server-only";

import { z } from "zod";

/**
 * Server-only advisor configuration.
 *
 * Deliberately separate from `lib/env.ts`'s required server schema: the
 * advisor is optional. A missing key must degrade the advisor gracefully, not
 * break sign-in or recommendations, so this never throws on absence — callers
 * ask `isAdvisorConfigured()` and render a fallback.
 *
 * `OPENAI_API_KEY` carries no NEXT_PUBLIC_ prefix, so Next.js cannot inline it
 * into a client bundle even by accident.
 */

/**
 * Default model.
 *
 * The advisor's job is grounded explanation and comparison over facts we
 * supply — not open-ended reasoning or world knowledge. A cost-conscious
 * model is the right starting point; escalate only if the eval suite shows a
 * material quality gap. Override with OPENAI_MODEL.
 */
export const DEFAULT_ADVISOR_MODEL = "gpt-5-mini";

/**
 * Hard ceiling on generated tokens, so a runaway answer cannot bill forever.
 *
 * Sized with reasoning models in mind: `max_output_tokens` covers reasoning
 * tokens *and* the visible answer. Live runs showed ~250-600 reasoning tokens
 * plus 600-850 tokens of answer, so a 900 budget truncated mid-JSON and the
 * structured response failed to parse. This leaves clear headroom while still
 * bounding cost.
 */
export const MAX_OUTPUT_TOKENS = 2_500;

/** Server-side request timeout. Beyond this the user gets a retry, not a hang. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Longest user message accepted. Bounds both cost and prompt-injection surface. */
export const MAX_USER_MESSAGE_LENGTH = 1_000;

/** Prior turns replayed to the provider. Facts are always rebuilt fresh. */
export const MAX_HISTORY_MESSAGES = 10;

/** Advisor requests allowed per user per rolling window. */
export const RATE_LIMIT_MAX_REQUESTS = 30;
export const RATE_LIMIT_WINDOW_MINUTES = 60;

const advisorEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default(DEFAULT_ADVISOR_MODEL),
});

export interface AdvisorConfig {
  apiKey: string;
  model: string;
}

/** True when a key is present. Never reveals the value. */
export function isAdvisorConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Resolved advisor configuration, or null when unconfigured.
 *
 * Returns null rather than throwing so the page can show "advisor
 * unavailable" while the rest of the product keeps working.
 */
export function getAdvisorConfig(): AdvisorConfig | null {
  if (typeof window !== "undefined") {
    throw new Error("getAdvisorConfig() must never be called in the browser.");
  }

  const parsed = advisorEnvSchema.safeParse({
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL ?? DEFAULT_ADVISOR_MODEL,
  });

  if (!parsed.success) return null;

  return {
    apiKey: parsed.data.OPENAI_API_KEY,
    model: parsed.data.OPENAI_MODEL,
  };
}
