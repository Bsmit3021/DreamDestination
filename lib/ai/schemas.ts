import { z } from "zod";

/**
 * The advisor's structured output contract.
 *
 * Two representations of the same shape, kept together on purpose: a JSON
 * Schema sent to the Responses API so the model is constrained at generation
 * time, and a Zod schema used to re-validate what actually comes back. The
 * provider constraint is not treated as a guarantee.
 */

/** Bounds keep a runaway answer from reaching the UI or the database. */
export const MAX_ANSWER_LENGTH = 4_000;
export const MAX_EVIDENCE_CITATIONS = 24;
export const MAX_LIMITATIONS = 6;
export const MAX_SUGGESTED_QUESTIONS = 4;

export const advisorResponseSchema = z.object({
  answer: z.string().min(1).max(MAX_ANSWER_LENGTH),
  evidenceUsed: z.array(z.string().min(1).max(200)).max(MAX_EVIDENCE_CITATIONS),
  limitations: z.array(z.string().min(1).max(400)).max(MAX_LIMITATIONS),
  suggestedQuestions: z
    .array(z.string().min(1).max(200))
    .max(MAX_SUGGESTED_QUESTIONS),
});

export type AdvisorResponse = z.infer<typeof advisorResponseSchema>;

/**
 * JSON Schema for the Responses API `text.format` parameter.
 *
 * `strict: true` requires every property to be listed in `required` and
 * `additionalProperties: false`, so the shape is fixed rather than merely
 * suggested.
 */
export const ADVISOR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "evidenceUsed", "limitations", "suggestedQuestions"],
  properties: {
    answer: {
      type: "string",
      description:
        "The user-facing explanation, in plain prose. No HTML. No hidden reasoning.",
    },
    evidenceUsed: {
      type: "array",
      description:
        "Exact ids of supplied evidence items relied on. Only ids present in this request.",
      items: { type: "string" },
    },
    limitations: {
      type: "array",
      description:
        "What this answer cannot establish, e.g. data the user asked for that is not published.",
      items: { type: "string" },
    },
    suggestedQuestions: {
      type: "array",
      description:
        "Up to four grounded follow-up questions the user could ask.",
      items: { type: "string" },
    },
  },
} as const;

export const ADVISOR_SCHEMA_NAME = "dreamdestination_advisor_response";
