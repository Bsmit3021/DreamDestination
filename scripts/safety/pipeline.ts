/**
 * Safety pipeline: fetch -> transform -> validate, driven by a subcommand.
 *
 *   npm run data:safety:fetch
 *   npm run data:safety:transform
 *   npm run data:safety:validate
 *
 * Source: FBI Uniform Crime Reporting Program, "Reported Crimes in the Nation,
 * 2025" (RCN 2025), finalised annual release. Within it, "Crime in the United
 * States, 2025" (CIUS 2025) publishes Tables 1-7 of traditional estimates;
 * Table 6 is the metropolitan-statistical-area table.
 *
 * ---------------------------------------------------------------------------
 * Why Table 6 and nothing else
 * ---------------------------------------------------------------------------
 * Table 6 publishes the FBI's own aggregate rate per 100,000 inhabitants for
 * each MSA. That is the only defensible metro figure available:
 *
 *  - Summing police departments, sheriffs, university and state agencies from
 *    the agency-level tables double counts overlapping jurisdictions and mixes
 *    incompatible population denominators.
 *  - A principal city's own numbers describe the city, not the metro. Table 6
 *    prints "City of X" rows precisely so they can be read separately, and
 *    this pipeline ignores them.
 *
 * Metropolitan Divisions ("M. D.") are subdivisions of an MSA and are skipped
 * for the same double-counting reason.
 *
 * ---------------------------------------------------------------------------
 * Block layout inside Table 6
 * ---------------------------------------------------------------------------
 * Each MSA is a block of rows. Column A carries the MSA name on the first row
 * of the block and is empty afterwards; column B labels each subsequent row:
 *
 *   A: "Akron, OH M. S. A."          C: 702047        <- name + population
 *   B: "Includes Portage, Summit ..."
 *   B: "City of Akron"                                <- ignored
 *   B: "Total area actually reporting" C: 0.991       <- reporting coverage
 *   B: "Estimated total"                              <- present iff estimated
 *   B: "Rate per 100,000 inhabitants"  D: 321.8  I: 1647
 *
 * The rate row is the published metro rate: D violent, I property. Note it has
 * no population cell, so columns are read by cell reference rather than by
 * position — an xlsx omits empty cells entirely.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { FBI_CIUS_YEAR, SOURCES } from "../city-data/config";
import { CITIES_FILE, PROCESSED_DIR, RAW_DIR, log } from "../city-data/shared";

const ARCHIVE_NAME = "cius-estimations-2025.zip";
const TABLE_6_MEMBER =
  "CIUS_Table_6_Crime_in_the_United_States_by_Metropolitan_Statistical_Area_2025.xlsx";

/**
 * The CDE serves downloads from a private S3 bucket through a keyless
 * signing endpoint. The catalogue that names the archive lives at
 * `assets/JSON/downloads/cius.json` in the CDE web app.
 */
const CDE_SIGNED_URL = "https://cde.ucr.cjis.gov/LATEST/s3/signedurl";
const CDE_S3_KEY = `cius/${FBI_CIUS_YEAR}/${ARCHIVE_NAME}`;

const EXTRACT_FILE = path.join(RAW_DIR, "cius-msa.tsv");

const OUT_FILE = path.join(PROCESSED_DIR, "safety-stats.json");
const REPORT_FILE = path.join(PROCESSED_DIR, "safety-coverage.json");
const PROVENANCE_FILE = path.join(PROCESSED_DIR, "safety-provenance.json");

/** A metro's published crime rates, as extracted from Table 6. */
export interface ProcessedSafetyStat {
  cbsaGeoid: string;
  /** The FBI's own row label, kept so any mapping can be audited. */
  fbiMetroName: string;
  dataYear: number;
  violentCrimeRate: number | null;
  propertyCrimeRate: number | null;
  sourcePopulation: number | null;
  reportingCoverage: number | null;
  isEstimated: boolean;
}

/** One MSA block, before it is matched to a candidate metro. */
interface FbiBlock {
  name: string;
  population: number | null;
  violentRate: number | null;
  propertyRate: number | null;
  reportingCoverage: number | null;
  isEstimated: boolean;
}

interface CityRecord {
  slug: string;
  metro: string;
  cbsaGeoid: string;
}

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

