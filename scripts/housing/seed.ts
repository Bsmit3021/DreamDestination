/**
 * Loads housing market statistics into Supabase.
 *
 *   npm run data:housing:seed
 *
 * Developer/CI task using the service-role key; never reachable from a request.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { ACS_PERIOD } from "../city-data/config";
import { PROCESSED_DIR, log } from "../city-data/shared";
import type { ProcessedHousingStat } from "./pipeline";

const HOUSING_SOURCE = {
  key: "acs-2023-5yr-housing",
  organization: "U.S. Census Bureau",
  dataset:
    "American Community Survey 5-Year Estimates — B25031 (median gross rent by bedrooms), B25077 (median home value)",
  url: "https://www2.census.gov/programs-surveys/acs/summary_file/2023/table-based-SF/data/5YRData",
  period: ACS_PERIOD,
  geography_level: "cbsa" as const,
  notes:
    "Rent figures are median gross rent (contract rent plus utilities) for " +
    "renter-occupied units, by bedroom count. Median home value covers " +
    "owner-occupied units. Both are period estimates for 2019-2023, not " +
    "current asking prices, and describe the market rather than any " +
    "available listing.",
};

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

  const stats: ProcessedHousingStat[] = JSON.parse(
    await readFile(path.join(PROCESSED_DIR, "housing-stats.json"), "utf8"),
  );

  const { error: sourceError } = await supabase.from("metric_sources").upsert(
    {
      ...HOUSING_SOURCE,
      retrieved_on: new Date().toISOString().slice(0, 10),
    },
    { onConflict: "key" },
  );
  if (sourceError) throw new Error(`metric_sources: ${sourceError.message}`);

  const { data: sourceRow, error: sourceReadError } = await supabase
    .from("metric_sources")
    .select("id")
    .eq("key", HOUSING_SOURCE.key)
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
    if (!cityId) {
      throw new Error(`No city row for CBSA ${stat.cbsaGeoid}`);
    }
    return {
      city_id: cityId,
      median_gross_rent: stat.medianGrossRent,
      studio_rent: stat.studioRent,
      one_bedroom_rent: stat.oneBedroomRent,
      two_bedroom_rent: stat.twoBedroomRent,
      three_bedroom_rent: stat.threeBedroomRent,
      four_bedroom_rent: stat.fourBedroomRent,
      median_home_value: stat.medianHomeValue,
      period: ACS_PERIOD,
      source_id: sourceRow.id,
    };
  });

  const { error } = await supabase
    .from("housing_market_stats")
    .upsert(payload, { onConflict: "city_id,period" });
  if (error) throw new Error(`housing_market_stats: ${error.message}`);

  log(`Seeded ${payload.length} housing records (${ACS_PERIOD}).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
