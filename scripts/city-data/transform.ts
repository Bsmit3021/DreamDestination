/**
 * Step 2: turn raw downloads into the canonical dataset.
 *
 * Produces `data/processed/cities.json` and `data/processed/observations.json`.
 * These are small and reproducible, so they are committed — a clone can be
 * seeded without re-downloading 140 MB of summary files.
 *
 *   npm run data:transform
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { US_STATE_CODES } from "@/lib/constants";

import {
  ACS_MISSING_THRESHOLD,
  ACS_TABLES,
  B27001_REQUIRED_CELLS,
  CBSA_GEO_PREFIX,
  DERIVED_METRICS,
  SOURCES,
  UNIVERSE_SIZE,
  type AcsTableId,
} from "./config";
import {
  CITIES_FILE,
  OBSERVATIONS_FILE,
  PROCESSED_DIR,
  RAW_DIR,
  log,
  slugify,
} from "./shared";

export interface ProcessedCity {
  slug: string;
  city: string;
  state: string;
  metro: string;
  cbsaGeoid: string;
  population: number;
  latitude: number;
  longitude: number;
}

export interface ProcessedObservation {
  citySlug: string;
  metricKey: string;
  dimension: string;
  rawValue: number;
  unit: string;
  sourceKey: string;
}

type AcsTable = Map<string, Map<number, number>>;

/**
 * Parses one filtered ACS file into `cbsaGeoid -> cell -> value`.
 *
 * ACS encodes "not available" as large negative jam values. They are dropped
 * rather than kept, because a -666666666 that reached the scorer as a number
 * would be catastrophic and a 0 would be a lie.
 */
async function readAcsTable(table: AcsTableId): Promise<AcsTable> {
  const text = await readFile(path.join(RAW_DIR, `acs-${table}.psv`), "utf8");
  const [headerLine, ...rows] = text.trim().split("\n");

  if (!headerLine) {
    throw new Error(`ACS table ${table} is empty; re-run npm run data:fetch`);
  }

  const headers = headerLine.split("|");
  const estimateColumns: { index: number; cell: number }[] = [];

  headers.forEach((header, index) => {
    const match = /^[A-Z0-9]+_E(\d+)$/.exec(header);
    if (match) {
      estimateColumns.push({ index, cell: Number.parseInt(match[1]!, 10) });
    }
  });

  if (estimateColumns.length === 0) {
    throw new Error(`ACS table ${table} exposes no estimate columns`);
  }

  const parsed: AcsTable = new Map();

  for (const row of rows) {
    const columns = row.split("|");
    const geoId = columns[0];
    if (!geoId?.startsWith(CBSA_GEO_PREFIX)) continue;

    const cbsa = geoId.slice(CBSA_GEO_PREFIX.length);
    const cells = new Map<number, number>();

    for (const { index, cell } of estimateColumns) {
      const value = Number.parseFloat(columns[index] ?? "");
      if (Number.isFinite(value) && value > ACS_MISSING_THRESHOLD) {
        cells.set(cell, value);
      }
    }

    parsed.set(cbsa, cells);
  }

  return parsed;
}

interface GazetteerEntry {
  geoid: string;
  name: string;
  latitude: number;
  longitude: number;
}

async function readGazetteer(): Promise<Map<string, GazetteerEntry>> {
  const text = await readFile(
    path.join(RAW_DIR, "2024_Gaz_cbsa_national.txt"),
    "utf8",
  );

  const entries = new Map<string, GazetteerEntry>();

  for (const line of text.split("\n").slice(1)) {
    const columns = line.split("\t").map((column) => column.trim());
    if (columns.length < 10) continue;

    // Gazetteer columns: CSAFP, GEOID, NAME, CBSA_TYPE, …, INTPTLAT, INTPTLONG
    const geoid = columns[1];
    const name = columns[2];
    const latitude = Number.parseFloat(columns[8] ?? "");
    const longitude = Number.parseFloat(columns[9] ?? "");

    // Metropolitan areas only; micropolitan areas have thinner coverage.
    if (!geoid || !name?.endsWith("Metro Area")) continue;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    entries.set(geoid, { geoid, name, latitude, longitude });
  }

  return entries;
}

/**
 * Splits "Dallas-Fort Worth-Arlington, TX Metro Area" into a leading principal
 * city and a primary state, which is what the existing `cities` table stores.
 */
function splitMetroName(name: string): { city: string; state: string } {
  const withoutSuffix = name.replace(/\s+Metro Area$/, "");
  const [places = "", states = ""] = withoutSuffix.split(", ");

  return {
    city: (places.split("-")[0] ?? places).trim(),
    state: (states.split("-")[0] ?? states).trim(),
  };
}

async function readClimate(): Promise<
  Record<string, { stationId: string; value: number }>
