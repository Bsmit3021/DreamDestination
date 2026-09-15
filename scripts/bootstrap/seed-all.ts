/**
 * Production data bootstrap: populate a fresh Supabase project from the
 * repository's committed canonical artefacts.
 *
 *   npm run data:bootstrap          seed everything, then verify counts
 *   npm run data:bootstrap:verify   verify counts only, change nothing
 *
 * ---------------------------------------------------------------------------
 * What this is for
 * ---------------------------------------------------------------------------
 * Seeding was previously seven separate commands that had to be run in the
 * right order, with nothing checking that the result was complete. A fresh
 * hosted project is exactly the situation where a half-finished seed is most
 * damaging: the app still starts, recommendations still generate, and the
 * missing dimension silently degrades every user's results instead of failing.
 *
 * This runs them in dependency order and then asserts the row counts, so an
 * incomplete bootstrap fails loudly rather than shipping quietly.
 *
 * ---------------------------------------------------------------------------
 * What it never does
 * ---------------------------------------------------------------------------
 * It touches only canonical reference tables. It never reads, writes or deletes
 * `profiles`, `preferences`, `recommendations`, `profile_career_targets`,
 * `advisor_conversations` or `advisor_messages` — a bootstrap must never be
 * able to destroy user data, so the user-owned tables are simply not addressed.
 *
 * Every source file it reads is committed. Nothing here needs `data/raw/**`,
 * which is deliberately not in the repository.
 */

import { spawnSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import { log } from "../city-data/shared";

/**
 * Seed steps in dependency order.
 *
 * Cities must exist before anything that references `city_id`; occupations
 * before the career statistics that reference `soc_code`. Everything after
 * that is independent, but the order is fixed anyway so a failure is always
 * reproducible.
 */
const STEPS = [
  { script: "data:city-data:seed", label: "cities, metrics and observations" },
  { script: "data:occupations:seed", label: "occupations and titles" },
  { script: "data:career:seed", label: "BLS OEWS career statistics" },
  { script: "data:housing:seed", label: "ACS housing benchmarks" },
  { script: "data:safety:seed", label: "FBI metro safety statistics" },
  { script: "data:family:seed", label: "NCES schools and ACS denominators" },
  { script: "data:lifestyle:seed", label: "Overture lifestyle statistics" },
] as const;

/**
 * Expected row counts.
 *
 * Every `exact` figure below is the length of the committed artefact the seed
 * reads, so the check is against what the repository actually contains rather
 * than against a remembered number. That distinction is not academic: the
 * first version of this file expected 40,000 occupation titles, a figure
 * carried over from a Phase 4 defect where a stale-row bug had left 55,514
 * duplicates. The corrected dataset has 8,548, and the guess would have failed
 * a perfectly good bootstrap forever.
 *
 * `min` is used only where a table legitimately accumulates — `metric_sources`
 * gains a row per dataset — so the check catches "half the rows are missing"
 * without freezing growth.
 */
const EXPECTATIONS = [
  { table: "cities", exact: 100 },
  { table: "metric_sources", min: 6 },
  { table: "city_metric_observations", exact: 699 },
  { table: "occupations", exact: 867 },
  { table: "occupation_titles", exact: 8_548 },
  { table: "metro_occupation_stats", exact: 55_609 },
  { table: "housing_market_stats", exact: 100 },
  { table: "metro_safety_stats", exact: 87 },
  { table: "metro_school_stats", exact: 100 },
  { table: "metro_lifestyle_stats", exact: 800 },
] as const;

type TableName = (typeof EXPECTATIONS)[number]["table"];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Bootstrap needs the target project's URL and service-role key.`,
    );
  }
  return value;
}

function runStep(script: string, label: string): void {
  log(`  → ${label}`);

  const result = spawnSync("npm", ["run", script], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();

  if (result.status !== 0) {
    // The seed's own message is far more useful than a generic failure, so it
    // is surfaced rather than swallowed.
    throw new Error(
      `Seed step \`${script}\` failed with exit code ${result.status}.\n${output}`,
    );
  }

  const summary = output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .at(-1);
  if (summary) log(`     ${summary.trim()}`);
}

async function verifyCounts(): Promise<{ ok: boolean; rows: string[] }> {
  const supabase = createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const rows: string[] = [];
  let ok = true;

  for (const expectation of EXPECTATIONS) {
    const { count, error } = await supabase
      .from(expectation.table as TableName)
      .select("*", { count: "exact", head: true });

    if (error) {
      rows.push(`  ✗ ${expectation.table}: ${error.message}`);
      ok = false;
      continue;
    }

    const actual = count ?? 0;
    const exact = "exact" in expectation ? expectation.exact : undefined;
    const min = "min" in expectation ? expectation.min : undefined;

    const failed =
      exact !== undefined
        ? actual !== exact
        : min !== undefined
          ? actual < min
          : false;

    rows.push(
      `  ${failed ? "✗" : "✓"} ${expectation.table.padEnd(26)} ${actual.toLocaleString().padStart(9)}` +
        (exact !== undefined
          ? `  (expected exactly ${exact.toLocaleString()})`
          : `  (expected at least ${(min ?? 0).toLocaleString()})`),
    );

    if (failed) ok = false;
  }

  return { ok, rows };
}

async function main(): Promise<void> {
  const verifyOnly = process.argv[2] === "verify";

  // Read before writing: a wrong target is much cheaper to discover now.
  const target = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  log(`bootstrap target: ${new URL(target).host}`);

  if (!verifyOnly) {
    log(`seeding ${STEPS.length} canonical datasets in dependency order`);
    for (const step of STEPS) runStep(step.script, step.label);
    log("");
  }

  log("verifying row counts");
  const { ok, rows } = await verifyCounts();
  for (const row of rows) log(row);

  if (!ok) {
    throw new Error(
      "Row counts did not meet expectations. The database is incompletely seeded — " +
        "investigate before pointing an application at it.",
    );
  }

  log("");
  log(
    verifyOnly
      ? "✅ all canonical datasets present"
      : "✅ bootstrap complete and verified",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
