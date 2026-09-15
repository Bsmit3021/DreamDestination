import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadHousingForCities } from "@/lib/data/opportunity";
import {
  getStoredRecommendations,
  type StoredRecommendation,
} from "@/lib/data/recommendations";
import { getDestinationComparisonForCurrentUser } from "@/lib/opportunity/service";

import { testProfile } from "../matching/fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "user" })),
}));
vi.mock("@/lib/data/profiles", () => ({
  getCurrentUserProfile: vi.fn(async () => testProfile()),
}));
vi.mock("@/lib/data/career-targets", () => ({
  getCurrentUserCareerTarget: vi.fn(async () => null),
}));
vi.mock("@/lib/data/opportunity", () => ({
  loadCareerStats: vi.fn(),
  loadCareerStatsForCities: vi.fn(),
  loadHousingStats: vi.fn(),
  loadHousingForCities: vi.fn(
    async (ids: string[]) => new Map(ids.map((id) => [id, 1200])),
  ),
}));
vi.mock("@/lib/data/recommendations", () => ({
  getStoredRecommendations: vi.fn(),
}));

function stored(rank: number, score: number): StoredRecommendation {
  return {
    id: `rec-${rank}`,
    rank,
    score,
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

function snapshotOf(scores: number[]): StoredRecommendation[] {
  return scores.map((score, index) => stored(index + 1, score));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("comparison view", () => {
  it("compares only the best matches by default, in rank order", async () => {
    // Shuffled on purpose: stored order must not decide comparison order.
    vi.mocked(getStoredRecommendations).mockResolvedValue(
      snapshotOf([95, 92, 90, 88, 85, 80, 75, 70, 65, 60]).reverse(),
    );

    const { rows } = await getDestinationComparisonForCurrentUser();

    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(loadHousingForCities).toHaveBeenCalledWith([
      "city-1",
      "city-2",
      "city-3",
      "city-4",
      "city-5",
    ]);
  });

  it("compares only qualifying alternatives in the alternatives view", async () => {
    vi.mocked(getStoredRecommendations).mockResolvedValue(
      snapshotOf([95, 92, 90, 88, 85, 80, 75, 70, 45, 20]),
    );

    const { rows } =
      await getDestinationComparisonForCurrentUser("alternatives");

    expect(rows.map((row) => row.rank)).toEqual([6, 7, 8]);
    expect(rows.map((row) => row.cityId)).not.toContain("city-1");
  });

  it("returns no rows, and loads nothing, when no alternative qualifies", async () => {
    vi.mocked(getStoredRecommendations).mockResolvedValue(
      snapshotOf([95, 92, 90, 88, 85, 45, 40, 35, 30, 25]),
    );

    const comparison =
      await getDestinationComparisonForCurrentUser("alternatives");

    expect(comparison).toEqual({
      rows: [],
      occupation: null,
      hasRecommendations: true,
    });
    expect(loadHousingForCities).not.toHaveBeenCalled();
  });

  it("reports when nothing has been saved at all", async () => {
    vi.mocked(getStoredRecommendations).mockResolvedValue([]);

    for (const view of ["best", "alternatives"] as const) {
      expect(await getDestinationComparisonForCurrentUser(view)).toEqual({
        rows: [],
        occupation: null,
        hasRecommendations: false,
      });
    }
  });
});
