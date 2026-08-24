/**
 * Family pipeline: fetch -> transform -> validate, driven by a subcommand.
 *
 *   npm run data:family:fetch
 *   npm run data:family:transform
 *   npm run data:family:validate
 *
 * Produces the one family-specific input DreamDestination does not already
 * have: how many public schools a metro contains, relative to how many
 * school-age children live there.
 *
 * ---------------------------------------------------------------------------
 * What this measures, and what it does not
 * ---------------------------------------------------------------------------
 * NCES EDGE publishes the *location* of every public school in the Common Core
 * of Data. Counting those locations says how many public schools exist in a
 * metro. It says nothing whatsoever about how good they are — not quality, not
 * achievement, not test scores, not rankings, not teaching. Every label
 * downstream says "availability" or "access" for exactly that reason.
 *
 * ---------------------------------------------------------------------------
 * Sources
 * ---------------------------------------------------------------------------
 *   NCES EDGE Public School Locations 2024-25   school counts, joined on the
 *                                               file's own CBSA identifier
 *   ACS 2019-2023 5-year, table B01001          population aged 5-17
 *
 * The CBSA join is on identifiers, not names: the geocode file carries a CBSA
 * code per school under OMB July 2023 definitions, which is the same geography
 * every other metric here uses. No city-name matching is involved anywhere.
 */

import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  ACS_BASE_URL,
  ACS_MISSING_THRESHOLD,
  ACS_PERIOD,
  CBSA_GEO_PREFIX,
  NCES_EDGE_URL,
  NCES_SCHOOL_YEAR,
  SOURCES,
} from "../city-data/config";
import { CITIES_FILE, PROCESSED_DIR, RAW_DIR, log } from "../city-data/shared";

const ACS_TABLE = "b01001";
const NCES_ARCHIVE = "EDGE_GEOCODE_PUBLICSCH_2425.zip";
const NCES_MEMBER = "EDGE_GEOCODE_PUBLICSCH_2425.TXT";

/**
 * B01001 cells for ages 5-17, verified against the official Census metadata
 * for the 2023 ACS 5-year release
 * (api.census.gov/data/2023/acs/acs5/groups/B01001.json) rather than assumed:
 *
 *   004 Male 5 to 9      005 Male 10 to 14      006 Male 15 to 17
 *   028 Female 5 to 9    029 Female 10 to 14    030 Female 15 to 17
 *
 * 15-17 rather than 15-19 because B01001 splits the teenage bands at 17, and
 * folding in 18-19 would count adults who have mostly left school.
 */
export const SCHOOL_AGE_CELLS = [4, 5, 6, 28, 29, 30] as const;

/** Schools counted per this many school-age residents. */
export const SCHOOL_ACCESS_PER = 10_000;

/**
 * Column positions in the pipe-delimited NCES geocode file, which ships with
 * no header row. Verified against the header of the companion xlsx.
 */
const NCES_COLUMNS = {
  ncessch: 0,
  cbsa: 14,
  cbsaName: 15,
  schoolYear: 22,
  count: 23,
} as const;

const OUT_FILE = path.join(PROCESSED_DIR, "school-stats.json");
const REPORT_FILE = path.join(PROCESSED_DIR, "family-coverage.json");
const PROVENANCE_FILE = path.join(PROCESSED_DIR, "family-provenance.json");

export interface ProcessedSchoolStat {
  cbsaGeoid: string;
  schoolYear: string;
  publicSchoolCount: number;
  schoolAgePopulation: number | null;
  populationPeriod: string;
  /** Null whenever the denominator is missing or not positive. */
  schoolsPer10kSchoolAge: number | null;
}

interface CityRecord {
  slug: string;
  metro: string;
  cbsaGeoid: string;
}

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

