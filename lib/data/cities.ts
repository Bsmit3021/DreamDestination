import "server-only";

import { DIMENSIONS } from "@/lib/matching/dimensions";
import { DataAccessError } from "@/lib/data/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CandidateCity, MetricSourceRef } from "@/lib/matching/types";
import type { PreferenceWeightKey, UsStateCode } from "@/types/profile";

/**
 * Loads the candidate city universe together with its raw observations.
 *
 * Read through the ordinary server client: cities, observations and sources are
 * public reference data, so no elevated privilege is needed to read them.
 *
 * Observations whose metric key does not match the registry are dropped rather
 * than scored. A stale row left behind by an older pipeline run must not be
 * silently fed into a dimension it no longer represents.
 */

interface SourceRow {
  key: string;
  organization: string;
  dataset: string;
  url: string;
  period: string;
  geography_level: string;
}

interface ObservationRow {
  metric_key: string;
  dimension: string;
  raw_value: number;
  unit: string;
  metric_sources: SourceRow | null;
}

interface CityRow {
  id: string;
  slug: string;
  city: string;
  state: string;
  metro: string | null;
  population: number | null;
  latitude: number;
  longitude: number;
  city_metric_observations: ObservationRow[];
}

function toSourceRef(row: SourceRow): MetricSourceRef {
  return {
    key: row.key,
    organization: row.organization,
    dataset: row.dataset,
    url: row.url,
    period: row.period,
    geographyLevel: row.geography_level,
  };
}

function toCandidateCity(row: CityRow): CandidateCity {
  const observations: CandidateCity["observations"] = {};

  for (const observation of row.city_metric_observations) {
    const dimension = observation.dimension as PreferenceWeightKey;
    const definition = DIMENSIONS[dimension];

    // Unknown dimension, unscored dimension, or a metric the registry no
    // longer recognises: skip rather than guess.
    if (!definition?.metric) continue;
    if (definition.metric.key !== observation.metric_key) continue;
    if (!observation.metric_sources) continue;
    if (!Number.isFinite(observation.raw_value)) continue;

    observations[dimension] = {
      metricKey: observation.metric_key,
      dimension,
      rawValue: observation.raw_value,
      unit: observation.unit,
      source: toSourceRef(observation.metric_sources),
    };
  }

  return {
    id: row.id,
    slug: row.slug,
    city: row.city,
    // `state` is a Postgres DOMAIN over text, so generated types widen it.
    // The domain's CHECK constraint is the real guarantee.
    state: row.state as UsStateCode,
    metro: row.metro,
    population: row.population,
    latitude: row.latitude,
    longitude: row.longitude,
    observations,
  };
}

/** Every city that has at least one usable observation. */
export async function loadCandidateCities(): Promise<CandidateCity[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("cities")
    .select(
      `id, slug, city, state, metro, population, latitude, longitude,
       city_metric_observations (
         metric_key, dimension, raw_value, unit,
         metric_sources ( key, organization, dataset, url, period, geography_level )
       )`,
    )
    // Stable ordering so a tie between identical scores resolves the same way
    // on every run, regardless of what the planner returns first.
    .order("id", { ascending: true });

  if (error) {
    throw new DataAccessError("Could not load candidate cities.", {
      cause: error,
    });
  }

  return (data as unknown as CityRow[])
    .map(toCandidateCity)
    .filter((city) => Object.keys(city.observations).length > 0);
}
