/**
 * Step 4 of the career pipeline: load career statistics into Supabase.
 *
 *   npm run data:career:seed
 *
 * Developer/CI task. Uses the service-role key because reference tables grant
 * no write access to users; this is never reachable from a request.
 */

import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { PROCESSED_DIR, log } from "../city-data/shared";
import { SeedRequestError, withSeedRetry } from "../shared/retry";
import { OEWS_PERIOD } from "../city-data/config";
import type { ProcessedCareerStat } from "./transform";

const OEWS_SOURCE = {
  key: "bls-oews-may-2025",
  organization: "U.S. Bureau of Labor Statistics",
  dataset:
    "Occupational Employment and Wage Statistics (OEWS), metropolitan area estimates",
  url: "https://www.bls.gov/oes/special-requests/oesm25ma.zip",
  period: OEWS_PERIOD,
  geography_level: "cbsa" as const,
  notes:
    "Cross-industry, detailed-occupation estimates for metropolitan areas. " +
    "Employment is total jobs in the occupation, not job openings. Location " +
    "quotient measures local concentration relative to the national average, " +
    "not an individual's hiring probability. Suppressed values (* and **) are " +
    "stored as NULL; '#' means the wage is at or above $239,200/yr and sets " +
    "wage_top_coded. Archive sha256 " +
    "cc3e6fa80edf64ab8fd0e8a6472ef1b513a6bcaef2f5018e9649c485793b0b99.",
};

/**
 * Reads the career statistics, preferring the uncompressed build artefact and
 * falling back to the committed gzip.
 *
 * The 12 MB JSON is a local build product and is gitignored; the 1.3 MB gzip
 * beside it is committed. That asymmetry exists because BLS blocks automated
 * download of the archive the JSON is derived from, so a fresh clone — or a
 * production bootstrap — has no way to regenerate it. Without the committed
 * copy, career data could not be seeded at all and every user would silently
 * fall back to the metro-wide labour market.
 */
async function readCareerStats(): Promise<ProcessedCareerStat[]> {
  const plain = path.join(PROCESSED_DIR, "career-stats.json");
  const compressed = `${plain}.gz`;

  try {
    return JSON.parse(await readFile(plain, "utf8")) as ProcessedCareerStat[];
  } catch {
    // Not a fallback for a corrupt file: only for a clone that never built it.
  }

  try {
    const bytes = await readFile(compressed);
    return JSON.parse(
      gunzipSync(bytes).toString("utf8"),
    ) as ProcessedCareerStat[];
  } catch (error) {
    throw new Error(
      `Could not read career statistics from ${plain} or ${compressed}. ` +
        `Run \`npm run data:career:extract && npm run data:career:transform\` ` +
        `(needs data/raw/oesm25ma.zip, which BLS only serves to a browser). ` +
        `Cause: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

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

  const stats: ProcessedCareerStat[] = await readCareerStats();

  const { error: sourceError } = await supabase
    .from("metric_sources")
    .upsert(
      { ...OEWS_SOURCE, retrieved_on: new Date().toISOString().slice(0, 10) },
      { onConflict: "key" },
    );
  if (sourceError) throw new Error(`metric_sources: ${sourceError.message}`);

  const { data: sourceRow, error: sourceReadError } = await supabase
    .from("metric_sources")
    .select("id")
    .eq("key", OEWS_SOURCE.key)
    .single();
  if (sourceReadError) throw new Error(sourceReadError.message);

  // Join to city ids by CBSA code — the same identifier the transform used.
  const { data: cityRows, error: cityError } = await supabase
    .from("cities")
    .select("id, cbsa_geoid")
    .not("cbsa_geoid", "is", null);
  if (cityError) throw new Error(cityError.message);

  const cityIdByCbsa = new Map(
    (cityRows ?? []).map((row) => [row.cbsa_geoid as string, row.id]),
  );

  const payload = stats
    .map((stat) => {
      const cityId = cityIdByCbsa.get(stat.cbsaGeoid);
      if (!cityId) return null;
      return {
        city_id: cityId,
        soc_code: stat.socCode,
        employment: stat.employment,
        employment_per_1000: stat.employmentPer1000,
        location_quotient: stat.locationQuotient,
        mean_annual_wage: stat.meanAnnualWage,
        median_annual_wage: stat.medianAnnualWage,
        p25_annual_wage: stat.p25AnnualWage,
        p75_annual_wage: stat.p75AnnualWage,
        wage_top_coded: stat.wageTopCoded,
        period: OEWS_PERIOD,
        source_id: sourceRow.id,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (payload.length !== stats.length) {
    throw new Error(
      `${stats.length - payload.length} records had no matching city row; ` +
        "re-run npm run data:seed so cbsa_geoid is populated.",
    );
  }

  // 1,000 rows per request, unchanged. Production logs showed every batch the
  // server actually received returned 200/201, so the payload size is not the
  // problem and shrinking it would only lengthen the run and widen the window
  // for another transport blip.
  const CHUNK = 1000;
  const totalBatches = Math.ceil(payload.length / CHUNK);

  for (let i = 0; i < payload.length; i += CHUNK) {
    const batchNumber = i / CHUNK + 1;
    const end = Math.min(i + CHUNK, payload.length);
    const label = `batch ${batchNumber}/${totalBatches} (rows ${i}-${end - 1})`;

    // Retried as a unit. Safe because the upsert key is the natural key
    // (city_id, soc_code, period): a batch that in fact landed server-side
    // before the connection dropped is simply rewritten to the same values.
    await withSeedRetry({ label, onLog: log }, async () => {
      // `supabase-js` returns `{ error }` for a PostgREST failure but *throws*
      // for a transport failure, so both are funnelled into one throw that
      // carries the status the classifier needs.
      const { error, status } = await supabase
        .from("metro_occupation_stats")
        .upsert(payload.slice(i, end), {
          onConflict: "city_id,soc_code,period",
        });

      if (error) {
        throw new SeedRequestError(`metro_occupation_stats: ${error.message}`, {
          status,
          code: error.code,
        });
      }
    });

    if (batchNumber % 10 === 1 || batchNumber === totalBatches) {
      log(`  seeded ${end}/${payload.length}…`);
    }
  }

  log(`Seeded ${payload.length} career records (${OEWS_PERIOD}).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
