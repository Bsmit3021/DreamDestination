/**
 * Step 2 of the career pipeline: filtered OEWS TSV -> canonical career stats.
 *
 *   npm run data:career:transform
 *
 * Joins are on identifiers only — CBSA code (`AREA`) and SOC code
 * (`OCC_CODE`). Metro names are never used to match: "Louisville/Jefferson
 * County, KY-IN" and "Louisville, KY" are the same place under different
 * spellings, and name matching would silently pair the wrong rows or drop them.
 *
 * BLS suppression markers are preserved as missing, never as zero:
 *
 *   **  employment not available          -> null
 *   *   wage not released                 -> null
 *   #   wage at or above the top code      -> null + wageTopCoded: true
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PROCESSED_DIR, RAW_DIR, log } from "../city-data/shared";

const SOURCE_TSV = path.join(RAW_DIR, "oews-msa.tsv");
const OUT_FILE = path.join(PROCESSED_DIR, "career-stats.json");
const REPORT_FILE = path.join(PROCESSED_DIR, "career-coverage.json");

/** May 2025 OEWS top code, used only to explain `#` in the UI. */
export const OEWS_TOP_CODE_ANNUAL = 239_200;
export const OEWS_PERIOD = "May 2025";

export interface ProcessedCareerStat {
  cbsaGeoid: string;
  socCode: string;
  employment: number | null;
  employmentPer1000: number | null;
  locationQuotient: number | null;
  meanAnnualWage: number | null;
  medianAnnualWage: number | null;
  p25AnnualWage: number | null;
  p75AnnualWage: number | null;
  wageTopCoded: boolean;
}

/** BLS markers that mean "no published value", by column family. */
const EMPLOYMENT_NOT_AVAILABLE = "**";
const WAGE_NOT_RELEASED = "*";
const WAGE_TOP_CODED = "#";

/**
 * Parses a numeric cell, returning null for any BLS marker.
 *
 * Deliberately strict: anything that is not a clean number becomes null rather
 * than being coerced. A stray character must not silently become a wage.
 */
function numeric(raw: string): number | null {
  const value = raw.trim().replace(/,/g, "");
  if (!value) return null;
  if (
    value === EMPLOYMENT_NOT_AVAILABLE ||
    value === WAGE_NOT_RELEASED ||
    value === WAGE_TOP_CODED
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTopCoded(...cells: string[]): boolean {
  return cells.some((cell) => cell.trim() === WAGE_TOP_CODED);
}

async function main(): Promise<void> {
  const cities: {
    slug: string;
    cbsaGeoid: string;
    city: string;
    state: string;
  }[] = JSON.parse(
    await readFile(path.join(PROCESSED_DIR, "cities.json"), "utf8"),
  );
  const occupations: { socCode: string }[] = JSON.parse(
    await readFile(path.join(PROCESSED_DIR, "occupations.json"), "utf8"),
  );

  const wantedCbsa = new Map(cities.map((c) => [c.cbsaGeoid, c]));
  const wantedSoc = new Set(occupations.map((o) => o.socCode));

  const text = await readFile(SOURCE_TSV, "utf8");
  const [headerLine, ...lines] = text.trim().split("\n");
  const header = (headerLine ?? "").split("\t");
  const at = (name: string) => header.indexOf(name);

  const iArea = at("AREA");
  const iSoc = at("OCC_CODE");
  if (iArea === -1 || iSoc === -1) {
    throw new Error("oews-msa.tsv is missing AREA or OCC_CODE; re-run extract");
  }

  const stats: ProcessedCareerStat[] = [];
  const seen = new Set<string>();

  const sourceCbsa = new Set<string>();
  const sourceSoc = new Set<string>();
  const matchedCbsa = new Set<string>();
  const matchedSoc = new Set<string>();
  let duplicates = 0;
  let suppressedEmployment = 0;
  let suppressedWage = 0;
  let topCoded = 0;

  for (const line of lines) {
    const cols = line.split("\t");
    const cbsa = (cols[iArea] ?? "").trim();
    const soc = (cols[iSoc] ?? "").trim();

    sourceCbsa.add(cbsa);
    sourceSoc.add(soc);

    // Identifier joins only.
    if (!wantedCbsa.has(cbsa) || !wantedSoc.has(soc)) continue;

    const key = `${cbsa}|${soc}`;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);

    matchedCbsa.add(cbsa);
    matchedSoc.add(soc);

    const cell = (name: string) => (cols[at(name)] ?? "").trim();

    const employment = numeric(cell("TOT_EMP"));
    const meanWage = numeric(cell("A_MEAN"));
    const medianWage = numeric(cell("A_MEDIAN"));
    const wageTopCoded = isTopCoded(
      cell("A_MEAN"),
      cell("A_MEDIAN"),
      cell("A_PCT25"),
      cell("A_PCT75"),
    );

    if (cell("TOT_EMP") === EMPLOYMENT_NOT_AVAILABLE) suppressedEmployment += 1;
    if (cell("A_MEDIAN") === WAGE_NOT_RELEASED) suppressedWage += 1;
    if (wageTopCoded) topCoded += 1;

    stats.push({
      cbsaGeoid: cbsa,
      socCode: soc,
      employment,
      employmentPer1000: numeric(cell("JOBS_1000")),
      locationQuotient: numeric(cell("LOC_QUOTIENT")),
      meanAnnualWage: meanWage,
      medianAnnualWage: medianWage,
      p25AnnualWage: numeric(cell("A_PCT25")),
      p75AnnualWage: numeric(cell("A_PCT75")),
      wageTopCoded,
    });
  }

  const unmatchedCities = cities.filter((c) => !matchedCbsa.has(c.cbsaGeoid));

  const report = {
    period: OEWS_PERIOD,
    dreamDestinationMetros: cities.length,
    careerSourceMetros: sourceCbsa.size,
    metrosMatched: matchedCbsa.size,
    metrosUnmatched: unmatchedCities.map(
      (c) => `${c.city}, ${c.state} (${c.cbsaGeoid})`,
    ),
    metrosAmbiguous: 0,
    supportedOccupations: wantedSoc.size,
    careerSourceOccupations: sourceSoc.size,
    occupationsMatched: matchedSoc.size,
    occupationsUnmatched: [...wantedSoc].filter((s) => !matchedSoc.has(s))
      .length,
    rowsWritten: stats.length,
    duplicatePairsSkipped: duplicates,
    suppressedEmployment,
    suppressedWage,
    wageTopCoded: topCoded,
  };

  await mkdir(PROCESSED_DIR, { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(stats)}\n`);
  await writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);

  log("OEWS -> canonical career statistics");
  log(`  DreamDestination metros:   ${report.dreamDestinationMetros}`);
  log(`  Career source metros:      ${report.careerSourceMetros}`);
  log(`  Matched:                   ${report.metrosMatched}`);
  log(`  Unmatched:                 ${report.metrosUnmatched.length}`);
  log(`  Ambiguous:                 ${report.metrosAmbiguous}`);
  log(`  Supported occupations:     ${report.supportedOccupations}`);
  log(`  Occupations matched:       ${report.occupationsMatched}`);
  log(`  Rows written:              ${report.rowsWritten}`);
  log(`  Suppressed employment (**): ${report.suppressedEmployment}`);
  log(`  Suppressed wage (*):        ${report.suppressedWage}`);
  log(`  Wage top-coded (#):         ${report.wageTopCoded}`);
  for (const metro of report.metrosUnmatched) log(`    unmatched: ${metro}`);
  log("Next: npm run data:career:validate");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
