import "server-only";

import { requireUser } from "@/lib/auth/session";
import { getCurrentUserCareerTarget } from "@/lib/data/career-targets";
import { MissingProfileError } from "@/lib/data/errors";
import {
  loadCareerStats,
  loadCareerStatsForCities,
  loadHousingForCities,
  loadHousingStats,
} from "@/lib/data/opportunity";
import { getCurrentUserProfile } from "@/lib/data/profiles";
import { getStoredRecommendations } from "@/lib/data/recommendations";
import { compareBudget } from "@/lib/opportunity/calculations";
import type { DestinationOpportunity } from "@/lib/opportunity/types";

/**
 * Server-only orchestration for the opportunity layer.
 *
 * Accepts a city id — which is public reference data — and nothing else. The
 * user, their profile, their budget and their career target are all resolved
 * from the verified session, so a request cannot ask for another person's
 * personalised view.
 *
 * The Fit Score is read from the stored Phase 3 recommendation and passed
 * through untouched. Career and housing figures never influence it.
 */

export class DestinationNotRecommendedError extends Error {
  constructor(
    message = "That destination is not in your current recommendations.",
  ) {
    super(message);
    this.name = "DestinationNotRecommendedError";
  }
}

export async function getDestinationOpportunityForCurrentUser(
  cityId: string,
): Promise<DestinationOpportunity> {
  await requireUser();

  const profile = await getCurrentUserProfile();
  if (!profile) throw new MissingProfileError();

  // RLS scopes this to the caller's own rows, so a city id belonging to someone
  // else's recommendation set simply will not be found.
  const recommendations = await getStoredRecommendations();
  const recommendation = recommendations.find((r) => r.city.id === cityId);
  if (!recommendation) throw new DestinationNotRecommendedError();

  const careerTarget = await getCurrentUserCareerTarget();

  const career = careerTarget
    ? await loadCareerStats(cityId, careerTarget.socCode)
    : null;

  const housingBase = await loadHousingStats(cityId);
  const housing = housingBase
    ? {
        ...housingBase,
        // Overall median is the generic benchmark. Bedroom-specific figures are
        // shown separately rather than guessed at from household size.
        budgetComparison: compareBudget(
          profile.housingBudget,
          housingBase.medianGrossRent,
        ),
      }
    : null;

  return {
    city: {
      id: recommendation.city.id,
      slug: recommendation.city.slug,
      city: recommendation.city.city,
      state: recommendation.city.state,
      metro: recommendation.city.metro,
    },
    fit: {
      rank: recommendation.rank,
      score: recommendation.score,
      algorithmVersion: recommendation.algorithmVersion,
      dataCoverage: recommendation.reason.dataCoverage,
      reasons: recommendation.reason.reasons.map((r) => ({
        label: r.label,
        detail: r.detail,
      })),
      tradeoffs: recommendation.reason.tradeoffs.map((r) => ({
        label: r.label,
        detail: r.detail,
      })),
    },
    careerTarget: careerTarget
      ? { socCode: careerTarget.socCode, title: careerTarget.title }
      : null,
    career,
    housing,
  };
}

export interface DestinationComparisonRow {
  cityId: string;
  slug: string;
  name: string;
  rank: number;
  fitScore: number;
  medianWage: number | null;
  employment: number | null;
  locationQuotient: number | null;
  medianRent: number | null;
  budgetDifference: number | null;
}

/**
 * Side-by-side view of the user's recommendations.
 *
 * Ordering is the stored Phase 3 rank. Wages and rents are shown as columns,
 * never used to re-sort — re-ranking on salary would silently replace the
 * user's own stated priorities with ours.
 */
export async function getDestinationComparisonForCurrentUser(): Promise<{
  rows: DestinationComparisonRow[];
  occupation: { socCode: string; title: string } | null;
}> {
  await requireUser();

  const profile = await getCurrentUserProfile();
  if (!profile) throw new MissingProfileError();

  const recommendations = await getStoredRecommendations();
  if (recommendations.length === 0) {
    return { rows: [], occupation: null };
  }

  const cityIds = recommendations.map((r) => r.city.id);
  const careerTarget = await getCurrentUserCareerTarget();

  const [careerByCity, rentByCity] = await Promise.all([
    careerTarget
      ? loadCareerStatsForCities(cityIds, careerTarget.socCode)
      : Promise.resolve(new Map()),
    loadHousingForCities(cityIds),
  ]);

  const rows = recommendations
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((recommendation) => {
      const career = careerByCity.get(recommendation.city.id) ?? null;
      const rent = rentByCity.get(recommendation.city.id) ?? null;
      const comparison = compareBudget(profile.housingBudget, rent);

      return {
        cityId: recommendation.city.id,
        slug: recommendation.city.slug,
        name: `${recommendation.city.city}, ${recommendation.city.state}`,
        rank: recommendation.rank,
        fitScore: recommendation.score,
        medianWage: career?.median ?? null,
        employment: career?.employment ?? null,
        locationQuotient: career?.lq ?? null,
        medianRent: rent,
        budgetDifference: comparison?.difference ?? null,
      };
    });

  return {
    rows,
    occupation: careerTarget
      ? { socCode: careerTarget.socCode, title: careerTarget.title }
      : null,
  };
}
