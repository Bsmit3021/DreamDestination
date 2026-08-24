/**
 * Loads FBI metro safety statistics into Supabase.
 *
 *   npm run data:safety:seed
 *
 * Developer/CI task using the service-role key; never reachable from a request.
 *
 * Only metros the FBI actually published are inserted. A metro absent from
 * Table 6 gets no row at all, so missing crime data stays missing rather than
 * arriving as a zero.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { FBI_CIUS_YEAR, SOURCES } from "../city-data/config";
import { PROCESSED_DIR, log } from "../city-data/shared";
import type { ProcessedSafetyStat } from "./pipeline";

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

  const stats: ProcessedSafetyStat[] = JSON.parse(
    await readFile(path.join(PROCESSED_DIR, "safety-stats.json"), "utf8"),
  );

  const { error: sourceError } = await supabase.from("metric_sources").upsert(
    {
      key: SOURCES.fbi.key,
      organization: SOURCES.fbi.organization,
      dataset: SOURCES.fbi.dataset,
      url: SOURCES.fbi.url,
      period: SOURCES.fbi.period,
      geography_level: SOURCES.fbi.geographyLevel,
      notes: SOURCES.fbi.notes,
      retrieved_on: new Date().toISOString().slice(0, 10),
    },
    { onConflict: "key" },
  );
  if (sourceError) throw new Error(`metric_sources: ${sourceError.message}`);

  const { data: sourceRow, error: sourceReadError } = await supabase
    .from("metric_sources")
    .select("id")
    .eq("key", SOURCES.fbi.key)
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
      fbi_metro_name: stat.fbiMetroName,
      data_year: stat.dataYear,
      violent_crime_rate: stat.violentCrimeRate,
      property_crime_rate: stat.propertyCrimeRate,
      source_population: stat.sourcePopulation,
      reporting_coverage: stat.reportingCoverage,
      is_estimated: stat.isEstimated,
      source_id: sourceRow.id,
    };
  });

  // Full replace for this data year, so a metro dropped by a later FBI release
  // cannot survive as a stale row.
  const { error: deleteError } = await supabase
    .from("metro_safety_stats")
    .delete()
    .eq("data_year", FBI_CIUS_YEAR);
  if (deleteError)
    throw new Error(`metro_safety_stats: ${deleteError.message}`);

  const { error } = await supabase.from("metro_safety_stats").insert(payload);
  if (error) throw new Error(`metro_safety_stats: ${error.message}`);

  log(`Seeded ${payload.length} metro safety records (FBI ${FBI_CIUS_YEAR}).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
