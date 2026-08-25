/**
 * Loads metro lifestyle statistics into Supabase.
 *
 *   npm run data:lifestyle:seed
 *
 * Developer/CI task using the service-role key; never reachable from a request.
 *
 * Only derived per-metro, per-category counts are stored. No raw Overture place
 * record is ever persisted.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { OVERTURE_RELEASE, SOURCES } from "../city-data/config";
import { PROCESSED_DIR, log } from "../city-data/shared";
import type { ProcessedLifestyleStat } from "./pipeline";

type LifestyleCategory = Database["public"]["Enums"]["lifestyle_category"];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main(): Promise<void> {
  const supabase = createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const stats: ProcessedLifestyleStat[] = JSON.parse(
    await readFile(path.join(PROCESSED_DIR, "lifestyle-stats.json"), "utf8"),
  );

  const { error: sourceError } = await supabase.from("metric_sources").upsert(
    {
      key: SOURCES.overture.key,
      organization: SOURCES.overture.organization,
      dataset: SOURCES.overture.dataset,
      url: SOURCES.overture.url,
      period: SOURCES.overture.period,
      geography_level: SOURCES.overture.geographyLevel,
      notes: `${SOURCES.overture.notes} License: ${SOURCES.overture.license}. Attribution: ${SOURCES.overture.attribution}.`,
      retrieved_on: new Date().toISOString().slice(0, 10),
    },
    { onConflict: "key" },
  );
  if (sourceError) throw new Error(`metric_sources: ${sourceError.message}`);

  const { data: sourceRow, error: sourceReadError } = await supabase
    .from("metric_sources")
    .select("id")
    .eq("key", SOURCES.overture.key)
    .single();
  if (sourceReadError) throw new Error(sourceReadError.message);

  const { data: cityRows, error: cityError } = await supabase
    .from("cities")
    .select("id, cbsa_geoid")
    .not("cbsa_geoid", "is", null);
  if (cityError) throw new Error(cityError.message);

  const cityIdByCbsa = new Map(
    (cityRows ?? []).map((row) => [row.cbsa_geoid as string, row.id]),
  );

  const payload = stats.map((stat) => {
    const cityId = cityIdByCbsa.get(stat.cbsaGeoid);
    if (!cityId) throw new Error(`No city row for CBSA ${stat.cbsaGeoid}`);

    return {
      city_id: cityId,
      category: stat.category as LifestyleCategory,
      place_count: stat.placeCount,
      population: stat.population,
      places_per_100k: stat.placesPer100k,
      source_release: stat.sourceRelease,
      taxonomy_mapping_version: stat.taxonomyMappingVersion,
      extracted_on: stat.extractedOn,
      source_id: sourceRow.id,
    };
  });

  // Full replace for this release, so a metro or category dropped by a later
  // Overture release cannot survive as a stale row.
  const { error: deleteError } = await supabase
    .from("metro_lifestyle_stats")
    .delete()
    .eq("source_release", OVERTURE_RELEASE);
  if (deleteError) {
    throw new Error(`metro_lifestyle_stats: ${deleteError.message}`);
  }

  const { error } = await supabase
    .from("metro_lifestyle_stats")
    .insert(payload);
  if (error) throw new Error(`metro_lifestyle_stats: ${error.message}`);

  log(
    `Seeded ${payload.length} metro lifestyle records (Overture ${OVERTURE_RELEASE}).`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