> {
  try {
    const text = await readFile(
      path.join(RAW_DIR, "noaa-climate.json"),
      "utf8",
    );
    return JSON.parse(text) as Record<
      string,
      { stationId: string; value: number }
    >;
  } catch {
    log("  warning: no NOAA climate file found; climate will be unavailable");
    return {};
  }
}

async function main(): Promise<void> {
  const tables = new Map<AcsTableId, AcsTable>();

  for (const table of ACS_TABLES) {
    tables.set(table, await readAcsTable(table));
  }

  // Fail loudly if the health-insurance table is narrower than the calculation
  // assumes, rather than silently summing a subset of age bands.
  const b27001 = tables.get("b27001")!;
  const sampleCells = b27001.values().next().value;
  if (!sampleCells || !sampleCells.has(B27001_REQUIRED_CELLS)) {
    throw new Error(
      `B27001 is missing cell ${B27001_REQUIRED_CELLS}; the uninsured ` +
        "calculation assumes the standard 57-cell layout and must be revisited.",
    );
  }

  const gazetteer = await readGazetteer();
  const climate = await readClimate();
  const population = tables.get("b01003")!;

  // Inclusion rule: metropolitan areas ranked by ACS total population.
  const ranked = [...gazetteer.values()]
    .map((entry) => ({
      entry,
      population: population.get(entry.geoid)?.get(1) ?? null,
    }))
    .filter(
      (candidate): candidate is { entry: GazetteerEntry; population: number } =>
        candidate.population !== null && candidate.population > 0,
    )
    .sort(
      (a, b) =>
        b.population - a.population ||
        a.entry.geoid.localeCompare(b.entry.geoid),
    )
    // Over-select so territory exclusions still leave a full universe.
    .slice(0, UNIVERSE_SIZE + 10);

  const cities: ProcessedCity[] = [];
  const observations: ProcessedObservation[] = [];
  const usedSlugs = new Set<string>();
  const skippedTerritories: string[] = [];

  for (const { entry, population: totalPopulation } of ranked) {
    const { city, state } = splitMetroName(entry.name);

    // The existing `us_state_code` domain covers the 50 states plus DC, so
    // Puerto Rico metros cannot be stored. Excluded explicitly rather than
    // failing later at insert time.
    if (!(US_STATE_CODES as readonly string[]).includes(state)) {
      skippedTerritories.push(`${city}, ${state}`);
      continue;
    }

    let slug = slugify(`${city}-${state}`);
    if (usedSlugs.has(slug)) {
      slug = slugify(`${city}-${state}-${entry.geoid}`);
    }
    usedSlugs.add(slug);

    if (cities.length >= UNIVERSE_SIZE) break;

    cities.push({
      slug,
      city,
      state,
      metro: entry.name.replace(/\s+Metro Area$/, ""),
      cbsaGeoid: entry.geoid,
      population: Math.round(totalPopulation),
      latitude: entry.latitude,
      longitude: entry.longitude,
    });

    const get = (table: AcsTableId, cell: number): number | null =>
      tables.get(table)?.get(entry.geoid)?.get(cell) ?? null;

    for (const spec of DERIVED_METRICS) {
      const value = spec.compute(get);
      if (value === null || !Number.isFinite(value)) continue;

      observations.push({
        citySlug: slug,
        metricKey: spec.metricKey,
        dimension: spec.dimension,
        rawValue: Number(value.toFixed(4)),
        unit: spec.unit,
        sourceKey: spec.sourceKey,
      });
    }

    const stationReading = climate[entry.geoid];
    if (stationReading) {
      observations.push({
        citySlug: slug,
        metricKey: "annual_mean_temperature",
        dimension: "climate",
        rawValue: Number(stationReading.value.toFixed(4)),
        unit: "degrees_fahrenheit",
        sourceKey: SOURCES.noaa.key,
      });
    }
  }

  await mkdir(PROCESSED_DIR, { recursive: true });
  await writeFile(CITIES_FILE, `${JSON.stringify(cities, null, 2)}\n`);
  await writeFile(
    OBSERVATIONS_FILE,
    `${JSON.stringify(observations, null, 2)}\n`,
  );

  const byDimension = new Map<string, number>();
  for (const observation of observations) {
    byDimension.set(
      observation.dimension,
      (byDimension.get(observation.dimension) ?? 0) + 1,
    );
  }

  if (skippedTerritories.length > 0) {
    log(
      `Excluded ${skippedTerritories.length} metro(s) outside the 50 states + DC: ` +
        skippedTerritories.join(", "),
    );
  }

  log(`Wrote ${cities.length} cities and ${observations.length} observations.`);
  for (const [dimension, count] of [...byDimension].sort()) {
    log(`  ${dimension}: ${count}/${cities.length}`);
  }
  log("Next: npm run data:validate");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
