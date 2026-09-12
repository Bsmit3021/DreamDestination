import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PreferencesForm } from "@/app/onboarding/preferences/preferences-form";
import { EqualWeightingNotice } from "@/app/recommendations/equal-weighting-notice";
import RecommendationsPage from "@/app/recommendations/page";
import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import {
  getCurrentUserPreferences,
  getOnboardingStatus,
} from "@/lib/data/preferences";
import {
  getStoredRecommendations,
  type StoredRecommendation,
} from "@/lib/data/recommendations";
import { ROUTES } from "@/lib/routes";
import type { PreferenceWeights } from "@/types/profile";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/data/preferences", () => ({
  getOnboardingStatus: vi.fn(),
  getCurrentUserPreferences: vi.fn(),
}));
vi.mock("@/lib/data/recommendations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/recommendations")>()),
  getStoredRecommendations: vi.fn(),
}));
// Both pull in server actions and the scoring service; neither is under test.
vi.mock("@/app/recommendations/generate-button", () => ({
  GenerateButton: () => null,
}));
vi.mock("@/app/onboarding/actions", () => ({
  savePreferencesAction: vi.fn(),
}));

const NOTICE_TITLE = "Your priorities are weighted equally";

function uniformAt(value: number): PreferenceWeights {
  return Object.fromEntries(
    PREFERENCE_WEIGHT_KEYS.map((key) => [key, value]),
  ) as PreferenceWeights;
}

function stored(rank: number): StoredRecommendation {
  return {
    id: `44444444-4444-4444-8444-4444444444${String(rank).padStart(2, "0")}`,
    rank,
    score: 90 - rank,
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
      dimensionsCovered: 3,
      dimensionsWeighted: 3,
      reasons: [],
      tradeoffs: [],
      dimensions: {},
    },
  };
}

function savedPreferences(weights: PreferenceWeights) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    profileId: "11111111-1111-4111-8111-111111111111",
    weights,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOnboardingStatus).mockResolvedValue({
    hasProfile: true,
    hasPreferences: true,
  });
  vi.mocked(getStoredRecommendations).mockResolvedValue(
    Array.from({ length: 12 }, (_, index) => stored(index + 1)),
  );
});

describe("EqualWeightingNotice", () => {
  it.each([
    ["untouched sliders", uniformAt(0.5)],
    ["every slider at zero", uniformAt(0)],
    ["every slider at maximum", uniformAt(1)],
  ])("appears for %s", (_label, weights) => {
    const html = renderToStaticMarkup(
      createElement(EqualWeightingNotice, { weights }),
    );

    expect(html).toContain(NOTICE_TITLE);
    expect(html).toContain(`href="${ROUTES.onboardingPreferences}"`);
    // Informational, not an interruption.
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it.each([
    ["one slider moved a step", { ...uniformAt(0.5), career: 0.55 }],
    [
      "genuinely varied sliders",
      { ...uniformAt(0.2), housing: 1, safety: 0.8 },
    ],
  ])("does not appear for %s", (_label, weights) => {
    expect(
      renderToStaticMarkup(createElement(EqualWeightingNotice, { weights })),
    ).toBe("");
  });

  it("does not appear when no priorities are saved", () => {
    expect(
      renderToStaticMarkup(
        createElement(EqualWeightingNotice, { weights: null }),
      ),
    ).toBe("");
  });
});

describe("matches page", () => {
  it("shows the notice alongside twelve matches when weights are uniform", async () => {
    vi.mocked(getCurrentUserPreferences).mockResolvedValue(
      savedPreferences(uniformAt(0.5)),
    );

    const html = renderToStaticMarkup(await RecommendationsPage());

    expect(html).toContain(NOTICE_TITLE);
    expect(html).toContain("12 ranked destinations");
    expect(html).toContain("MATCH 01");
    expect(html).toContain("MATCH 12");
    expect(html.match(/href="\/recommendations\/city-\d+"/g)).toHaveLength(24);
  });

  it("omits the notice when priorities are varied", async () => {
    vi.mocked(getCurrentUserPreferences).mockResolvedValue(
      savedPreferences({ ...uniformAt(0.5), housing: 1, climate: 0.1 }),
    );

    const html = renderToStaticMarkup(await RecommendationsPage());

    expect(html).not.toContain(NOTICE_TITLE);
    expect(html).toContain("MATCH 12");
  });

  it("still redirects before loading anything when onboarding is incomplete", async () => {
    vi.mocked(getOnboardingStatus).mockResolvedValue({
      hasProfile: true,
      hasPreferences: false,
    });

    await expect(RecommendationsPage()).rejects.toThrow(
      `REDIRECT:${ROUTES.onboarding}`,
    );
    expect(getStoredRecommendations).not.toHaveBeenCalled();
    expect(getCurrentUserPreferences).not.toHaveBeenCalled();
  });
});

describe("priorities form", () => {
  it("offers a reset that is a plain button, not a second submit", () => {
    const html = renderToStaticMarkup(
      createElement(PreferencesForm, { weights: null }),
    );

    expect(html).toMatch(
      /<button[^>]*type="button"[^>]*>Reset to equal importance<\/button>/,
    );
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toMatch(
      /<button[^>]*aria-describedby="reset-weights-hint"[^>]*>Reset to equal importance/,
    );
    expect(html).toContain('id="reset-weights-hint"');
    expect(html).toContain('role="status"');
  });

  it("keeps every range input, its accessible value and saved values", () => {
    const html = renderToStaticMarkup(
      createElement(PreferencesForm, {
        weights: { ...uniformAt(0.5), career: 0.8 },
      }),
    );

    expect(html.match(/type="range"/g)).toHaveLength(
      PREFERENCE_WEIGHT_KEYS.length,
    );
    expect(html).toMatch(/name="career"[^>]*value="0.8"/);
    expect(html).toContain('aria-valuetext="80%"');
    expect(html).toMatch(/name="housing"[^>]*value="0.5"/);
  });
});
