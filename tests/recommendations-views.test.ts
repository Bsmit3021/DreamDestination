import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { recalculateRecommendationsAction } from "@/app/recommendations/actions";
import RecommendationsPage from "@/app/recommendations/page";
import { RecommendationActions } from "@/app/recommendations/recommendation-actions";
import {
  getCurrentUserPreferences,
  getOnboardingStatus,
} from "@/lib/data/preferences";
import {
  getStoredRecommendations,
  type StoredRecommendation,
} from "@/lib/data/recommendations";
import { NO_ALTERNATIVES_MESSAGE } from "@/lib/matching/snapshot";
import { ROUTES } from "@/lib/routes";

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
vi.mock("@/app/recommendations/actions", () => ({
  recalculateRecommendationsAction: vi.fn(),
}));

const ALTERNATIVES_DESCRIPTION =
  "These cities ranked immediately below your five strongest matches and meet the minimum DreamScore requirement.";

function stored(rank: number, score: number): StoredRecommendation {
  return {
    id: `44444444-4444-4444-8444-4444444444${String(rank).padStart(2, "0")}`,
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
      dataCoverage: 0.9,
      dimensionsCovered: 3,
      dimensionsWeighted: 3,
      reasons: [
        { dimension: "housing", label: "Housing", detail: `Rent ${rank}` },
      ],
      tradeoffs: [
        { dimension: "climate", label: "Climate", detail: `Hot ${rank}` },
      ],
      dimensions: {},
    },
  };
}

/** Stored rows whose i-th score belongs to overall rank i + 1. */
function snapshotOf(scores: number[]): StoredRecommendation[] {
  return scores.map((score, index) => stored(index + 1, score));
}

function pageProps(view?: string): Parameters<typeof RecommendationsPage>[0] {
  return {
    params: Promise.resolve({}),
    searchParams: Promise.resolve(view === undefined ? {} : { view }),
  };
}

/** The card link for one overall rank, matched exactly (city-1 ≠ city-10). */
function cardLink(rank: number): string {
  return `href="/recommendations/city-${rank}"`;
}

async function render(view?: string): Promise<string> {
  return renderToStaticMarkup(await RecommendationsPage(pageProps(view)));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOnboardingStatus).mockResolvedValue({
    hasProfile: true,
    hasPreferences: true,
  });
  vi.mocked(getCurrentUserPreferences).mockResolvedValue(null);
  vi.mocked(getStoredRecommendations).mockResolvedValue(
    snapshotOf([95, 92, 90, 88, 85, 80, 75, 70, 65, 60]),
  );
});

describe("best matches view", () => {
  it("is the default and shows ranks 1-5 only", async () => {
    const html = await render();

    expect(html).toContain("Your best matches");
    expect(html).toContain("5 best matches");
    for (const rank of [1, 2, 3, 4, 5]) {
      expect(html).toContain(cardLink(rank));
    }
    for (const rank of [6, 7, 8, 9, 10]) {
      expect(html).not.toContain(cardLink(rank));
    }
    expect(html).toContain("MATCH 05");
    expect(html).not.toContain("Overall rank");
  });

  it("offers both actions near the top", async () => {
    const html = await render();

    expect(html).toMatch(
      /<button[^>]*type="submit"[^>]*>Recalculate best matches<\/button>/,
    );
    expect(html).toMatch(
      /<a[^>]*href="\/recommendations\?view=alternatives"[^>]*>Explore different places<\/a>/,
    );
    expect(html).not.toContain("Back to best matches");
    expect(html.indexOf("Recalculate best matches")).toBeLessThan(
      html.indexOf(cardLink(1)),
    );
    expect(html).toContain('href="/recommendations/compare"');
  });

  it("falls back to best matches for an unknown view", async () => {
    const html = await render("surprise");

    expect(html).toContain("Your best matches");
    expect(html).not.toContain(cardLink(6));
  });
});

