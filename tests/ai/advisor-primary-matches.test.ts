import { beforeEach, describe, expect, it, vi } from "vitest";

import { askAdvisor } from "@/lib/ai/service";
import {
  getStoredRecommendations,
  type StoredRecommendation,
} from "@/lib/data/recommendations";
import { getDestinationOpportunityForCurrentUser } from "@/lib/opportunity/service";
import type { DestinationOpportunity } from "@/lib/opportunity/types";

import { testProfile } from "../matching/fixtures";
import { MADISON, testWeights } from "./fixtures";

/**
 * The advisor is grounded in the best matches only.
 *
 * The stored snapshot holds ten cities; ranks 6-10 are alternatives on the
 * matches page. The provider is stubbed to fail after the facts are built, so
 * the test inspects exactly what the model would have been given without
 * writing an answer.
 */

const generate = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "user" })),
}));
vi.mock("@/lib/ai/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/config")>()),
  getAdvisorConfig: vi.fn(() => ({ apiKey: "test-key", model: "test-model" })),
}));
vi.mock("@/lib/ai/openai", () => ({
  createOpenAIAdvisorProvider: vi.fn(() => ({ name: "test", generate })),
}));
vi.mock("@/lib/data/advisor", () => ({
  getOwnedConversation: vi.fn(async () => ({ id: "conversation" })),
  isWithinRateLimit: vi.fn(async () => ({ allowed: true, used: 0, limit: 30 })),
  getRecentHistory: vi.fn(async () => []),
  appendMessage: vi.fn(async () => undefined),
}));
vi.mock("@/lib/data/profiles", () => ({
  getCurrentUserProfile: vi.fn(async () => testProfile()),
}));
vi.mock("@/lib/data/preferences", () => ({
  getCurrentUserPreferences: vi.fn(),
}));
vi.mock("@/lib/data/career-targets", () => ({
  getCurrentUserCareerTarget: vi.fn(async () => null),
}));
vi.mock("@/lib/data/recommendations", () => ({
  getStoredRecommendations: vi.fn(),
}));
vi.mock("@/lib/opportunity/service", () => ({
  getDestinationOpportunityForCurrentUser: vi.fn(),
}));

function stored(rank: number): StoredRecommendation {
  return {
    id: `rec-${rank}`,
    rank,
    score: 95 - rank,
    algorithmVersion: "v2.2",
    createdAt: "2026-09-01T00:00:00.000Z",
    city: {
      id: `city-${rank}`,
      slug: `city-${rank}`,
      city: `City ${rank}`,
      state: "TX",
      metro: null,
      population: null,
    },
    reason: {
      dataCoverage: 1,
      dimensionsCovered: 1,
      dimensionsWeighted: 1,
      reasons: [],
      tradeoffs: [],
      dimensions: {},
    },
  };
}

function destinationFor(cityId: string): DestinationOpportunity {
  const rank = Number(cityId.replace("city-", ""));
  return {
    ...MADISON,
    city: { ...MADISON.city, id: cityId, slug: cityId, city: `City ${rank}` },
    fit: { ...MADISON.fit, rank },
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { getCurrentUserPreferences } = await import("@/lib/data/preferences");
  vi.mocked(getCurrentUserPreferences).mockResolvedValue({
    id: "preferences",
    profileId: testProfile().id,
    weights: testWeights(),
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
  vi.mocked(getStoredRecommendations).mockResolvedValue(
    // Shuffled: the advisor must select by rank, not by stored order.
    Array.from({ length: 10 }, (_, index) => stored(index + 1)).reverse(),
  );
  vi.mocked(getDestinationOpportunityForCurrentUser).mockImplementation(
    async (cityId) => destinationFor(cityId),
  );
  generate.mockResolvedValue({
    ok: false,
    kind: "provider_error",
    retryable: false,
  });
});

describe("advisor grounding", () => {
  it("loads and discusses only the best matches, ranks 1-5", async () => {
    const outcome = await askAdvisor({
      conversationId: "conversation",
      question: "Why did my top city rank first?",
    });

    expect(outcome.ok).toBe(false);
    expect(
      vi
        .mocked(getDestinationOpportunityForCurrentUser)
        .mock.calls.map(([cityId]) => cityId),
    ).toEqual(["city-1", "city-2", "city-3", "city-4", "city-5"]);

    expect(generate).toHaveBeenCalledTimes(1);
    const grounded = JSON.parse(generate.mock.calls[0]![0].groundedData) as {
      destinations: { rank: number; name: string }[];
    };

    expect(grounded.destinations.map((d) => d.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(grounded.destinations.map((d) => d.name)).not.toContain(
      "City 6, WI",
    );
  });
});
