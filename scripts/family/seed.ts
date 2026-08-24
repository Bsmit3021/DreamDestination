/**
 * Loads NCES public-school counts and the ACS school-age denominator into
 * Supabase.
 *
 *   npm run data:family:seed
 *
 * Developer/CI task using the service-role key; never reachable from a request.
 *
 * These rows describe how many public schools a metro has, not how good they
 * are. Nothing downstream may present them as a quality measure.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { NCES_SCHOOL_YEAR, SOURCES } from "../city-data/config";
import { PROCESSED_DIR, log } from "../city-data/shared";
import type { ProcessedSchoolStat } from "./pipeline";

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

  const stats: ProcessedSchoolStat[] = JSON.parse(
    await readFile(path.join(PROCESSED_DIR, "school-stats.json"), "utf8"),
  );

  const { error: sourceError } = await supabase.from("metric_sources").upsert(
    {
      key: SOURCES.nces.key,
      organization: SOURCES.nces.organization,
      dataset: SOURCES.nces.dataset,
      url: SOURCES.nces.url,
      period: SOURCES.nces.period,
      geography_level: SOURCES.nces.geographyLevel,
      notes: SOURCES.nces.notes,
      retrieved_on: new Date().toISOString().slice(0, 10),
    },
    { onConflict: "key" },
  );
  if (sourceError) throw new Error(`metric_sources: ${sourceError.message}`);

  const { data: sourceRow, error: sourceReadError } = await supabase
    .from("metric_sources")
    .select("id")
    .eq("key", SOURCES.nces.key)
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
      school_year: stat.schoolYear,
      public_school_count: stat.publicSchoolCount,
      school_age_population: stat.schoolAgePopulation,
      population_period: stat.populationPeriod,
      source_id: sourceRow.id,
    };
  });

  // Full replace for this school year, so a metro dropped by a later NCES
  // collection cannot survive as a stale row.
  const { error: deleteError } = await supabase
    .from("metro_school_stats")
    .delete()
    .eq("school_year", NCES_SCHOOL_YEAR);
  if (deleteError)
    throw new Error(`metro_school_stats: ${deleteError.message}`);

  const { error } = await supabase.from("metro_school_stats").insert(payload);
  if (error) throw new Error(`metro_school_stats: ${error.message}`);

  log(`Seeded ${payload.length} metro school records (${NCES_SCHOOL_YEAR}).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
