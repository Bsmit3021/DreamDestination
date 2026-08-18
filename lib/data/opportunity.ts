import "server-only";

import { DataAccessError } from "@/lib/data/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MetricSourceRef } from "@/lib/matching/types";
import type {
  CareerIntelligence,
  HousingIntelligence,
} from "@/lib/opportunity/types";

/**
 * Reads of career and housing reference data.
 *
 * These tables are world-readable reference data, so the ordinary
 * session-scoped client is used. No elevated credential is involved anywhere in
 * the request path.
 */

interface SourceRow {
  key: string;
  organization: string;
  dataset: string;
  url: string;
  period: string;
  geography_level: string;
}

function toSourceRef(row: SourceRow | null): MetricSourceRef | null {
  if (!row) return null;
  return {
    key: row.key,
    organization: row.organization,
    dataset: row.dataset,
    url: row.url,
    period: row.period,
    geographyLevel: row.geography_level,
  };
}

/** Career statistics for one metro and one occupation. */
export async function loadCareerStats(
  cityId: string,
  socCode: string,
): Promise<CareerIntelligence | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("metro_occupation_stats")
    .select(
      `employment, employment_per_1000, location_quotient, mean_annual_wage,
       median_annual_wage, p25_annual_wage, p75_annual_wage, wage_top_coded,
       period,
       occupations ( soc_code, title ),
       metric_sources ( key, organization, dataset, url, period, geography_level )`,
    )
    .eq("city_id", cityId)
    .eq("soc_code", socCode)
    .maybeSingle();

  if (error) {
    throw new DataAccessError("Could not load career statistics.", {
      cause: error,
    });
  }
  if (!data) return null;

  const row = data as unknown as {
    employment: number | null;
    employment_per_1000: number | null;
    location_quotient: number | null;
    mean_annual_wage: number | null;
    median_annual_wage: number | null;
    p25_annual_wage: number | null;
    p75_annual_wage: number | null;
    wage_top_coded: boolean;
    period: string;
    occupations: { soc_code: string; title: string } | null;
    metric_sources: SourceRow | null;
  };

  // Three distinct reasons a wage can be absent; the UI must not conflate them.
  const availability = row.wage_top_coded
    ? "top_coded"
    : row.median_annual_wage === null && row.mean_annual_wage === null
      ? "not_released"
      : "published";

  return {
    occupation: {
      socCode: row.occupations?.soc_code ?? socCode,
      title: row.occupations?.title ?? socCode,
    },
    employment: row.employment,
    employmentPer1000: row.employment_per_1000,
    locationQuotient: row.location_quotient,
    wages: {
      availability,
      meanAnnual: row.mean_annual_wage,
      medianAnnual: row.median_annual_wage,
      percentile25: row.p25_annual_wage,
      percentile75: row.p75_annual_wage,
      // The published May 2025 top code. Only shown when availability says so.
      topCodeAnnual: row.wage_top_coded ? 239_200 : null,
    },
    period: row.period,
    source: toSourceRef(row.metric_sources),
  };
}

/** Housing statistics for one metro, before any budget comparison. */
export async function loadHousingStats(
  cityId: string,
): Promise<Omit<HousingIntelligence, "budgetComparison"> | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("housing_market_stats")
    .select(
      `median_gross_rent, studio_rent, one_bedroom_rent, two_bedroom_rent,
       three_bedroom_rent, four_bedroom_rent, median_home_value, period,
       metric_sources ( key, organization, dataset, url, period, geography_level )`,
    )
    .eq("city_id", cityId)
    .maybeSingle();

  if (error) {
    throw new DataAccessError("Could not load housing statistics.", {
      cause: error,
    });
  }
  if (!data) return null;

  const row = data as unknown as {
    median_gross_rent: number | null;
    studio_rent: number | null;
    one_bedroom_rent: number | null;
    two_bedroom_rent: number | null;
    three_bedroom_rent: number | null;
    four_bedroom_rent: number | null;
    median_home_value: number | null;
    period: string;
    metric_sources: SourceRow | null;
  };

  return {
    medianGrossRent: row.median_gross_rent,
    bedrooms: {
      studio: row.studio_rent,
      one: row.one_bedroom_rent,
      two: row.two_bedroom_rent,
      three: row.three_bedroom_rent,
      four: row.four_bedroom_rent,
    },
    medianHomeValue: row.median_home_value,
    period: row.period,
    source: toSourceRef(row.metric_sources),
  };
}

/** Career stats for one occupation across many metros, for the comparison view. */
export async function loadCareerStatsForCities(
  cityIds: readonly string[],
  socCode: string,
): Promise<
  Map<
    string,
    { median: number | null; employment: number | null; lq: number | null }
  >
> {
  if (cityIds.length === 0) return new Map();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("metro_occupation_stats")
    .select("city_id, median_annual_wage, employment, location_quotient")
    .in("city_id", [...cityIds])
    .eq("soc_code", socCode);

  if (error) {
    throw new DataAccessError("Could not load career comparison.", {
      cause: error,
    });
  }

  return new Map(
    (data ?? []).map((row) => [
      row.city_id as string,
      {
        median: row.median_annual_wage as number | null,
        employment: row.employment as number | null,
        lq: row.location_quotient as number | null,
      },
    ]),
  );
}

/** Rent benchmarks for many metros, for the comparison view. */
export async function loadHousingForCities(
  cityIds: readonly string[],
): Promise<Map<string, number | null>> {
  if (cityIds.length === 0) return new Map();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("housing_market_stats")
    .select("city_id, median_gross_rent")
    .in("city_id", [...cityIds]);

  if (error) {
    throw new DataAccessError("Could not load housing comparison.", {
      cause: error,
    });
  }

  return new Map(
    (data ?? []).map((row) => [
      row.city_id as string,
      row.median_gross_rent as number | null,
    ]),
  );
}
