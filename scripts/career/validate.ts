/**
 * Step 3 of the career pipeline: the data quality gate.
 *
 *   npm run data:career:validate
 *
 * Fails loudly. A malformed career dataset must never reach Supabase, because
 * a wrong wage displayed next to a real source citation is worse than no wage
 * at all.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PROCESSED_DIR, log } from "../city-data/shared";
import type { ProcessedCareerStat } from "./transform";

/** Nothing in OEWS should exceed these; they catch unit and parsing blunders. */
const MAX_EMPLOYMENT = 20_000_000;
const MAX_ANNUAL_WAGE = 1_000_000;
const MAX_PER_1000 = 1000;
// Location quotient is a ratio against the national average and has no upper
// bound. Real extremes are common in single-industry metros: Dalton GA reports
// 364 for textile machine operators (carpet manufacturing) and Beckley WV 313
// for mining roof bolters. The guard only needs to catch a decimal-point or
// column-shift error, so it sits far above any plausible real value.
const MAX_LOCATION_QUOTIENT = 1000;

function fail(problems: string[]): never {
  log(`\n❌ Career validation failed with ${problems.length} problem(s):\n`);
  for (const problem of problems.slice(0, 30)) log(`  • ${problem}`);
  if (problems.length > 30) log(`  … and ${problems.length - 30} more`);
  process.exit(1);
}

async function main(): Promise<void> {
  const stats: ProcessedCareerStat[] = JSON.parse(
    await readFile(path.join(PROCESSED_DIR, "career-stats.json"), "utf8"),
  );
  const cities: { cbsaGeoid: string }[] = JSON.parse(
    await readFile(path.join(PROCESSED_DIR, "cities.json"), "utf8"),
  );
  const occupations: { socCode: string }[] = JSON.parse(
    await readFile(path.join(PROCESSED_DIR, "occupations.json"), "utf8"),
  );
  const report = JSON.parse(
    await readFile(path.join(PROCESSED_DIR, "career-coverage.json"), "utf8"),
  );

  const knownCbsa = new Set(cities.map((c) => c.cbsaGeoid));
  const knownSoc = new Set(occupations.map((o) => o.socCode));

  const problems: string[] = [];
  const pairs = new Set<string>();

  if (stats.length === 0) problems.push("No career statistics were produced.");
  if (!report.period)
    problems.push("Coverage report is missing the source period.");

  const check = (ok: boolean, identity: string, message: string): void => {
    if (!ok) problems.push(`${identity}: ${message}`);
  };

  for (const stat of stats) {
    const identity = `${stat.cbsaGeoid}/${stat.socCode}`;

    if (!knownCbsa.has(stat.cbsaGeoid)) {
      problems.push(`${identity} references an unknown metro`);
    }
    if (!knownSoc.has(stat.socCode)) {
      problems.push(`${identity} references an unknown SOC code`);
    }
    if (!/^\d{2}-\d{4}$/.test(stat.socCode)) {
      problems.push(`${identity} has a malformed SOC code`);
    }

    if (pairs.has(identity)) {
      problems.push(`Duplicate metro/occupation pair: ${identity}`);
    }
    pairs.add(identity);

    // Every measure is either null (suppressed/not published) or a finite,
    // non-negative, plausible number. Never a string, NaN or Infinity.
    const numbers: [string, number | null, number][] = [
      ["employment", stat.employment, MAX_EMPLOYMENT],
      ["employmentPer1000", stat.employmentPer1000, MAX_PER_1000],
      ["locationQuotient", stat.locationQuotient, MAX_LOCATION_QUOTIENT],
      ["meanAnnualWage", stat.meanAnnualWage, MAX_ANNUAL_WAGE],
      ["medianAnnualWage", stat.medianAnnualWage, MAX_ANNUAL_WAGE],
      ["p25AnnualWage", stat.p25AnnualWage, MAX_ANNUAL_WAGE],
      ["p75AnnualWage", stat.p75AnnualWage, MAX_ANNUAL_WAGE],
    ];

    for (const [name, value, max] of numbers) {
      if (value === null) continue;
      check(typeof value === "number", identity, `${name} is not a number`);
      check(Number.isFinite(value), identity, `${name} is NaN or Infinity`);
      check(value >= 0, identity, `${name} is negative (${value})`);
      check(value <= max, identity, `${name} implausibly large (${value})`);
    }

    // Percentile ordering is a strong signal that columns were not shifted.
    if (
      stat.p25AnnualWage !== null &&
      stat.p75AnnualWage !== null &&
      stat.p25AnnualWage > stat.p75AnnualWage
    ) {
      problems.push(`${identity}: p25 wage exceeds p75 wage`);
    }
    if (
      stat.medianAnnualWage !== null &&
      stat.p25AnnualWage !== null &&
      stat.medianAnnualWage < stat.p25AnnualWage
    ) {
      problems.push(`${identity}: median wage below the 25th percentile`);
    }

    if (typeof stat.wageTopCoded !== "boolean") {
      problems.push(`${identity}: wageTopCoded is not a boolean`);
    }
    // A top-coded wage must not also carry a point estimate.
    if (stat.wageTopCoded && stat.medianAnnualWage !== null) {
      problems.push(
        `${identity}: top-coded but a median wage was still stored`,
      );
    }
  }

  if (report.metrosUnmatched?.length > 0) {
    problems.push(
      `${report.metrosUnmatched.length} metros unmatched: ${report.metrosUnmatched.slice(0, 5).join(", ")}`,
    );
  }
  if (report.metrosAmbiguous > 0) {
    problems.push(`${report.metrosAmbiguous} ambiguous metro joins`);
  }

  if (problems.length > 0) fail(problems);

  const withEmployment = stats.filter((s) => s.employment !== null).length;
  const withMedian = stats.filter((s) => s.medianAnnualWage !== null).length;

  log(`✅ ${stats.length} career records valid (${report.period}).`);
  log(
    `   metros matched:        ${report.metrosMatched}/${report.dreamDestinationMetros}`,
  );
  log(
    `   occupations matched:   ${report.occupationsMatched}/${report.supportedOccupations}`,
  );
  log(`   with employment:       ${withEmployment}`);
  log(`   with median wage:      ${withMedian}`);
  log(`   suppressed employment: ${report.suppressedEmployment}`);
  log(`   suppressed wage:       ${report.suppressedWage}`);
  log(`   wage top-coded:        ${report.wageTopCoded}`);
  log("Next: npm run data:career:seed");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
