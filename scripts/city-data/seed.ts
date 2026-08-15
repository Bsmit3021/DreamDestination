/**
 * Step 4: load the canonical dataset into Supabase.
 *
 * Runs with the service-role key because `cities`, `city_metric_observations`
 * and `metric_sources` intentionally grant no write access to users. This is a
 * developer/CI task, never something a request can trigger.
 *
 *   npm run data:seed
 */

import { readFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { SOURCES } from "./config";
import type { ProcessedCity, ProcessedObservation } from "./transform";
import { CITIES_FILE, OBSERVATIONS_FILE, log } from "./shared";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in, ` +
        "then run this script with the environment loaded.",
    );
  }
  return value;
}

async function main(): Promise<void> {
  const supabase = createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const cities: ProcessedCity[] = JSON.parse(
    await readFile(CITIES_FILE, "utf8"),
  );
  const observations: ProcessedObservation[] = JSON.parse(
    await readFile(OBSERVATIONS_FILE, "utf8"),
  );

  // --- sources -------------------------------------------------------------

  const today = new Date().toISOString().slice(0, 10);

  const { error: sourceError } = await supabase.from("metric_sources").upsert(
    Object.values(SOURCES).map((source) => ({
      key: source.key,
      organization: source.organization,
      dataset: source.dataset,
      url: source.url,
      period: source.period,
      retrieved_on: today,
      geography_level: source.geographyLevel,
      notes: source.notes,
    })),
    { onConflict: "key" },
  );
  if (sourceError) throw new Error(`metric_sources: ${sourceError.message}`);

  const { data: sourceRows, error: sourceReadError } = await supabase
    .from("metric_sources")
    .select("id, key");
  if (sourceReadError) throw new Error(sourceReadError.message);

  const sourceIdByKey = new Map(sourceRows.map((row) => [row.key, row.id]));

  // --- cities --------------------------------------------------------------

  const { error: cityError } = await supabase.from("cities").upsert(
    cities.map((city) => ({
      slug: city.slug,
      city: city.city,
      state: city.state,
      metro: city.metro,
      population: city.population,
      latitude: city.latitude,
      longitude: city.longitude,
    })),
    { onConflict: "slug" },
  );
  if (cityError) throw new Error(`cities: ${cityError.message}`);

  const { data: cityRows, error: cityReadError } = await supabase
    .from("cities")
    .select("id, slug");
  if (cityReadError) throw new Error(cityReadError.message);

  const cityIdBySlug = new Map(cityRows.map((row) => [row.slug, row.id]));

  // --- observations --------------------------------------------------------

  const payload = observations.map((observation) => {
    const cityId = cityIdBySlug.get(observation.citySlug);
    const sourceId = sourceIdByKey.get(observation.sourceKey);

    if (!cityId) {
      throw new Error(`No city row for slug ${observation.citySlug}`);
    }
    if (!sourceId) {
      throw new Error(`No source row for key ${observation.sourceKey}`);
    }

    return {
      city_id: cityId,
      metric_key: observation.metricKey,
      dimension: observation.dimension,
      raw_value: observation.rawValue,
      unit: observation.unit,
      source_id: sourceId,
    };
  });

  // Chunked so a large universe does not exceed the request size limit.
  const CHUNK = 500;
  for (let index = 0; index < payload.length; index += CHUNK) {
    const { error } = await supabase
      .from("city_metric_observations")
      .upsert(payload.slice(index, index + CHUNK), {
        onConflict: "city_id,metric_key",
      });
    if (error) throw new Error(`city_metric_observations: ${error.message}`);
  }

  log(
    `Seeded ${cities.length} cities, ${payload.length} observations, ` +
      `${Object.keys(SOURCES).length} sources.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
