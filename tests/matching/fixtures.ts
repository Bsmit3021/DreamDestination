import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import type {
  MetroOccupationStats,
  OccupationTarget,
} from "@/lib/matching/career";
import type { MetroSchoolStats } from "@/lib/matching/family";
import type {
  MetroLifestyleCategoryStat,
  MetroLifestyleStats,
} from "@/lib/matching/lifestyle";
import type { MetroSafetyStats } from "@/lib/matching/safety";
import type { MetroBedroomRents } from "@/lib/matching/housing";
import type {
  CandidateCity,
  MetricSourceRef,
  Personalization,
} from "@/lib/matching/types";
import type {
  PreferenceWeightKey,
  PreferenceWeights,
  Profile,
  LifestyleCategory,
} from "@/types/profile";

/**
 * The golden fixture: four synthetic cities with deliberately opposed
 * characteristics, chosen so every expected score can be worked out by hand.
 *
 * With four candidates and distinct values, mid-rank percentiles are always
 * 12.5 / 37.5 / 62.5 / 87.5, which makes the arithmetic in the tests checkable
 * on paper rather than merely reproducible.
 *
 *            rent    unemployment   mean temp
 *   Alpha     900        7.0%          45°F     cheap, weak jobs, cold
 *   Beta     2400        2.5%          52°F     expensive, strong jobs
 *   Gamma    1500        4.0%          57°F     balanced, ideal climate
 *   Delta    1800        6.0%          70°F     middling, hot
 */

export const TEST_SOURCE: MetricSourceRef = {
  key: "test-source",
  organization: "Test Organization",
  dataset: "Synthetic Fixture",
  url: "https://example.test/dataset",
  period: "2020-2024",
  geographyLevel: "cbsa",
};

interface FixtureSpec {
  id: string;
  slug: string;
  city: string;
  rent?: number;
  unemployment?: number;
  temperature?: number;
}

const METRIC_BY_DIMENSION: Partial<
  Record<PreferenceWeightKey, { key: string; unit: string }>
> = {
  housing: { key: "median_gross_rent", unit: "usd_per_month" },
  career: { key: "unemployment_rate", unit: "percent" },
  climate: { key: "annual_mean_temperature", unit: "degrees_fahrenheit" },
};

function buildCity(spec: FixtureSpec): CandidateCity {
  const observations: CandidateCity["observations"] = {};

  const add = (dimension: PreferenceWeightKey, value: number | undefined) => {
    if (value === undefined) return;
    const metric = METRIC_BY_DIMENSION[dimension];
    if (!metric) return;
    observations[dimension] = {
      metricKey: metric.key,
      dimension,
      rawValue: value,
      unit: metric.unit,
      source: TEST_SOURCE,
    };
  };

  add("housing", spec.rent);
  add("career", spec.unemployment);
  add("climate", spec.temperature);

  return {
    id: spec.id,
    slug: spec.slug,
    city: spec.city,
    state: "TX",
    metro: `${spec.city} Metro Area`,
    population: 1_000_000,
    latitude: 30,
    longitude: -97,
    observations,
  };
}

export const CITY_ALPHA = buildCity({
  id: "00000000-0000-4000-8000-00000000000a",
  slug: "alpha",
  city: "Alpha",
  rent: 900,
  unemployment: 7.0,
  temperature: 45,
});

export const CITY_BETA = buildCity({
  id: "00000000-0000-4000-8000-00000000000b",
  slug: "beta",
  city: "Beta",
  rent: 2400,
  unemployment: 2.5,
  temperature: 52,
});

export const CITY_GAMMA = buildCity({
  id: "00000000-0000-4000-8000-00000000000c",
  slug: "gamma",
  city: "Gamma",
  rent: 1500,
  unemployment: 4.0,
  temperature: 57,
});

export const CITY_DELTA = buildCity({
  id: "00000000-0000-4000-8000-00000000000d",
  slug: "delta",
  city: "Delta",
  rent: 1800,
  unemployment: 6.0,
  temperature: 70,
});

export const GOLDEN_CITIES: CandidateCity[] = [
  CITY_ALPHA,
  CITY_BETA,
  CITY_GAMMA,
  CITY_DELTA,
];

/** Weights with every dimension at zero, ready to be overridden. */
export function zeroWeights(): PreferenceWeights {
  return Object.fromEntries(
    PREFERENCE_WEIGHT_KEYS.map((key) => [key, 0]),
  ) as PreferenceWeights;
}

export function weightsWith(
  overrides: Partial<PreferenceWeights>,
): PreferenceWeights {
  return { ...zeroWeights(), ...overrides };
}

/**
 * A profile whose budget is high enough that the hard filter never fires, so
 * scoring tests observe scoring alone.
 *
 * `climatePreference` is set explicitly because the alternative — null — means
 * "no preference", which removes climate from the weighting altogether. Tests
 * that want that behaviour ask for it (see `legacyProfile`).
 */