async function fetchAcsTable(): Promise<void> {
  const destination = path.join(RAW_DIR, `acs-${ACS_TABLE}.psv`);

  try {
    const existing = await readFile(destination, "utf8");
    if (existing.trim().split("\n").length > 1) {
      log(`  ${ACS_TABLE}: already downloaded, skipping`);
      return;
    }
  } catch {
    /* not present yet */
  }

  const url = `${ACS_BASE_URL}/acsdt5y2023-${ACS_TABLE}.dat`;
  const response = await fetch(url, {
    headers: { "User-Agent": "DreamDestination-data-pipeline" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${ACS_TABLE}: HTTP ${response.status}`);
  }

  const out = createWriteStream(destination);
  const write = async (line: string) => {
    if (!out.write(`${line}\n`)) {
      await new Promise<void>((resolve) => out.once("drain", () => resolve()));
    }
  };

  const decoder = new TextDecoder();
  let carry = "";
  let kept = 0;

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    carry += decoder.decode(chunk, { stream: true });
    const lines = carry.split("\n");
    carry = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("GEO_ID|") || line.startsWith(CBSA_GEO_PREFIX)) {
        await write(line);
        kept += 1;
      }
    }
  }
  if (carry.startsWith(CBSA_GEO_PREFIX)) {
    await write(carry);
    kept += 1;
  }

  await new Promise<void>((resolve, reject) =>
    out.end((error?: Error | null) => (error ? reject(error) : resolve())),
  );

  if (kept <= 1) {
    throw new Error(
      `${ACS_TABLE} produced no metro rows; ACS layout may have changed`,
    );
  }
  log(`  ${ACS_TABLE}: kept ${kept - 1} metro rows`);
}

async function fetchNces(): Promise<void> {
  const destination = path.join(RAW_DIR, NCES_ARCHIVE);

  try {
    const existing = await readFile(destination);
    if (existing.byteLength > 0) {
      log(`  ${NCES_ARCHIVE}: already downloaded, skipping`);
      return;
    }
  } catch {
    /* not present yet */
  }

  // nces.ed.gov resets the connection for clients without a browser-shaped
  // request, so the referer and agent are required rather than cosmetic.
  const response = await fetch(NCES_EDGE_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      Referer: "https://nces.ed.gov/programs/edge/geographic/schoollocations",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to download NCES EDGE: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(destination, bytes);
  log(`  ${NCES_ARCHIVE}: ${bytes.byteLength.toLocaleString()} bytes`);
}

async function fetchAll(): Promise<void> {
  await fetchAcsTable();
  await fetchNces();
}

// ---------------------------------------------------------------------------
// transform
// ---------------------------------------------------------------------------

/** cbsa -> cell -> value, with ACS jam values dropped rather than kept. */
async function readAcsTable(): Promise<Map<string, Map<number, number>>> {
  const text = await readFile(
    path.join(RAW_DIR, `acs-${ACS_TABLE}.psv`),
    "utf8",
  );
  const [headerLine, ...rows] = text.trim().split("\n");
  const headers = (headerLine ?? "").split("|");

  const estimates: { index: number; cell: number }[] = [];
  headers.forEach((header, index) => {
    const match = /^[A-Z0-9]+_E(\d+)$/.exec(header);
    if (match) estimates.push({ index, cell: Number.parseInt(match[1]!, 10) });
  });

  if (estimates.length === 0) {
    throw new Error(
      `${ACS_TABLE}: no estimate columns found; the summary-file layout changed`,
    );
  }

  const table = new Map<string, Map<number, number>>();

  for (const row of rows) {
    const fields = row.split("|");
    const geoId = fields[0] ?? "";
    if (!geoId.startsWith(CBSA_GEO_PREFIX)) continue;

    const cbsa = geoId.slice(CBSA_GEO_PREFIX.length);
    const cells = new Map<number, number>();

    for (const { index, cell } of estimates) {
      const value = Number(fields[index]);
      // ACS publishes "not available" as a large negative jam value, never 0.
      if (!Number.isFinite(value) || value <= ACS_MISSING_THRESHOLD) continue;
      cells.set(cell, value);
    }

    table.set(cbsa, cells);
  }

  return table;
}

/** Sums the six 5-17 cells, or null when any of them is unpublished. */
export function schoolAgePopulation(
  cells: Map<number, number> | undefined,
): number | null {
  if (!cells) return null;

  let total = 0;
  for (const cell of SCHOOL_AGE_CELLS) {
    const value = cells.get(cell);
    // A missing band would silently understate the denominator and inflate the
    // access rate, so the whole figure is treated as unavailable instead.
    if (value === undefined) return null;
    total += value;
  }

  return total;
}

/** Distinct NCESSCH counts per CBSA, plus the integrity facts worth asserting. */
async function countSchoolsByCbsa(): Promise<{
  counts: Map<string, number>;
  names: Map<string, string>;
  totalRows: number;
  uniqueSchools: number;
  duplicateRows: number;
  schoolYears: Set<string>;
}> {
  const archive = path.join(RAW_DIR, NCES_ARCHIVE);

  // Same reasoning as the OEWS extractor: Python's stdlib reads a zip with no
  // dependency, and this is the only step that needs one.
  const result = spawnSync(
    "python3",
    [
      "-c",
      `import sys, zipfile
with zipfile.ZipFile(${JSON.stringify(archive)}) as z:
    sys.stdout.buffer.write(z.read(${JSON.stringify(NCES_MEMBER)}))`,
    ],
    { maxBuffer: 1024 * 1024 * 256 },
  );

  if (result.status !== 0) {
    throw new Error(
      `Could not read ${NCES_MEMBER} from ${NCES_ARCHIVE}: ${result.stderr.toString().trim()}`,
    );
  }

  const counts = new Map<string, number>();
  const names = new Map<string, string>();
  const seen = new Set<string>();
  const schoolYears = new Set<string>();
  let totalRows = 0;
  let duplicateRows = 0;

  for (const line of result.stdout.toString("latin1").split("\n")) {
    if (!line.trim()) continue;
    const fields = line.split("|");
    if (fields.length !== NCES_COLUMNS.count) continue;

    totalRows += 1;

    const ncessch = fields[NCES_COLUMNS.ncessch]!.trim();
    // A school listed twice must not count twice.
    if (seen.has(ncessch)) {
      duplicateRows += 1;
      continue;
    }
    seen.add(ncessch);

    schoolYears.add(fields[NCES_COLUMNS.schoolYear]!.trim());

    const cbsa = fields[NCES_COLUMNS.cbsa]!.trim();
    // "00000" marks a school outside any CBSA; it belongs to no metro.
    if (!cbsa || cbsa === "00000") continue;

    counts.set(cbsa, (counts.get(cbsa) ?? 0) + 1);
    names.set(cbsa, fields[NCES_COLUMNS.cbsaName]!.trim());
  }

  return {
    counts,
    names,
    totalRows,
    uniqueSchools: seen.size,
    duplicateRows,
    schoolYears,
  };
}

interface CoverageReport {
  sources: { schools: string; population: string };
  schoolYear: string;
  populationPeriod: string;
  candidateMetros: number;
  ncesTotalRows: number;
  ncesUniqueSchools: number;
  ncesDuplicateRowsSkipped: number;
  ncesMatchedMetros: number;
  schoolsInsideCandidateMetros: number;
  withSchoolAgePopulation: number;
  withSchoolAccessRate: number;
  metrosWithoutSchools: string[];
  metrosWithoutPopulation: string[];
  notes: string[];
}

async function transform(): Promise<void> {
  const nces = await countSchoolsByCbsa();

  if (nces.uniqueSchools < 50_000) {
    throw new Error(
      `Only ${nces.uniqueSchools} unique schools parsed from NCES EDGE. The file layout changed; refusing to emit partial school data.`,
    );
  }
  if (nces.schoolYears.size !== 1 || !nces.schoolYears.has(NCES_SCHOOL_YEAR)) {
    throw new Error(
      `NCES file contains school years [${[...nces.schoolYears].join(", ")}], expected only ${NCES_SCHOOL_YEAR}. Refusing to mix collections.`,
    );
  }

  const acs = await readAcsTable();
  const cities = JSON.parse(
    await readFile(CITIES_FILE, "utf8"),
  ) as CityRecord[];

  const stats: ProcessedSchoolStat[] = [];
  const withoutSchools: string[] = [];
  const withoutPopulation: string[] = [];

  for (const city of cities) {
    const count = nces.counts.get(city.cbsaGeoid) ?? 0;
    if (count === 0) withoutSchools.push(city.metro);

    const population = schoolAgePopulation(acs.get(city.cbsaGeoid));
    if (population === null) withoutPopulation.push(city.metro);

    // Guarded rather than divided blindly: a zero or missing denominator must
    // produce missing data, never Infinity and never a zero rate.
    const rate =
      population !== null && population > 0
        ? (count / population) * SCHOOL_ACCESS_PER
        : null;

    stats.push({
      cbsaGeoid: city.cbsaGeoid,
      schoolYear: NCES_SCHOOL_YEAR,
      publicSchoolCount: count,
      schoolAgePopulation: population,
      populationPeriod: ACS_PERIOD,
      schoolsPer10kSchoolAge: rate,
    });
  }

  const report: CoverageReport = {
    sources: { schools: SOURCES.nces.key, population: SOURCES.acs.key },
    schoolYear: NCES_SCHOOL_YEAR,
    populationPeriod: ACS_PERIOD,
    candidateMetros: cities.length,
    ncesTotalRows: nces.totalRows,
    ncesUniqueSchools: nces.uniqueSchools,
    ncesDuplicateRowsSkipped: nces.duplicateRows,
    ncesMatchedMetros: stats.filter((s) => s.publicSchoolCount > 0).length,
    schoolsInsideCandidateMetros: stats.reduce(
      (total, s) => total + s.publicSchoolCount,
      0,
    ),
    withSchoolAgePopulation: stats.filter((s) => s.schoolAgePopulation !== null)
      .length,
    withSchoolAccessRate: stats.filter((s) => s.schoolsPer10kSchoolAge !== null)
      .length,
    metrosWithoutSchools: withoutSchools,
    metrosWithoutPopulation: withoutPopulation,
    notes: [
      "Schools are joined to metros on the NCES file's own CBSA identifier (OMB July 2023), never by city name.",
      "Counts are of distinct NCESSCH identifiers, so a duplicated row cannot inflate a metro.",
      "This is a count of public schools, not a measure of school quality, achievement or ranking.",
      "The EDGE geocode file carries no open/closed status column, so no status filtering is applied.",
    ],
  };

  const archiveBytes = await readFile(path.join(RAW_DIR, NCES_ARCHIVE));

  await mkdir(PROCESSED_DIR, { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(stats, null, 2)}\n`);
  await writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    PROVENANCE_FILE,
    `${JSON.stringify(
      {
        schools: {
          archive: NCES_ARCHIVE,
          sha256: createHash("sha256").update(archiveBytes).digest("hex"),
          bytes: archiveBytes.byteLength,
          member: NCES_MEMBER,
          organization: SOURCES.nces.organization,
          dataset: SOURCES.nces.dataset,
          schoolYear: NCES_SCHOOL_YEAR,
          geographyLevel: SOURCES.nces.geographyLevel,
          url: NCES_EDGE_URL,
          retrievedOn: new Date().toISOString().slice(0, 10),
          measures:
            "Presence and location of public schools. Not quality, achievement, ranking or teaching.",
        },
        schoolAgePopulation: {
          organization: SOURCES.acs.organization,
          dataset: `${SOURCES.acs.dataset} — B01001 (Sex by Age)`,
          table: "B01001",
          variables: SCHOOL_AGE_CELLS.map(
            (cell) => `B01001_E${String(cell).padStart(3, "0")}`,
          ),
          variableLabels: [
            "Male 5 to 9 years",
            "Male 10 to 14 years",
            "Male 15 to 17 years",
            "Female 5 to 9 years",
            "Female 10 to 14 years",
            "Female 15 to 17 years",
          ],
          period: ACS_PERIOD,
          geographyLevel: SOURCES.acs.geographyLevel,
          url: ACS_BASE_URL,
          retrievedOn: new Date().toISOString().slice(0, 10),
          verifiedAgainst:
            "https://api.census.gov/data/2023/acs/acs5/groups/B01001.json",
        },
      },
      null,
      2,
    )}\n`,
  );

  log(
    `  ${nces.uniqueSchools.toLocaleString()} schools, ${report.schoolsInsideCandidateMetros.toLocaleString()} inside candidate metros`,
  );
  log(
    `  ${report.withSchoolAccessRate}/${cities.length} metros have a school-access rate`,
  );
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

async function validate(): Promise<void> {
  const stats = JSON.parse(
    await readFile(OUT_FILE, "utf8"),
  ) as ProcessedSchoolStat[];
  const cities = JSON.parse(
    await readFile(CITIES_FILE, "utf8"),
  ) as CityRecord[];

  const known = new Set(cities.map((city) => city.cbsaGeoid));
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const stat of stats) {
    if (!known.has(stat.cbsaGeoid)) {
      errors.push(`${stat.cbsaGeoid}: not a candidate metro`);
    }
    if (seen.has(stat.cbsaGeoid)) {
      errors.push(`${stat.cbsaGeoid}: duplicate row`);
    }
    seen.add(stat.cbsaGeoid);

    if (stat.schoolYear !== NCES_SCHOOL_YEAR) {
      errors.push(
        `${stat.cbsaGeoid}: unexpected school year ${stat.schoolYear}`,
      );
    }
    if (
      !Number.isInteger(stat.publicSchoolCount) ||
      stat.publicSchoolCount < 0
    ) {
      errors.push(
        `${stat.cbsaGeoid}: invalid school count ${stat.publicSchoolCount}`,
      );
    }
    if (stat.schoolAgePopulation !== null && stat.schoolAgePopulation <= 0) {
      errors.push(
        `${stat.cbsaGeoid}: school-age population ${stat.schoolAgePopulation} is not positive`,
      );
    }

    const rate = stat.schoolsPer10kSchoolAge;
    if (rate !== null) {
      if (!Number.isFinite(rate)) {
        errors.push(`${stat.cbsaGeoid}: access rate ${rate} is not finite`);
      }
      if (rate < 0) {
        errors.push(`${stat.cbsaGeoid}: negative access rate ${rate}`);
      }
      // Every U.S. metro sits far below this; exceeding it means the
      // denominator was wrong rather than that schools are unusually plentiful.
      if (rate > 200) {
        errors.push(`${stat.cbsaGeoid}: access rate ${rate} implausibly high`);
      }
      if (stat.schoolAgePopulation === null || stat.schoolAgePopulation <= 0) {
        errors.push(
          `${stat.cbsaGeoid}: access rate present without a valid denominator`,
        );
      }
    } else if (
      stat.schoolAgePopulation !== null &&
      stat.schoolAgePopulation > 0
    ) {
      errors.push(
        `${stat.cbsaGeoid}: denominator available but no access rate computed`,
      );
    }
  }

  if (stats.length !== cities.length) {
    errors.push(
      `${stats.length} rows for ${cities.length} candidate metros; every metro should have a row even when the count is zero`,
    );
  }

  if (errors.length > 0) {
    for (const error of errors) log(`  ✗ ${error}`);
    throw new Error(`${errors.length} family validation error(s)`);
  }

  const withRate = stats.filter((s) => s.schoolsPer10kSchoolAge !== null);
  const rates = withRate
    .map((s) => s.schoolsPer10kSchoolAge!)
    .sort((a, b) => a - b);

  log(
    `  ✅ ${stats.length} metros, ${withRate.length} with a school-access rate`,
  );
  log(
    `     schools per 10k aged 5-17: min ${rates[0]?.toFixed(1)}, median ${rates[Math.floor(rates.length / 2)]?.toFixed(1)}, max ${rates.at(-1)?.toFixed(1)}`,
  );
}

// ---------------------------------------------------------------------------

const COMMANDS = { fetch: fetchAll, transform, validate } as const;

async function main(): Promise<void> {
  const command = process.argv[2] as keyof typeof COMMANDS | undefined;
  if (!command || !(command in COMMANDS)) {
    throw new Error(`Usage: pipeline.ts <${Object.keys(COMMANDS).join("|")}>`);
  }

  log(`family: ${command}`);
  await COMMANDS[command]();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
