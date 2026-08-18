/**
 * Loads the O*NET occupation taxonomy into Supabase.
 *
 *   npm run data:occupations:seed
 *
 * Service-role credential, as with the city seed: this is an offline developer
 * task writing reference data that users are not permitted to modify. It is
 * never reachable from a request path.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { PROCESSED_DIR, log } from "../city-data/shared";
import type {
  ProcessedOccupation,
  ProcessedOccupationTitle,
} from "./transform";

const ONET_SOURCE = {
  key: "onet-30-3",
  organization:
    "U.S. Department of Labor, Employment and Training Administration",
  dataset: "O*NET 30.3 Database (Occupation Data, Sample of Reported Titles)",
  url: "https://www.onetcenter.org/database.html",
  period: "30.3 (May 2026 release)",
  geography_level: "state" as const,
  notes:
    "O*NET is provided under CC BY 4.0 by USDOL/ETA. Used here for the occupation taxonomy and alternate titles only; O*NET is not the source of any wage or employment figure.",
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

async function main(): Promise<void> {
  const supabase = createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const occupations: ProcessedOccupation[] = JSON.parse(
    await readFile(path.join(PROCESSED_DIR, "occupations.json"), "utf8"),
  );
  const titles: ProcessedOccupationTitle[] = JSON.parse(
    await readFile(path.join(PROCESSED_DIR, "occupation-titles.json"), "utf8"),
  );

  const { error: sourceError } = await supabase.from("metric_sources").upsert(
    { ...ONET_SOURCE, retrieved_on: new Date().toISOString().slice(0, 10) },
    {
      onConflict: "key",
    },
  );
  if (sourceError) throw new Error(`metric_sources: ${sourceError.message}`);

  const { data: sourceRow, error: readError } = await supabase
    .from("metric_sources")
    .select("id")
    .eq("key", ONET_SOURCE.key)
    .single();
  if (readError) throw new Error(readError.message);

  const CHUNK = 500;

  for (let i = 0; i < occupations.length; i += CHUNK) {
    const { error } = await supabase.from("occupations").upsert(
      occupations.slice(i, i + CHUNK).map((occupation) => ({
        soc_code: occupation.socCode,
        title: occupation.title,
        description: occupation.description,
        onet_code: occupation.onetCode,
        source_id: sourceRow.id,
      })),
      { onConflict: "soc_code" },
    );
    if (error) throw new Error(`occupations: ${error.message}`);
  }

  // The title list is a full snapshot per O*NET release, not an accumulating
  // log. O*NET 30.x retired "Alternate Titles" in favour of "Sample of
  // Reported Titles", so upserting alone leaves thousands of 29.x rows behind —
  // still searchable, and now misattributed to the 30.3 source row. Clearing
  // first makes the table honestly match the release it claims to be.
  const { error: clearError } = await supabase
    .from("occupation_titles")
    .delete()
    .not("soc_code", "is", null);
  if (clearError) {
    throw new Error(`occupation_titles clear: ${clearError.message}`);
  }

  for (let i = 0; i < titles.length; i += CHUNK) {
    const { error } = await supabase.from("occupation_titles").upsert(
      titles.slice(i, i + CHUNK).map((title) => ({
        soc_code: title.socCode,
        title: title.title,
        normalized_title: title.normalizedTitle,
        title_kind: title.kind,
      })),
      { onConflict: "soc_code,normalized_title" },
    );
    if (error) throw new Error(`occupation_titles: ${error.message}`);
  }

  log(`Seeded ${occupations.length} occupations and ${titles.length} titles.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
