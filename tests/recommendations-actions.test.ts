import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";

import { recalculateRecommendationsAction } from "@/app/recommendations/actions";
import { DataAccessError } from "@/lib/data/errors";
import { generateRecommendationsForCurrentUser } from "@/lib/matching/service";
import type { MatchingResult } from "@/lib/matching/types";
import { IDLE_FORM_STATE } from "@/lib/forms";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/matching/service", () => ({
  generateRecommendationsForCurrentUser: vi.fn(),
  NoCityDataError: class NoCityDataError extends Error {},
  OnboardingIncompleteError: class OnboardingIncompleteError extends Error {},
}));

function resultWith(count: number): MatchingResult {
  return {
    recommendations: Array.from({ length: count }, () => ({})),
    excluded: [],
    algorithmVersion: "v2.2",
    unscoredWeightedDimensions: [],
    dimensionsWaivedByUser: [],
  } as unknown as MatchingResult;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recalculateRecommendationsAction", () => {
  it("recalculates from the session and refreshes the matches pages", async () => {
    vi.mocked(generateRecommendationsForCurrentUser).mockResolvedValue(
      resultWith(10),
    );

    const state = await recalculateRecommendationsAction(IDLE_FORM_STATE);

    expect(state).toEqual({
      status: "success",
      message:
        "Your best matches were recalculated using your latest profile and priorities.",
    });
    // Nothing from the browser describes whose ranking this is.
    expect(generateRecommendationsForCurrentUser).toHaveBeenCalledWith();
    expect(revalidatePath).toHaveBeenCalledWith("/recommendations", "layout");
  });

  it("reports an empty ranking without refreshing", async () => {
    vi.mocked(generateRecommendationsForCurrentUser).mockResolvedValue(
      resultWith(0),
    );

    const state = await recalculateRecommendationsAction(IDLE_FORM_STATE);

    expect(state.status).toBe("error");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a failed save instead of throwing", async () => {
    vi.mocked(generateRecommendationsForCurrentUser).mockRejectedValue(
      new DataAccessError("Could not save your recommendations."),
    );

    const state = await recalculateRecommendationsAction(IDLE_FORM_STATE);

    expect(state).toEqual({
      status: "error",
      message: "Could not save your recommendations.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