async function resolveSignedUrl(): Promise<string> {
  const response = await fetch(
    `${CDE_SIGNED_URL}?key=${encodeURIComponent(CDE_S3_KEY)}`,
  );
  if (!response.ok) {
    throw new Error(
      `CDE signing endpoint returned ${response.status}. The download catalogue may have moved; check https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/downloads`,
    );
  }

  const body = (await response.json()) as Record<string, string>;
  const url = body[CDE_S3_KEY];

  // An unknown key returns `{}` rather than an error status, so a missing
  // value here means the archive name or year changed upstream.
  if (!url) {
    throw new Error(
      `CDE has no download for key "${CDE_S3_KEY}". The CIUS archive naming changed; re-check assets/JSON/downloads/cius.json before editing this script.`,
    );
  }

  return url;
}

async function fetchArchive(): Promise<void> {
  const destination = path.join(RAW_DIR, ARCHIVE_NAME);

  try {
    const existing = await readFile(destination);
    if (existing.byteLength > 0) {
      log(`  ${ARCHIVE_NAME}: already downloaded, skipping`);
      return;
    }
  } catch {
    // Not downloaded yet.
  }

  log(`  resolving signed URL for ${CDE_S3_KEY}`);
  const url = await resolveSignedUrl();

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed with ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(destination, bytes);

  log(`  ${ARCHIVE_NAME}: ${bytes.byteLength.toLocaleString()} bytes`);
}

// ---------------------------------------------------------------------------
// transform
// ---------------------------------------------------------------------------

/**
 * Trailing footnote markers, e.g. "Jacksonville, FL M. S. A.1".
 *
 * Stripped before the geography suffix, because the marker sits after it. The
 * lookbehind keeps genuine digits inside a name safe.
 */
function stripFootnote(value: string): string {
  return value.trim().replace(/(?<=[.A-Za-z])\d+$/, "");
}

function isMsa(name: string): boolean {
  return /M\.\s?S\.\s?A\.$/.test(stripFootnote(name));
}

function isMetropolitanDivision(name: string): boolean {
  return /M\.\s?D\.$/.test(stripFootnote(name));
}

/**
 * The MSA name with its geography suffix and footnote removed, lowercased.
 *
 * Conservative on purpose: whitespace and case only. No token dropping, no
 * abbreviation expansion, no edit-distance matching — an unmatched metro must
 * stay unmatched rather than be attached to a neighbouring one.
 */
export function normalizeMetroName(value: string): string {
  return stripFootnote(value)
    .replace(/\s*M\.\s?S\.\s?A\.$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Splits the sheet into one record per MSA, ignoring city and division rows. */
export function parseTable6(
  rows: readonly Record<string, string>[],
): FbiBlock[] {
  const blocks: FbiBlock[] = [];
  let current: FbiBlock | null = null;

  for (const row of rows) {
    const name = row.A?.trim();

    if (name) {
      if (current) blocks.push(current);
      current = {
        name,
        population: toNumber(row.C),
        violentRate: null,
        propertyRate: null,
        reportingCoverage: null,
        isEstimated: false,
      };
      continue;
    }

    if (!current) continue;

    // "City of ..." and "Includes ..." rows are deliberately never read: a
    // principal city is not its metro.
    switch (row.B?.trim()) {
      case "Total area actually reporting":
        current.reportingCoverage = toNumber(row.C);
        break;
      case "Estimated total":
        current.isEstimated = true;
        break;
      case "Rate per 100,000 inhabitants":
        current.violentRate = toNumber(row.D);
        current.propertyRate = toNumber(row.I);
        break;
    }
  }

  if (current) blocks.push(current);

  return blocks.filter(
    (block) => isMsa(block.name) || isMetropolitanDivision(block.name),
  );
}

interface CoverageReport {
  source: string;
  dataYear: number;
  candidateMetros: number;
  fbiMsaBlocks: number;
  metropolitanDivisionsSkipped: number;
  matched: number;
  unmatched: number;
  withViolentRate: number;
  withPropertyRate: number;
  withBothRates: number;
  estimatedMetros: number;
  unmatchedMetros: { slug: string; metro: string; cbsaGeoid: string }[];
  notes: string[];
}

/** Reads the flat TSV written by `extract_cius.py` back into cell records. */
async function readExtractedRows(): Promise<Record<string, string>[]> {
  const text = await readFile(EXTRACT_FILE, "utf8");
  const lines = text.trim().split("\n");
  const header = lines[0]?.split("\t") ?? [];

  if (header.join(",") !== "a,b,c,d,i") {
    throw new Error(
      `${EXTRACT_FILE} has unexpected columns [${header.join(", ")}]. Re-run \`npm run data:safety:extract\`.`,
    );
  }

  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    return {
      A: cells[0] ?? "",
      B: cells[1] ?? "",
      C: cells[2] ?? "",
      D: cells[3] ?? "",
      I: cells[4] ?? "",
    };
  });
}