describe("alternatives view", () => {
  it("shows ranks 6-10 with their overall ranks and no best match", async () => {
    const html = await render("alternatives");

    expect(html).toContain("Other places worth exploring");
    expect(html).toContain(ALTERNATIVES_DESCRIPTION);
    expect(html).toContain("5 other places · overall ranks #6–#10");
    for (const rank of [6, 7, 8, 9, 10]) {
      expect(html).toContain(`Overall rank #${rank}`);
      expect(html).toContain(cardLink(rank));
    }
    for (const rank of [1, 2, 3, 4, 5]) {
      expect(html).not.toContain(cardLink(rank));
    }
    expect(html).not.toContain("MATCH 0");
    // Scores, coverage, reasons and tradeoffs are still shown.
    expect(html).toContain("90%");
    expect(html).toContain("Rent 6");
    expect(html).toContain("Hot 10");
  });

  it("offers a way back and compares only these places", async () => {
    const html = await render("alternatives");

    expect(html).toMatch(
      /<a[^>]*href="\/recommendations"[^>]*>Back to best matches<\/a>/,
    );
    expect(html).not.toContain("Explore different places");
    expect(html).toContain('href="/recommendations/compare?view=alternatives"');
  });

  it("shows the qualifying cities and explains a shortfall", async () => {
    vi.mocked(getStoredRecommendations).mockResolvedValue(
      snapshotOf([95, 92, 90, 88, 85, 80, 75, 70, 49.9, 20]),
    );

    const html = await render("alternatives");

    for (const rank of [6, 7, 8]) {
      expect(html).toContain(cardLink(rank));
    }
    expect(html).not.toContain(cardLink(9));
    expect(html).not.toContain(cardLink(10));
    expect(html).toContain("Showing 3 cities instead of 5.");
    expect(html).toContain(
      "2 cities ranked just below your top 5 scored under the minimum DreamScore of 50.",
    );
  });

  it("shows the required message when no alternative qualifies", async () => {
    vi.mocked(getStoredRecommendations).mockResolvedValue(
      snapshotOf([95, 92, 90, 88, 85, 45, 40, 35, 30, 25]),
    );

    const html = await render("alternatives");

    expect(html).toContain(NO_ALTERNATIVES_MESSAGE);
    expect(html).not.toContain("Overall rank #");
    expect(html).toContain("Back to best matches");
    expect(html).toContain(`href="${ROUTES.onboardingPreferences}"`);
    expect(html).toContain(`href="${ROUTES.onboardingProfile}"`);
  });

  it("suggests recalculating when only five cities are stored", async () => {
    vi.mocked(getStoredRecommendations).mockResolvedValue(
      snapshotOf([95, 92, 90, 88, 85]),
    );

    const html = await render("alternatives");

    expect(html).toContain(NO_ALTERNATIVES_MESSAGE);
    expect(html).toContain("recalculate your best matches to rank the next");
  });

  it("only reads the stored snapshot: exploring never recalculates", async () => {
    await render("alternatives");

    expect(getStoredRecommendations).toHaveBeenCalledTimes(1);
    expect(recalculateRecommendationsAction).not.toHaveBeenCalled();
  });
});

describe("RecommendationActions", () => {
  it("offers only a first calculation when nothing is stored", () => {
    const html = renderToStaticMarkup(
      createElement(RecommendationActions, {
        hasExisting: false,
        view: "best",
      }),
    );

    expect(html).toContain("Find my matches");
    expect(html).not.toContain("Explore different places");
    expect(html.match(/type="submit"/g)).toHaveLength(1);
  });

  it("announces a running recalculation to assistive technology", () => {
    const html = renderToStaticMarkup(
      createElement(RecommendationActions, { hasExisting: true, view: "best" }),
    );

    expect(html).toMatch(/<span role="status" class="sr-only">/);
    expect(html.match(/type="submit"/g)).toHaveLength(1);
  });
});

describe("weak best matches", () => {
  it("warns on the best view when best matches are weak fits", async () => {
    vi.mocked(getStoredRecommendations).mockResolvedValue(
      snapshotOf([62, 55, 49.5, 44, 40, 38, 35, 30, 25, 20]),
    );

    const html = await render();

    expect(html).toContain("3 of your 5 best matches score below 50.");
    // Still shown, in order: the warning never hides a best match.
    for (const rank of [1, 2, 3, 4, 5]) {
      expect(html).toContain(cardLink(rank));
    }
  });

  it("does not warn when every best match is a solid fit", async () => {
    const html = await render();

    expect(html).not.toContain("best matches score below");
    expect(html).not.toContain("None of your best matches");
  });

  it("does not repeat the warning on the alternatives view", async () => {
    vi.mocked(getStoredRecommendations).mockResolvedValue(
      snapshotOf([45, 40, 35, 30, 25, 80, 75, 70, 65, 60]),
    );

    const html = await render("alternatives");

    expect(html).not.toContain("None of your best matches");
  });
});
