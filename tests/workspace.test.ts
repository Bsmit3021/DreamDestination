import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdvisorLayout from "@/app/advisor/layout";
import OnboardingLayout from "@/app/onboarding/layout";
import OnboardingPage from "@/app/onboarding/page";
import ComparePage from "@/app/recommendations/compare/page";
import RecommendationsLayout from "@/app/recommendations/layout";
import { AppNavigation } from "@/components/layout/app-navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getOnboardingStatus } from "@/lib/data/preferences";
import { getDestinationComparisonForCurrentUser } from "@/lib/opportunity/service";
import { ROUTES } from "@/lib/routes";
import { usePathname } from "next/navigation";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/recommendations"),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/app/auth/actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/data/preferences", () => ({ getOnboardingStatus: vi.fn() }));
vi.mock("@/lib/opportunity/service", () => ({
  getDestinationComparisonForCurrentUser: vi.fn(),
}));

function compareProps(view?: string): Parameters<typeof ComparePage>[0] {
  return {
    params: Promise.resolve({}),
    searchParams: Promise.resolve(view === undefined ? {} : { view }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(null);
  vi.mocked(getOnboardingStatus).mockResolvedValue({
    hasProfile: true,
    hasPreferences: true,
  });
  vi.mocked(getDestinationComparisonForCurrentUser).mockResolvedValue({
    rows: [],
    occupation: null,
    hasRecommendations: false,
  });
});

describe("workspace server routing", () => {
  it.each([
    [false, false, ROUTES.onboardingProfile],
    [true, false, ROUTES.onboardingPreferences],
    [true, true, ROUTES.recommendations],
  ])(
    "the onboarding entry routes profile=%s priorities=%s to %s",
    async (hasProfile, hasPreferences, path) => {
      vi.mocked(getOnboardingStatus).mockResolvedValue({
        hasProfile,
        hasPreferences,
      });
      await expect(OnboardingPage()).rejects.toThrow(`REDIRECT:${path}`);
    },
  );

  it.each([RecommendationsLayout, OnboardingLayout, AdvisorLayout])(
    "the %s layout rejects signed-out requests on the server",
    async (layout) => {
      await expect(
        layout({ children: null, params: Promise.resolve({}) }),
      ).rejects.toThrow(`REDIRECT:${ROUTES.signIn}`);
      expect(getOnboardingStatus).not.toHaveBeenCalled();
    },
  );

  it.each([
    [false, false, ROUTES.onboardingProfile],
    [true, false, ROUTES.onboardingPreferences],
  ])(
    "comparison requires profile=%s priorities=%s before loading data",
    async (hasProfile, hasPreferences, path) => {
      vi.mocked(getOnboardingStatus).mockResolvedValue({
        hasProfile,
        hasPreferences,
      });
      await expect(ComparePage(compareProps())).rejects.toThrow(
        `REDIRECT:${path}`,
      );
      expect(getDestinationComparisonForCurrentUser).not.toHaveBeenCalled();
    },
  );

  it("comparison offers a route to generate matches when there are no results", async () => {
    const html = renderToStaticMarkup(await ComparePage(compareProps()));
    expect(html).toContain("Find your matches before comparing places");
    expect(html).toContain(`href="${ROUTES.recommendations}"`);
    expect(html).not.toContain("<table");
  });

  it("comparison of alternatives asks for matches first when nothing is saved", async () => {
    const html = renderToStaticMarkup(
      await ComparePage(compareProps("alternatives")),
    );
    expect(html).toContain("Find your matches before comparing places");
    expect(html).not.toContain("No other places to compare");
    expect(html).not.toContain("could not find additional cities");
  });

  it("comparison uses the best matches by default", async () => {
    await ComparePage(compareProps());
    expect(getDestinationComparisonForCurrentUser).toHaveBeenCalledWith("best");
  });

  it("comparison follows the alternatives view and links back to it", async () => {
    // Recommendations exist, but no rank 6-10 city qualified.
    vi.mocked(getDestinationComparisonForCurrentUser).mockResolvedValue({
      rows: [],
      occupation: null,
      hasRecommendations: true,
    });
    const html = renderToStaticMarkup(
      await ComparePage(compareProps("alternatives")),
    );
    expect(getDestinationComparisonForCurrentUser).toHaveBeenCalledWith(
      "alternatives",
    );
    expect(html).toContain("Compare other places worth exploring");
    expect(html).toContain("No other places to compare");
    expect(html).toContain("could not find additional cities");
    expect(html).toContain('href="/recommendations?view=alternatives"');
    expect(html).not.toContain("Find your matches before comparing places");
  });

  it("comparison preserves supplied rank order and missing-data disclosures", async () => {
    vi.mocked(getDestinationComparisonForCurrentUser).mockResolvedValue({
      hasRecommendations: true,
      occupation: null,
      rows: [
        {
          cityId: "first",
          slug: "first",
          name: "First City",
          rank: 1,
          fitScore: 90,
          medianWage: null,
          employment: null,
          locationQuotient: null,
          medianRent: 1500,
          budgetDifference: 500,
        },
        {
          cityId: "second",
          slug: "second",
          name: "Second City",
          rank: 2,
          fitScore: 80,
          medianWage: null,
          employment: null,
          locationQuotient: null,
          medianRent: 1000,
          budgetDifference: 1000,
        },
      ],
    });
    const html = renderToStaticMarkup(await ComparePage(compareProps()));
    expect(html.indexOf("First City")).toBeLessThan(
      html.indexOf("Second City"),
    );
    expect(html).toContain("Confirm your occupation");
    expect(html).toContain("$1,500");
    expect(html).toContain('href="/recommendations/first"');
    expect(html).toContain("not an offer or an available");
  });
});

describe("workspace navigation", () => {
  it.each([
    [ROUTES.recommendations, ROUTES.recommendations],
    ["/recommendations/city-id", ROUTES.recommendations],
    [ROUTES.compare, ROUTES.compare],
    [ROUTES.advisor, ROUTES.advisor],
    [ROUTES.onboardingProfile, ROUTES.onboardingProfile],
    [ROUTES.onboardingPreferences, ROUTES.onboardingPreferences],
    [ROUTES.onboardingOccupation, ROUTES.onboardingOccupation],
  ])("marks exactly one active section for %s", (pathname, href) => {
    vi.mocked(usePathname).mockReturnValue(pathname);
    const html = renderToStaticMarkup(createElement(AppNavigation));
    const active = html.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? [];
    expect(active).toHaveLength(1);
    expect(active[0]).toContain(`href="${href}"`);
  });

  it("does not mark lookalike routes as active", () => {
    vi.mocked(usePathname).mockReturnValue("/recommendations-public");
    expect(renderToStaticMarkup(createElement(AppNavigation))).not.toContain(
      'aria-current="page"',
    );
  });

  it("uses a native collapsed disclosure for mobile with all six destinations", () => {
    vi.mocked(usePathname).mockReturnValue(ROUTES.compare);
    const html = renderToStaticMarkup(
      createElement(AppNavigation, { mobile: true }),
    );
    expect(html).toContain("<summary");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[=>\s])/);
    expect(html.match(/<a\b/g)).toHaveLength(6);
    expect(html).toContain('aria-label="Mobile workspace"');
  });
});
