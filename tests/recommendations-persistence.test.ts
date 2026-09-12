import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentUserPreferences } from "@/lib/data/preferences";
import { getCurrentUserProfile } from "@/lib/data/profiles";
import { loadCandidateCities } from "@/lib/data/cities";
import { MATCHING_ALGORITHM_VERSION } from "@/lib/matching/ranking";
import { generateRecommendationsForCurrentUser } from "@/lib/matching/service";

import {
  GOLDEN_CITIES,
  cityWith,
  testProfile,
  weightsWith,
} from "./matching/fixtures";

/**
 * The generate → persist path with every loader stubbed, so the assertions
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

function persistedCall(): {
  name: string;
  args: { p_algorithm_version: string; p_rows: PersistedRow[] };
} {
  expect(rpc).toHaveBeenCalledTimes(1);
  const [name, args] = rpc.mock.calls[0]!;
  return { name, args };
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: null, error: null });
  vi.mocked(getCurrentUserProfile).mockResolvedValue(testProfile());
  vi.mocked(getCurrentUserPreferences).mockResolvedValue({
    id: "33333333-3333-4333-8333-333333333333",
    profileId: testProfile().id,
    weights: weightsWith({ housing: 1, career: 1, climate: 1 }),
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
});

describe("generating and persisting recommendations", () => {
  it("returns and stores twelve matches ranked 1 to 12", async () => {
    vi.mocked(loadCandidateCities).mockResolvedValue(
      Array.from({ length: 15 }, (_, index) =>
        cityWith(
          `00000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`,
          {
            housing: 900 + ((index * 7) % 15) * 100,
            career: 2.5 + ((index * 11) % 15) * 0.3,
            climate: 57,
          },
        ),
      ),
    );

    const result = await generateRecommendationsForCurrentUser();
    const { name, args } = persistedCall();

    expect(result.recommendations).toHaveLength(12);
    expect(name).toBe("replace_my_recommendations");
    expect(args.p_algorithm_version).toBe(MATCHING_ALGORITHM_VERSION);
    expect(args.p_rows).toHaveLength(12);

    // Ranks fill 1..12 exactly once, satisfying unique (profile_id, rank).
    expect(args.p_rows.map((row) => row.rank)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    // One row per city, satisfying unique (profile_id, city_id).
    expect(new Set(args.p_rows.map((row) => row.city_id)).size).toBe(12);
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
});
