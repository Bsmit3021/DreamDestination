import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentUserPreferences } from "@/lib/data/preferences";
import { getCurrentUserProfile } from "@/lib/data/profiles";
import { loadCandidateCities } from "@/lib/data/cities";
import {
  MATCHING_ALGORITHM_VERSION,
  generateMatches,
} from "@/lib/matching/ranking";
import { generateRecommendationsForCurrentUser } from "@/lib/matching/service";
import type { PreferenceWeights } from "@/types/profile";

import {
  GOLDEN_CITIES,
  cityWith,
  testProfile,
  weightsWith,
} from "./matching/fixtures";

/**
 * The recalculate → persist path with every loader stubbed, so the assertions
 * are about exactly what reaches `replace_my_recommendations`.
 */

const rpc = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ rpc })),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({
    id: "22222222-2222-4222-8222-222222222222",
  })),
}));
vi.mock("@/lib/data/profiles", () => ({ getCurrentUserProfile: vi.fn() }));
vi.mock("@/lib/data/preferences", () => ({
  getCurrentUserPreferences: vi.fn(),
}));
vi.mock("@/lib/data/cities", () => ({ loadCandidateCities: vi.fn() }));
vi.mock("@/lib/data/career-targets", () => ({
  getCurrentUserCareerTarget: vi.fn(async () => null),
}));
vi.mock("@/lib/data/opportunity", () => ({
  loadOccupationStatsForScoring: vi.fn(),
  loadBedroomRentsForScoring: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/data/place-intelligence", () => ({
  loadSafetyStatsForScoring: vi.fn(async () => new Map()),
  loadSchoolStatsForScoring: vi.fn(async () => new Map()),
  loadLifestyleStatsForScoring: vi.fn(async () => new Map()),
}));

interface PersistedRow {
  city_id: string;
  dream_score: number;
  rank: number;
  reason_json: unknown;
}

interface PersistedArgs {
  p_algorithm_version: string;
  p_rows: PersistedRow[];
}

function persistedCall(index = 0): { name: string; args: PersistedArgs } {
  const [name, args] = rpc.mock.calls[index]!;
  return { name, args };
}

function fixtureId(index: number): string {
  return `00000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
}

function preferencesWith(weights: PreferenceWeights) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    profileId: testProfile().id,
    weights,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

const BALANCED = weightsWith({ housing: 1, career: 1, climate: 1 });

/** Rent worsens as the index rises while unemployment improves. */
const OPPOSED_CITIES = Array.from({ length: 15 }, (_, index) =>
  cityWith(fixtureId(index), {
    housing: 900 + index * 100,
    career: 7 - index * 0.3,
    climate: 57,
  }),
);

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: null, error: null });
  vi.mocked(getCurrentUserProfile).mockResolvedValue(testProfile());
  vi.mocked(getCurrentUserPreferences).mockResolvedValue(
    preferencesWith(BALANCED),
  );
});

describe("recalculating and persisting recommendations", () => {
  it("returns and stores a ten-city snapshot ranked 1 to 10", async () => {
    vi.mocked(loadCandidateCities).mockResolvedValue(
      Array.from({ length: 15 }, (_, index) =>
        cityWith(fixtureId(index), {
          housing: 900 + ((index * 7) % 15) * 100,
          career: 2.5 + ((index * 11) % 15) * 0.3,
          climate: 57,
        }),
      ),
    );

    const result = await generateRecommendationsForCurrentUser();
    expect(rpc).toHaveBeenCalledTimes(1);
    const { name, args } = persistedCall();

    expect(result.recommendations).toHaveLength(10);
    expect(name).toBe("replace_my_recommendations");
    expect(args.p_algorithm_version).toBe(MATCHING_ALGORITHM_VERSION);
    expect(args.p_rows).toHaveLength(10);

    // Ranks fill 1..10 exactly once, satisfying unique (profile_id, rank).
    expect(args.p_rows.map((row) => row.rank)).toEqual(
      Array.from({ length: 10 }, (_, index) => index + 1),
    );
    // One row per city, satisfying unique (profile_id, city_id).
    expect(new Set(args.p_rows.map((row) => row.city_id)).size).toBe(10);
    // Stored in the same order the engine returned.
    expect(args.p_rows.map((row) => row.city_id)).toEqual(
      result.recommendations.map((r) => r.city.id),
    );

    for (let i = 0; i < args.p_rows.length; i += 1) {
      const row = args.p_rows[i]!;
      // dream_score is CHECK-constrained to 0-1.
      expect(row.dream_score).toBeGreaterThanOrEqual(0);
      expect(row.dream_score).toBeLessThanOrEqual(1);
      if (i > 0) {
        expect(row.dream_score).toBeLessThanOrEqual(
          args.p_rows[i - 1]!.dream_score,
        );
      }
    }
  });

  it("stores only as many rows as there are ranked cities", async () => {
    vi.mocked(loadCandidateCities).mockResolvedValue(GOLDEN_CITIES);

    await generateRecommendationsForCurrentUser();
    const { args } = persistedCall();

    expect(args.p_rows.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
  });

  it("scores every recalculation with the latest saved preference weights", async () => {
    vi.mocked(loadCandidateCities).mockResolvedValue(OPPOSED_CITIES);
    const housingFirst = weightsWith({ housing: 1, career: 0.1, climate: 0.1 });
    const careerFirst = weightsWith({ housing: 0.1, career: 1, climate: 0.1 });

    // The user saves new priorities between the two recalculations.
    vi.mocked(getCurrentUserPreferences)
      .mockResolvedValueOnce(preferencesWith(housingFirst))
      .mockResolvedValueOnce(preferencesWith(careerFirst));

    await generateRecommendationsForCurrentUser();
    await generateRecommendationsForCurrentUser();

    expect(getCurrentUserPreferences).toHaveBeenCalledTimes(2);

    const expectedIds = (weights: PreferenceWeights) =>
      generateMatches(
        OPPOSED_CITIES,
        testProfile(),
        weights,
      ).recommendations.map((r) => r.city.id);
    const firstIds = persistedCall(0).args.p_rows.map((row) => row.city_id);
    const secondIds = persistedCall(1).args.p_rows.map((row) => row.city_id);

    expect(firstIds).toEqual(expectedIds(housingFirst));
    expect(secondIds).toEqual(expectedIds(careerFirst));
    // Opposed data means the change of priorities really does reorder.
    expect(secondIds).not.toEqual(firstIds);
    expect(firstIds[0]).toBe(fixtureId(0));
    expect(secondIds[0]).toBe(fixtureId(14));
  });

  it("stores an identical snapshot on repeated runs with identical inputs", async () => {
    vi.mocked(loadCandidateCities).mockResolvedValue(OPPOSED_CITIES);

    await generateRecommendationsForCurrentUser();
    await generateRecommendationsForCurrentUser();

    expect(persistedCall(1).args).toEqual(persistedCall(0).args);
  });

  it("never sends a user or profile id: the database derives the owner", async () => {
    vi.mocked(loadCandidateCities).mockResolvedValue(OPPOSED_CITIES);

    await generateRecommendationsForCurrentUser();
    const { args } = persistedCall();

    // One call carries the whole snapshot, which the function replaces
    // atomically; nothing in it can name an owner.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(Object.keys(args).sort()).toEqual(["p_algorithm_version", "p_rows"]);
    for (const row of args.p_rows) {
      expect(Object.keys(row).sort()).toEqual([
        "city_id",
        "dream_score",
        "rank",
        "reason_json",
      ]);
    }
  });
});
