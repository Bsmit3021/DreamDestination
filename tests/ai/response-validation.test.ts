import { describe, expect, it } from "vitest";

import { buildEvidenceRegistry, validateCitations } from "@/lib/ai/evidence";
import { failureMessage } from "@/lib/ai/provider";
import { MAX_ANSWER_LENGTH, advisorResponseSchema } from "@/lib/ai/schemas";

import { DESTINATIONS } from "./fixtures";

const USER_FACTS = {
  housingBudget: 3_600,
  confirmedOccupation: { socCode: "15-1252", title: "Software Developers" },
  topPriorities: [{ label: "Career opportunity", weightPercent: 32 }],
};

const registry = buildEvidenceRegistry(DESTINATIONS, USER_FACTS, "v1");

const VALID = {
  answer: "Madison is your #1 match with a Fit Score of 81/100.",
  evidenceUsed: ["fit:madison-wi:score"],
  limitations: [],
  suggestedQuestions: ["Compare Madison and Omaha."],
};

describe("advisorResponseSchema", () => {
  it("accepts a well-formed response", () => {
    expect(advisorResponseSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a missing answer", () => {
    const { answer: _answer, ...rest } = VALID;
    expect(advisorResponseSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an empty answer", () => {
    expect(
      advisorResponseSchema.safeParse({ ...VALID, answer: "" }).success,
    ).toBe(false);
  });

  it("rejects an oversized answer rather than passing it through", () => {
    const oversized = { ...VALID, answer: "x".repeat(MAX_ANSWER_LENGTH + 1) };
    expect(advisorResponseSchema.safeParse(oversized).success).toBe(false);
  });

  it("rejects a malformed shape", () => {
    expect(
      advisorResponseSchema.safeParse({ answer: 42, evidenceUsed: "nope" })
        .success,
    ).toBe(false);
  });

  it("rejects too many citations", () => {
    const flooded = {
      ...VALID,
      evidenceUsed: Array.from({ length: 100 }, (_, i) => `id-${i}`),
    };
    expect(advisorResponseSchema.safeParse(flooded).success).toBe(false);
  });

  it("keeps an HTML payload as inert text for the caller to render safely", () => {
    const hostile = {
      ...VALID,
      answer: "<script>alert('xss')</script> Madison ranks first.",
    };
    const parsed = advisorResponseSchema.safeParse(hostile);

    // The schema's job is shape, not sanitisation — it stays a plain string,
    // and the UI renders it as text rather than HTML.
    expect(parsed.success).toBe(true);
    expect(typeof parsed.data?.answer).toBe("string");
  });
});

describe("citation validation against a mocked model response", () => {
  it("keeps only real ids when the model mixes real and fabricated", () => {
    const modelOutput = {
      ...VALID,
      evidenceUsed: [
        "fit:madison-wi:score",
        "career:austin-tx:15-1252:median-annual-wage", // never supplied
        "evidence:fake:secret",
      ],
    };

    const parsed = advisorResponseSchema.parse(modelOutput);
    const { valid, rejected } = validateCitations(
      parsed.evidenceUsed,
      registry,
    );

    expect(valid).toEqual(["fit:madison-wi:score"]);
    expect(rejected).toHaveLength(2);
    expect(rejected).toContain("career:austin-tx:15-1252:median-annual-wage");
  });

  it("rejects every citation when the model invents them all", () => {
    const { valid, rejected } = validateCitations(["a:b:c", "d:e:f"], registry);

    expect(valid).toEqual([]);
    expect(rejected).toHaveLength(2);
  });
});

describe("failureMessage", () => {
  it("gives a distinct, non-technical message per failure kind", () => {
    const kinds = [
      "not_configured",
      "auth_error",
      "rate_limited",
      "timeout",
      "provider_error",
      "invalid_response",
    ] as const;

    for (const kind of kinds) {
      const message = failureMessage(kind);
      expect(message.length).toBeGreaterThan(0);
      // Never leak provider internals or credentials to the user.
      expect(message.toLowerCase()).not.toContain("openai");
      expect(message.toLowerCase()).not.toContain("api key");
      expect(message).not.toMatch(/\b[45]\d\d\b/); // no raw status codes
    }
  });

  it("reassures that the underlying data still works", () => {
    expect(failureMessage("provider_error")).toMatch(/still available/i);
    expect(failureMessage("not_configured")).toMatch(/still available/i);
  });

  it("distinguishes retryable conditions from setup problems", () => {
    expect(failureMessage("timeout")).toMatch(/try/i);
    expect(failureMessage("rate_limited")).toMatch(/try again/i);
    expect(failureMessage("not_configured")).toMatch(/not configured/i);
  });
});