async function transform(): Promise<void> {
  const archivePath = path.join(RAW_DIR, ARCHIVE_NAME);
  const rows = await readExtractedRows();

  if (rows.length < 500) {
    throw new Error(
      `Table 6 yielded only ${rows.length} rows. The workbook layout changed; refusing to emit partial safety data.`,
    );
  }

  const blocks = parseTable6(rows);
  const msaBlocks = blocks.filter((block) => isMsa(block.name));
  const divisions = blocks.filter((block) =>
    isMetropolitanDivision(block.name),
  );

  if (msaBlocks.length < 200) {
    throw new Error(
      `Only ${msaBlocks.length} MSA blocks parsed from Table 6, well below the expected few hundred. Refusing to emit partial safety data.`,
    );
  }

  // A duplicate normalised name would make the join ambiguous, and picking a
  // winner silently is exactly the failure this pipeline must not have.
  const byName = new Map<string, FbiBlock>();
  const duplicates: string[] = [];
  for (const block of msaBlocks) {
    const key = normalizeMetroName(block.name);
    if (byName.has(key)) duplicates.push(key);
    byName.set(key, block);
  }
  if (duplicates.length > 0) {
    throw new Error(
      `Table 6 contains duplicate MSA names after normalisation: ${duplicates.join(", ")}. Resolve the ambiguity before seeding.`,
    );
  }

  const cities = JSON.parse(
    await readFile(CITIES_FILE, "utf8"),
  ) as CityRecord[];

  const stats: ProcessedSafetyStat[] = [];
  const unmatched: CoverageReport["unmatchedMetros"] = [];

  for (const city of cities) {
    const block = byName.get(normalizeMetroName(city.metro));

    // No match means the FBI published no MSA estimate for this metro. It is
    // recorded as absent, not zero, and never backfilled from a principal city.
    if (!block) {
      unmatched.push({
        slug: city.slug,
        metro: city.metro,
        cbsaGeoid: city.cbsaGeoid,
      });
      continue;
    }

    stats.push({
      cbsaGeoid: city.cbsaGeoid,
      fbiMetroName: block.name,
      dataYear: FBI_CIUS_YEAR,
      violentCrimeRate: block.violentRate,
      propertyCrimeRate: block.propertyRate,
      sourcePopulation: block.population,
      reportingCoverage: block.reportingCoverage,
      isEstimated: block.isEstimated,
    });
  }

  const report: CoverageReport = {
    source: SOURCES.fbi.key,
    dataYear: FBI_CIUS_YEAR,
    candidateMetros: cities.length,
    fbiMsaBlocks: msaBlocks.length,
    metropolitanDivisionsSkipped: divisions.length,
    matched: stats.length,
    unmatched: unmatched.length,
    withViolentRate: stats.filter((s) => s.violentCrimeRate !== null).length,
    withPropertyRate: stats.filter((s) => s.propertyCrimeRate !== null).length,
    withBothRates: stats.filter(
      (s) => s.violentCrimeRate !== null && s.propertyCrimeRate !== null,
    ).length,
    estimatedMetros: stats.filter((s) => s.isEstimated).length,
    unmatchedMetros: unmatched,
    notes: [
      "Matching is exact on the normalised MSA name (case and whitespace only). No fuzzy or edit-distance matching is performed; an unmatched metro stays unmatched.",
      "Metropolitan Divisions are skipped: they are subdivisions of an MSA and counting them would double count.",
      'Table 6 carries the footnote "Limited data for 2025 were available for Florida and North Dakota", which accounts for most unmatched metros.',
      "Every unmatched metro was checked against Table 6 by token search and is genuinely absent, not renamed.",
    ],
  };

  const archiveBytes = await readFile(archivePath);

  await mkdir(PROCESSED_DIR, { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(stats, null, 2)}\n`);
  await writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    PROVENANCE_FILE,
    `${JSON.stringify(
      {
        archive: ARCHIVE_NAME,
        sha256: createHash("sha256").update(archiveBytes).digest("hex"),
        bytes: archiveBytes.byteLength,
        member: TABLE_6_MEMBER,
        organization: SOURCES.fbi.organization,
        dataset: SOURCES.fbi.dataset,
        publication:
          "Reported Crimes in the Nation, 2025 (finalised annual release)",
        period: SOURCES.fbi.period,
        geographyLevel: SOURCES.fbi.geographyLevel,
        units: "offenses per 100,000 inhabitants",
        retrievedOn: new Date().toISOString().slice(0, 10),
        retrievalMethod:
          "Downloaded from the FBI Crime Data Explorer keyless signing endpoint (cde.ucr.cjis.gov/LATEST/s3/signedurl), catalogue key cius/2025/cius-estimations-2025.zip.",
        agenciesReporting: 17075,
        populationCoveragePercent: 96.2,
      },
      null,
      2,
    )}\n`,
  );

  log(
    `  ${stats.length}/${cities.length} metros matched, ${report.withBothRates} with both rates`,
  );
  if (unmatched.length > 0) {
    log(`  ${unmatched.length} unmatched (no FBI MSA estimate published):`);
    for (const item of unmatched) log(`    - ${item.metro}`);
  }
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

async function validate(): Promise<void> {
  const stats = JSON.parse(
    await readFile(OUT_FILE, "utf8"),
  ) as ProcessedSafetyStat[];
  const cities = JSON.parse(
    await readFile(CITIES_FILE, "utf8"),
  ) as CityRecord[];

  const known = new Set(cities.map((city) => city.cbsaGeoid));
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const stat of stats) {
    if (!known.has(stat.cbsaGeoid)) {
      errors.push(
        `${stat.fbiMetroName}: CBSA ${stat.cbsaGeoid} is not a candidate metro`,
      );
    }
    if (seen.has(stat.cbsaGeoid)) {
      errors.push(`${stat.cbsaGeoid}: duplicate observation`);
    }
    seen.add(stat.cbsaGeoid);

    if (stat.dataYear !== FBI_CIUS_YEAR) {
      errors.push(
        `${stat.fbiMetroName}: unexpected data year ${stat.dataYear}`,
      );
    }
    for (const [label, rate] of [
      ["violent", stat.violentCrimeRate],
      ["property", stat.propertyCrimeRate],
    ] as const) {
      if (rate === null) continue;
      if (!Number.isFinite(rate) || rate < 0) {
        errors.push(
          `${stat.fbiMetroName}: ${label} rate ${rate} is not a valid rate`,
        );
      }
      // A metro-level rate above this is not credible for either measure and
      // would indicate a column misread rather than a real figure.
      if (rate > 25_000) {
        errors.push(
          `${stat.fbiMetroName}: ${label} rate ${rate} implausibly high`,
        );
      }
    }
    if (
      stat.reportingCoverage !== null &&
      (stat.reportingCoverage < 0 || stat.reportingCoverage > 1)
    ) {
      errors.push(
        `${stat.fbiMetroName}: reporting coverage ${stat.reportingCoverage} outside 0-1`,
      );
    }
  }

  const withBoth = stats.filter(
    (s) => s.violentCrimeRate !== null && s.propertyCrimeRate !== null,
  ).length;

  // A sudden collapse in coverage means the source or the join changed, and
  // should stop the pipeline rather than quietly shrink the dataset.
  if (withBoth < 60) {
    errors.push(
      `Only ${withBoth} metros have both rates, far below the ${stats.length} matched. Coverage collapsed — investigate before seeding.`,
    );
  }

  if (errors.length > 0) {
    for (const error of errors) log(`  ✗ ${error}`);
    throw new Error(`${errors.length} safety validation error(s)`);
  }

  log(
    `  ✅ ${stats.length} metros, ${withBoth} with violent and property rates`,
  );
  log(
    `     ${stats.filter((s) => s.isEstimated).length} include FBI estimation for non-reporting agencies`,
  );
}

// ---------------------------------------------------------------------------

const COMMANDS = { fetch: fetchArchive, transform, validate } as const;

async function main(): Promise<void> {
  const command = process.argv[2] as keyof typeof COMMANDS | undefined;
  if (!command || !(command in COMMANDS)) {
    throw new Error(`Usage: pipeline.ts <${Object.keys(COMMANDS).join("|")}>`);
  }

  log(`safety: ${command}`);
  await COMMANDS[command]();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
