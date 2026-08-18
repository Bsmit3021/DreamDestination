/**
 * Housing pipeline: fetch -> transform -> validate, driven by a subcommand.
 *
 *   npm run data:housing:fetch
 *   npm run data:housing:transform
 *   npm run data:housing:validate
 *
 * Reuses the Phase 3 ACS approach: stream each summary file, keep only metro
 * rows, discard the rest. Same CBSA geography as every other metric, so the
 * join is on identifiers and needs no crosswalk.
 *
 * Tables:
 *   B25031  Median gross rent by bedrooms (studio .. 5+)
 *   B25077  Median value of owner-occupied units
 */

import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ACS_BASE_URL,
  ACS_MISSING_THRESHOLD,
  ACS_PERIOD,
  CBSA_GEO_PREFIX,
  SOURCES,
} from "../city-data/config";
import { PROCESSED_DIR, RAW_DIR, log } from "../city-data/shared";

const TABLES = ["b25031", "b25077"] as const;
type TableId = (typeof TABLES)[number];

const OUT_FILE = path.join(PROCESSED_DIR, "housing-stats.json");
const REPORT_FILE = path.join(PROCESSED_DIR, "housing-coverage.json");

export interface ProcessedHousingStat {
  cbsaGeoid: string;
  medianGrossRent: number | null;
  studioRent: number | null;
  oneBedroomRent: number | null;
  twoBedroomRent: number | null;
  threeBedroomRent: number | null;
  fourBedroomRent: number | null;
  medianHomeValue: number | null;
}

/**
 * B25031 cell layout. Cell 1 is the overall median across all unit sizes;
 * 2..7 are studio through 5-or-more bedrooms.
 *
 * Note 4+ bedrooms: the schema stores a single `four_bedroom_rent`, so cell 6
 * (4 bedrooms) is used and cell 7 (5+) is deliberately not folded in — averaging
 * two published medians would invent a number the source never reported.
 */
const B25031_CELLS = {
  overall: 1,
  studio: 2,
  oneBedroom: 3,
  twoBedroom: 4,
  threeBedroom: 5,
  fourBedroom: 6,
} as const;

