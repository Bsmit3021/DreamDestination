import "server-only";

import OpenAI from "openai";

import {
  MAX_OUTPUT_TOKENS,
  REQUEST_TIMEOUT_MS,
  type AdvisorConfig,
} from "@/lib/ai/config";
import { UNTRUSTED_DATA_PREAMBLE } from "@/lib/ai/prompts";
import type {
  AdvisorFailureKind,
  AdvisorProvider,
  AdvisorProviderResult,
  AdvisorRequest,
} from "@/lib/ai/provider";
import {
  ADVISOR_JSON_SCHEMA,
  ADVISOR_SCHEMA_NAME,
  advisorResponseSchema,
} from "@/lib/ai/schemas";

/**
 * OpenAI Responses API implementation.
 *
 * `server-only` is load-bearing: importing this from a Client Component is a
 * build error, so the key cannot reach a browser bundle even by mistake.
 *
 * Uses the Responses API with `text.format: json_schema` and `strict: true`,
 * which constrains generation to the schema rather than asking politely for
 * JSON. The result is still re-validated with Zod — a provider guarantee is
 * not a substitute for checking.
 *
 * No tools are attached. In particular no web search: Phase 5 proves grounded
 * reasoning over our own verified data, so the model has no route to outside
 * facts.
 */

/** Maps a provider error onto our taxonomy without leaking its detail. */
function classify(error: unknown): {
  kind: AdvisorFailureKind;
  retryable: boolean;
} {
  if (error instanceof OpenAI.APIError) {
    const status = error.status;

    if (status === 401 || status === 403) {
      // Bad credentials never become good on retry.
      return { kind: "auth_error", retryable: false };
    }
    if (status === 429) {
      return { kind: "rate_limited", retryable: false };
    }
    if (typeof status === "number" && status >= 500) {
      return { kind: "provider_error", retryable: true };
    }
    return { kind: "provider_error", retryable: false };
  }

  if (error instanceof Error && /abort|timeout/i.test(error.message)) {
    return { kind: "timeout", retryable: true };
  }

  return { kind: "provider_error", retryable: true };
}

export function createOpenAIAdvisorProvider(
  config: AdvisorConfig,
): AdvisorProvider {
  const client = new OpenAI({
    apiKey: config.apiKey,
    timeout: REQUEST_TIMEOUT_MS,
    // Retries are handled explicitly below so failure kinds stay meaningful.
    maxRetries: 0,
  });

  async function attempt(
    request: AdvisorRequest,
  ): Promise<AdvisorProviderResult> {
    const startedAt = Date.now();

    try {
      const response = await client.responses.create(
        {
          model: config.model,
          max_output_tokens: MAX_OUTPUT_TOKENS,
          // Instructions carry no user data; facts arrive as untrusted input.
          instructions: request.systemPrompt,
          input: [
            ...request.history.map((turn) => ({
              role: turn.role,
              content: turn.content,
            })),
            {
              role: "user" as const,
              content: `${UNTRUSTED_DATA_PREAMBLE}\n\n<dreamdestination_data>\n${request.groundedData}\n</dreamdestination_data>\n\nQuestion: ${request.question}`,
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: ADVISOR_SCHEMA_NAME,
              strict: true,
              schema: ADVISOR_JSON_SCHEMA as unknown as Record<string, unknown>,
            },
          },
        },
        { timeout: REQUEST_TIMEOUT_MS },
      );

      const latencyMs = Date.now() - startedAt;

      // A truncated response is a budget problem, not a malformed model. It is
      // reported distinctly and never retried: an identical request would
      // truncate at exactly the same point and burn a second call for nothing.
      if (response.status === "incomplete") {
        console.warn(
          JSON.stringify({
            event: "advisor_response_incomplete",
            reason: response.incomplete_details?.reason ?? "unknown",
            model: config.model,
            outputTokens: response.usage?.output_tokens ?? null,
          }),
        );
        return {
          ok: false,
          kind: "invalid_response",
          retryable: false,
          usage: {
            model: config.model,
            inputTokens: response.usage?.input_tokens ?? null,
            outputTokens: response.usage?.output_tokens ?? null,
            latencyMs,
          },
        };
      }

      const usage = {
        model: config.model,
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        latencyMs,
      };

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(response.output_text);
      } catch {
        return { ok: false, kind: "invalid_response", retryable: true, usage };
      }

      const parsed = advisorResponseSchema.safeParse(parsedJson);
      if (!parsed.success) {
        return { ok: false, kind: "invalid_response", retryable: true, usage };
      }

      return { ok: true, response: parsed.data, usage };
    } catch (error) {
      const { kind, retryable } = classify(error);
      return {
        ok: false,
        kind,
        retryable,
        usage: {
          model: config.model,
          inputTokens: null,
          outputTokens: null,
          latencyMs: Date.now() - startedAt,
        },
      };
    }
  }

  return {
    name: "openai",
    async generate(request: AdvisorRequest): Promise<AdvisorProviderResult> {
      const first = await attempt(request);
      if (first.ok || !first.retryable) return first;

      // Exactly one retry, and only for genuinely transient conditions.
      return attempt(request);
    },
  };
}
