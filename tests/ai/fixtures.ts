import type { DestinationOpportunity } from "@/lib/opportunity/types";
import type { PreferenceWeights } from "@/types/profile";
import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";

/**
 * Deterministic advisor fixtures.
 *
 * Built so the ranking-integrity case is unavoidable: Madison outranks Omaha
 * on Fit while Omaha pays more. Any implementation that lets wage drive rank
 * fails here.
 */

const BLS = {
  key: "bls-oews-may-2025",
  organization: "U.S. Bureau of Labor Statistics",
  dataset: "Occupational Employment and Wage Statistics (OEWS)",
  url: "https://www.bls.gov/oes/",
  period: "May 2025",
  geographyLevel: "cbsa",
};

const ACS = {
  key: "acs-2023-5yr",
  organization: "U.S. Census Bureau",
  dataset: "American Community Survey 5-Year Estimates",
  url: "https://www2.census.gov/",
  period: "2019-2023",
  geographyLevel: "cbsa",
};

export const MADISON: DestinationOpportunity = {
  city: {
    id: "city-madison",
    slug: "madison-wi",
    city: "Madison",
    state: "WI",
    metro: "Madison, WI",
  },
  fit: {
    rank: 1,
    score: 81,
    algorithmVersion: "v1",
    dataCoverage: 0.76,
    reasons: [
      {
        label: "Cost of living",
        detail:
          "Rent burden 27.0% — scores 92/100 against the other candidates.",
      },
    ],
    tradeoffs: [
      {
        label: "Climate",
        detail: "Annual mean temperature 47.0°F — scores 50/100.",
      },
    ],
  },
  careerTarget: { socCode: "15-1252", title: "Software Developers" },
  career: {
    occupation: { socCode: "15-1252", title: "Software Developers" },
    employment: 4_120,
    employmentPer1000: 11.2,
    locationQuotient: 1.03,
    wages: {
      availability: "published",
      meanAnnual: 108_400,
      medianAnnual: 104_900,
      percentile25: 84_100,
      percentile75: 131_600,
      topCodeAnnual: null,
    },
    period: "May 2025",
    source: BLS,
  },
  housing: {
    medianGrossRent: 1_310,
    bedrooms: {
      studio: 980,
      one: 1_120,
      two: 1_390,
      three: 1_720,
      four: 2_010,
    },
    medianHomeValue: 372_000,
    budgetComparison: {
      monthlyBudget: 3_600,
      benchmarkRent: 1_310,
      difference: 2_290,
      benchmarkPercentOfBudget: 36.39,
    },
    period: "2019-2023",
    source: ACS,
  },
};

/** Ranked below Madison, but pays more — the integrity case. */
export const OMAHA: DestinationOpportunity = {
  city: {
    id: "city-omaha",
    slug: "omaha-ne",
    city: "Omaha",
    state: "NE",
    metro: "Omaha, NE",
  },
  fit: {
    rank: 2,
    score: 80,
    algorithmVersion: "v1",
    dataCoverage: 0.76,
    reasons: [
      {
        label: "Career opportunity",
        detail: "Unemployment rate 3.4% — scores 97/100.",
      },
    ],
    tradeoffs: [
      {
        label: "Education",
        detail: "Bachelor's or higher 39.1% — scores 70/100.",
      },
    ],
  },
  careerTarget: { socCode: "15-1252", title: "Software Developers" },
  career: {
    occupation: { socCode: "15-1252", title: "Software Developers" },
    employment: 5_680,
    employmentPer1000: 11.9,
    locationQuotient: 1.09,
    wages: {
      availability: "published",
      // Higher than Madison on purpose.
      meanAnnual: 118_900,
      medianAnnual: 115_300,
      percentile25: 91_200,
      percentile75: 142_800,
      topCodeAnnual: null,
    },
    period: "May 2025",
    source: BLS,
  },
  housing: {
    medianGrossRent: 1_180,
    bedrooms: {
      studio: 890,
      one: 1_010,
      two: 1_260,
      three: 1_540,
      four: 1_820,
    },
    medianHomeValue: 268_000,
    budgetComparison: {
      monthlyBudget: 3_600,
      benchmarkRent: 1_180,
      difference: 2_420,
      benchmarkPercentOfBudget: 32.78,
    },
    period: "2019-2023",
    source: ACS,
  },
};