async function fetchTable(table: TableId): Promise<void> {
  const destination = path.join(RAW_DIR, `acs-${table}.psv`);

  try {
    const existing = await readFile(destination, "utf8");
    if (existing.trim().split("\n").length > 1) {
      log(`  ${table}: already downloaded, skipping`);
      return;
    }
  } catch {
    /* not present yet */
  }

  const url = `${ACS_BASE_URL}/acsdt5y2023-${table}.dat`;
  const response = await fetch(url, {
    headers: { "User-Agent": "DreamDestination-data-pipeline" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${table}: HTTP ${response.status}`);
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
      `${table} produced no metro rows; ACS layout may have changed`,
    );
  }
  log(`  ${table}: kept ${kept - 1} metro rows`);
}

/** cbsa -> cell -> value, with ACS jam values dropped rather than kept. */
async function readTable(
  table: TableId,
): Promise<Map<string, Map<number, number>>> {
  const text = await readFile(path.join(RAW_DIR, `acs-${table}.psv`), "utf8");
  const [headerLine, ...rows] = text.trim().split("\n");
  const headers = (headerLine ?? "").split("|");

  const estimates: { index: number; cell: number }[] = [];
  headers.forEach((header, index) => {
    const match = /^[A-Z0-9]+_E(\d+)$/.exec(header);
    if (match) estimates.push({ index, cell: Number.parseInt(match[1]!, 10) });
  });

  const parsed = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const columns = row.split("|");
    const geoId = columns[0] ?? "";
    if (!geoId.startsWith(CBSA_GEO_PREFIX)) continue;

    const cells = new Map<number, number>();
    for (const { index, cell } of estimates) {
      const value = Number.parseFloat(columns[index] ?? "");
      // ACS publishes "not available" as large negative jam values; a rent of
      // -666666666 must never survive as a number, and 0 would be a lie.
      if (
        Number.isFinite(value) &&
        value > ACS_MISSING_THRESHOLD &&
        value > 0
      ) {
        cells.set(cell, value);
      }
    }
    parsed.set(geoId.slice(CBSA_GEO_PREFIX.length), cells);
  }
  return parsed;
}

async function transform(): Promise<void> {
  const cities: { cbsaGeoid: string; city: string; state: string }[] =
    JSON.parse(await readFile(path.join(PROCESSED_DIR, "cities.json"), "utf8"));

  const rent = await readTable("b25031");
  const value = await readTable("b25077");

  const stats: ProcessedHousingStat[] = [];
  const missingRent: string[] = [];

  for (const city of cities) {
    const rentCells = rent.get(city.cbsaGeoid);
    const valueCells = value.get(city.cbsaGeoid);

    const pick = (cell: number) => rentCells?.get(cell) ?? null;
    const overall = pick(B25031_CELLS.overall);
    if (overall === null) missingRent.push(`${city.city}, ${city.state}`);

    stats.push({
      cbsaGeoid: city.cbsaGeoid,
      medianGrossRent: overall,
      studioRent: pick(B25031_CELLS.studio),
      oneBedroomRent: pick(B25031_CELLS.oneBedroom),
      twoBedroomRent: pick(B25031_CELLS.twoBedroom),
      threeBedroomRent: pick(B25031_CELLS.threeBedroom),
      fourBedroomRent: pick(B25031_CELLS.fourBedroom),
      medianHomeValue: valueCells?.get(1) ?? null,
    });
  }

  const report = {
    period: ACS_PERIOD,
    dreamDestinationMetros: cities.length,
    housingSourceMetros: rent.size,
    matched: stats.filter((s) => s.medianGrossRent !== null).length,
    unmatched: missingRent,
    ambiguous: 0,
    withHomeValue: stats.filter((s) => s.medianHomeValue !== null).length,
    withTwoBedroom: stats.filter((s) => s.twoBedroomRent !== null).length,
  };

  await mkdir(PROCESSED_DIR, { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(stats, null, 2)}\n`);
  await writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);

  log("ACS -> canonical housing statistics");
  log(`  DreamDestination metros: ${report.dreamDestinationMetros}`);
  log(`  Housing source metros:   ${report.housingSourceMetros}`);
  log(`  Matched:                 ${report.matched}`);
  log(`  Unmatched:               ${report.unmatched.length}`);
  log(`  Ambiguous:               ${report.ambiguous}`);
  log(`  With median home value:  ${report.withHomeValue}`);
  log(`  With 2-bedroom rent:     ${report.withTwoBedroom}`);
}

async function validate(): Promise<void> {
  const stats: ProcessedHousingStat[] = JSON.parse(
    await readFile(OUT_FILE, "utf8"),
  );
  const cities: { cbsaGeoid: string }[] = JSON.parse(
    await readFile(path.join(PROCESSED_DIR, "cities.json"), "utf8"),
  );
  const report = JSON.parse(await readFile(REPORT_FILE, "utf8"));

  const known = new Set(cities.map((c) => c.cbsaGeoid));
  const seen = new Set<string>();
  const problems: string[] = [];

  if (stats.length === 0) problems.push("No housing statistics produced.");
  if (!report.period) problems.push("Coverage report missing period.");

  for (const stat of stats) {
    const id = stat.cbsaGeoid;
    if (!known.has(id)) problems.push(`${id}: unknown metro`);
    if (seen.has(id)) problems.push(`${id}: duplicate record`);
    seen.add(id);

    const rents: [string, number | null][] = [
      ["medianGrossRent", stat.medianGrossRent],
      ["studioRent", stat.studioRent],
      ["oneBedroomRent", stat.oneBedroomRent],
      ["twoBedroomRent", stat.twoBedroomRent],
      ["threeBedroomRent", stat.threeBedroomRent],
      ["fourBedroomRent", stat.fourBedroomRent],
    ];

    for (const [name, rent] of rents) {
      if (rent === null) continue;
      if (typeof rent !== "number" || !Number.isFinite(rent)) {
        problems.push(`${id}: ${name} is not a finite number`);
      } else if (rent <= 0) {
        // The schema's CHECK forbids this; a zero rent is impossible, not free.
        problems.push(`${id}: ${name} is zero or negative (${rent})`);
      } else if (rent > 20_000) {
        problems.push(`${id}: ${name} implausibly high (${rent})`);
      }
    }

    if (stat.medianHomeValue !== null) {
      if (!Number.isFinite(stat.medianHomeValue) || stat.medianHomeValue <= 0) {
        problems.push(`${id}: medianHomeValue invalid`);
      } else if (stat.medianHomeValue > 10_000_000) {
        problems.push(`${id}: medianHomeValue implausibly high`);
      }
    }
  }

  if (report.unmatched?.length > 0) {
    problems.push(`${report.unmatched.length} metros without a rent benchmark`);
  }

  if (problems.length > 0) {
    log(`\n❌ Housing validation failed with ${problems.length} problem(s):\n`);
    for (const problem of problems.slice(0, 30)) log(`  • ${problem}`);
    process.exit(1);
  }

  log(`✅ ${stats.length} housing records valid (${report.period}).`);
  log(
    `   matched:            ${report.matched}/${report.dreamDestinationMetros}`,
  );
  log(`   with home value:    ${report.withHomeValue}`);
  log(`   with 2-bedroom:     ${report.withTwoBedroom}`);
  log(`   source: ${SOURCES.acs.organization}`);
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === "fetch") {
    await mkdir(RAW_DIR, { recursive: true });
    log("Downloading ACS housing tables (filtered to metro rows)…");
    for (const table of TABLES) await fetchTable(table);
    log("Next: npm run data:housing:transform");
  } else if (command === "transform") {
    await transform();
    log("Next: npm run data:housing:validate");
  } else if (command === "validate") {
    await validate();
    log("Next: npm run data:housing:seed");
  } else {
    throw new Error(`Unknown command "${command}" (fetch|transform|validate)`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