export function testProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    ageRange: "25-34",
    householdIncome: 100_000,
    occupation: "Tester",
    relationshipStatus: "single",
    children: 0,
    householdSize: 1,
    currentCity: "Brooklyn",
    currentState: "NY",
    housingBudget: 10_000,
    desiredBedrooms: null,
    climatePreference: "mild",
    lifestylePreferences: null,
    workPreference: "remote",
    freeTextGoals: null,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * A profile as it exists for a user who onboarded before Phase 6A: both new
 * questions unanswered.
 */
export function legacyProfile(overrides: Partial<Profile> = {}): Profile {
  return testProfile({
    desiredBedrooms: null,
    climatePreference: null,
    ...overrides,
  });
}

/** The personalisation the scorer derives from a profile, for direct calls. */
export function personalizationFor(
  profile: Profile,
  occupation: OccupationTarget | null = null,
): Personalization {
  return {
    desiredBedrooms: profile.desiredBedrooms,
    climatePreference: profile.climatePreference,
    housingBudget: profile.housingBudget,
    occupation,
    lifestylePreferences: profile.lifestylePreferences,
  };
}

/** Attaches OEWS stats and/or bedroom rents to a candidate, for career tests. */
export function withMetroData(
  city: CandidateCity,
  data: {
    career?: Partial<MetroOccupationStats> | null;
    bedroomRents?: Partial<MetroBedroomRents> | null;
    safety?: Partial<MetroSafetyStats> | null;
    schools?: Partial<MetroSchoolStats> | null;
    /** category -> place count. Population comes from the city fixture. */
    lifestyle?: Partial<Record<LifestyleCategory, number>> | null;
  },
): CandidateCity {
  return {
    ...city,
    career:
      data.career === undefined
        ? city.career
        : data.career === null
          ? null
          : {
              socCode: "15-1252",
              title: "Software Developers",
              employment: null,
              employmentPer1000: null,
              locationQuotient: null,
              medianAnnualWage: null,
              wageTopCoded: false,
              period: "May 2025",
              source: TEST_SOURCE,
              ...data.career,
            },
    bedroomRents:
      data.bedroomRents === undefined
        ? city.bedroomRents
        : data.bedroomRents === null
          ? null
          : {
              studio: null,
              one: null,
              two: null,
              three: null,
              four: null,
              ...data.bedroomRents,
            },
    safety:
      data.safety === undefined
        ? city.safety
        : data.safety === null
          ? null
          : {
              fbiMetroName: `${city.city} M. S. A.`,
              dataYear: 2025,
              violentCrimeRate: null,
              propertyCrimeRate: null,
              sourcePopulation: 500_000,
              reportingCoverage: 1,
              isEstimated: false,
              source: TEST_SOURCE,
              ...data.safety,
            },
    schools:
      data.schools === undefined
        ? city.schools
        : data.schools === null
          ? null
          : {
              schoolYear: "2024-2025",
              publicSchoolCount: 0,
              schoolAgePopulation: null,
              populationPeriod: "2019-2023",
              source: TEST_SOURCE,
              ...data.schools,
            },
    lifestyle:
      data.lifestyle === undefined
        ? city.lifestyle
        : data.lifestyle === null
          ? null
          : ({
              sourceRelease: "2026-08-19.0",
              taxonomyMappingVersion: "2026-08-24.1",
              extractedOn: "2026-08-24",
              categories: (
                Object.entries(data.lifestyle) as [LifestyleCategory, number][]
              )
                .map(([category, placeCount]): MetroLifestyleCategoryStat => ({
                  category,
                  placeCount,
                  population: city.population ?? 500_000,
                  placesPer100k:
                    (placeCount / (city.population ?? 500_000)) * 100_000,
                }))
                .sort((a, b) => a.category.localeCompare(b.category)),
              source: TEST_SOURCE,
            } satisfies MetroLifestyleStats),
  };
}

/** Builds a city with an explicit set of observations, for targeted tests. */
export function cityWith(
  id: string,
  observations: Partial<Record<PreferenceWeightKey, number>>,
): CandidateCity {
  const built: CandidateCity["observations"] = {};

  for (const [dimension, value] of Object.entries(observations) as [
    PreferenceWeightKey,
    number,
  ][]) {
    const metric = METRIC_BY_DIMENSION[dimension];
    built[dimension] = {
      metricKey: metric?.key ?? `${dimension}_metric`,
      dimension,
      rawValue: value,
      unit: metric?.unit ?? "index",
      source: TEST_SOURCE,
    };
  }

  return {
    id,
    slug: `city-${id.slice(-4)}`,
    city: `City ${id.slice(-4)}`,
    state: "TX",
    metro: null,
    population: 500_000,
    latitude: 30,
    longitude: -97,
    observations: built,
  };
}
