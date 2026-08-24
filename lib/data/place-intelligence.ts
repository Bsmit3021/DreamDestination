import "server-only";

import { DataAccessError } from "@/lib/data/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MetroSchoolStats } from "@/lib/matching/family";
import type { MetroSafetyStats } from "@/lib/matching/safety";
import type { MetricSourceRef } from "@/lib/matching/types";

/**
 * Loaders for the Phase 6B metro reference datasets.
 *
 * Both are public canonical data, read through the ordinary session-scoped
 * client exactly like cities and observations. No elevated privilege is
 * involved: RLS grants `select` to anon and authenticated, and nothing in the
 * request path may write to either table.
 *
 * A metro missing from a returned map has no published data. Callers must
 * treat that as absence — never as a zero, and never as a national average.
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

/** FBI metro crime rates, keyed by city id. */
export async function loadSafetyStatsForScoring(): Promise<
  Map<string, MetroSafetyStats>
> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.from("metro_safety_stats").select(
    `city_id, fbi_metro_name, data_year, violent_crime_rate,
       property_crime_rate, source_population, reporting_coverage, is_estimated,
       metric_sources ( key, organization, dataset, url, period, geography_level )`,
  );

  if (error) {
    throw new DataAccessError("Could not load metro safety statistics.", {
      cause: error,
    });
  }

  const rows = (data ?? []) as unknown as {
    city_id: string;
    fbi_metro_name: string;
    data_year: number;
    violent_crime_rate: number | null;
    property_crime_rate: number | null;
    source_population: number | null;
    reporting_coverage: number | null;
    is_estimated: boolean;
    metric_sources: SourceRow | null;
  }[];

  return new Map(
    rows.map((row) => [
      row.city_id,
      {
        fbiMetroName: row.fbi_metro_name,
        dataYear: row.data_year,
        violentCrimeRate: row.violent_crime_rate,
        propertyCrimeRate: row.property_crime_rate,
        sourcePopulation: row.source_population,
        reportingCoverage: row.reporting_coverage,
        isEstimated: row.is_estimated,
        source: toSourceRef(row.metric_sources),
      } satisfies MetroSafetyStats,
    ]),
  );
}

/** NCES public-school counts and the ACS denominator, keyed by city id. */
export async function loadSchoolStatsForScoring(): Promise<
  Map<string, MetroSchoolStats>
> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.from("metro_school_stats").select(
    `city_id, school_year, public_school_count, school_age_population,
       population_period,
       metric_sources ( key, organization, dataset, url, period, geography_level )`,
  );

  if (error) {
    throw new DataAccessError("Could not load metro school statistics.", {
      cause: error,
    });
  }

  const rows = (data ?? []) as unknown as {
    city_id: string;
    school_year: string;
    public_school_count: number;
    school_age_population: number | null;
    population_period: string;
    metric_sources: SourceRow | null;
  }[];

  return new Map(
    rows.map((row) => [
      row.city_id,
      {
        schoolYear: row.school_year,
        publicSchoolCount: row.public_school_count,
        schoolAgePopulation: row.school_age_population,
        populationPeriod: row.population_period,
        source: toSourceRef(row.metric_sources),
      } satisfies MetroSchoolStats,
    ]),
  );
}