/** BLS suppressed the wage here ("*"). Must never read as zero. */
export const DES_MOINES: DestinationOpportunity = {
  city: {
    id: "city-des-moines",
    slug: "des-moines-ia",
    city: "Des Moines",
    state: "IA",
    metro: "Des Moines, IA",
  },
  fit: {
    rank: 3,
    score: 78,
    algorithmVersion: "v1",
    dataCoverage: 0.7,
    reasons: [
      {
        label: "Housing",
        detail: "Median gross rent $1,113/mo — scores 72/100.",
      },
    ],
    tradeoffs: [],
  },
  careerTarget: { socCode: "15-1252", title: "Software Developers" },
  career: {
    occupation: { socCode: "15-1252", title: "Software Developers" },
    employment: 2_340,
    employmentPer1000: 7.1,
    locationQuotient: 0.6,
    wages: {
      availability: "not_released",
      meanAnnual: null,
      medianAnnual: null,
      percentile25: null,
      percentile75: null,
      topCodeAnnual: null,
    },
    period: "May 2025",
    source: BLS,
  },
  housing: {
    medianGrossRent: 1_113,
    bedrooms: { studio: 820, one: 950, two: 1_180, three: 1_450, four: 1_690 },
    medianHomeValue: 241_000,
    budgetComparison: {
      monthlyBudget: 3_600,
      benchmarkRent: 1_113,
      difference: 2_487,
      benchmarkPercentOfBudget: 30.92,
    },
    period: "2019-2023",
    source: ACS,
  },
};

/** Top-coded wage ("#"): a lower bound, never an exact figure. */
export const SAN_JOSE: DestinationOpportunity = {
  city: {
    id: "city-san-jose",
    slug: "san-jose-ca",
    city: "San Jose",
    state: "CA",
    metro: "San Jose, CA",
  },
  fit: {
    rank: 4,
    score: 61,
    algorithmVersion: "v1",
    dataCoverage: 0.76,
    reasons: [],
    tradeoffs: [
      {
        label: "Housing",
        detail: "Median gross rent $2,794/mo — scores 12/100.",
      },
    ],
  },
  careerTarget: { socCode: "15-1252", title: "Software Developers" },
  career: {
    occupation: { socCode: "15-1252", title: "Software Developers" },
    employment: 61_400,
    employmentPer1000: 58.3,
    locationQuotient: 5.4,
    wages: {
      availability: "top_coded",
      meanAnnual: null,
      medianAnnual: null,
      percentile25: null,
      percentile75: null,
      topCodeAnnual: 239_200,
    },
    period: "May 2025",
    source: BLS,
  },
  housing: {
    medianGrossRent: 2_794,
    bedrooms: {
      studio: 2_010,
      one: 2_390,
      two: 2_910,
      three: 3_540,
      four: 4_120,
    },
    medianHomeValue: 1_420_000,
    budgetComparison: {
      monthlyBudget: 3_600,
      benchmarkRent: 2_794,
      difference: 806,
      benchmarkPercentOfBudget: 77.61,
    },
    period: "2019-2023",
    source: ACS,
  },
};

export const DESTINATIONS = [MADISON, OMAHA, DES_MOINES, SAN_JOSE];

export function testWeights(): PreferenceWeights {
  const base = Object.fromEntries(
    PREFERENCE_WEIGHT_KEYS.map((key) => [key, 0]),
  ) as PreferenceWeights;
  return { ...base, career: 0.9, housing: 0.8, cost: 0.7, education: 0.4 };
}
