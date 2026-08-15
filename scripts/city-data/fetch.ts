/**
 * Step 1 of the pipeline: download raw source data.
 *
 * Writes to `data/raw/`, which is gitignored — everything here is reproducible
 * by re-running the script, so there is no reason to commit it.
 *
 * ACS summary files are ~17 MB each and 99% of every file is geographies we do
 * not use. They are filtered to metro rows as they stream in, so the download
 * never lands on disk at full size.
 *
 *   npm run data:fetch
 */

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ACS_BASE_URL,
  ACS_TABLES,
  ACS_YEAR,
  CBSA_GEO_PREFIX,
  GAZETTEER_URL,
  UNIVERSE_SIZE,
  NOAA_INVENTORY_URL,
  NOAA_STATION_BASE_URL,
  type AcsTableId,
} from "./config";
import { RAW_DIR, haversineMiles, log, parseCsvLine } from "./shared";

/** Streams a URL through a line filter, keeping only the rows we need. */
async function downloadFiltered(
  url: string,
  destination: string,
  keep: (line: string) => boolean,
): Promise<number> {
  const response = await fetch(url, {
    headers: { "User-Agent": "DreamDestination-data-pipeline" },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }

  const out = createWriteStream(destination);
  let carry = "";
  let kept = 0;

  const decoder = new TextDecoder();

  // Respects backpressure: without it the write buffer grows unboundedly while
  // the network outruns the disk.
  const write = async (line: string): Promise<void> => {
    if (!out.write(`${line}\n`)) {
      await new Promise<void>((resolve) => out.once("drain", () => resolve()));
    }
  };

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    carry += decoder.decode(chunk, { stream: true });
    const lines = carry.split("\n");
    carry = lines.pop() ?? "";

    for (const line of lines) {
      if (keep(line)) {
        await write(line);
        kept += 1;
      }
    }
  }

  if (carry && keep(carry)) {
    await write(carry);
    kept += 1;
  }

  await new Promise<void>((resolve, reject) => {
    out.end((error?: Error | null) => (error ? reject(error) : resolve()));
  });

  return kept;
}

/** True when a filtered file already holds a header plus at least one row. */
async function alreadyComplete(destination: string): Promise<boolean> {
  try {
    const existing = await readFile(destination, "utf8");
    return existing.trim().split("\n").length > 1;
  } catch {
    return false;
  }
}

async function fetchAcsTable(table: AcsTableId): Promise<void> {
  const url = `${ACS_BASE_URL}/acsdt5y${ACS_YEAR}-${table}.dat`;
  const destination = path.join(RAW_DIR, `acs-${table}.psv`);

  // Resumable: re-running after an interruption skips what already landed.
  if (await alreadyComplete(destination)) {
    log(`  ${table}: already downloaded, skipping`);
    return;
  }

  const kept = await downloadFiltered(url, destination, (line) => {
    // Keep the header plus metro-area rows only.
    return line.startsWith("GEO_ID|") || line.startsWith(CBSA_GEO_PREFIX);
  });

  log(`  ${table}: kept ${kept - 1} metro rows`);

  if (kept <= 1) {
    throw new Error(
      `${table} produced no metro rows — the summary file layout may have changed.`,
    );
  }
}

/** The gazetteer is a zip; unzip is available on macOS and Linux runners. */
async function fetchGazetteer(): Promise<void> {
  const zipPath = path.join(RAW_DIR, "gazetteer-cbsa.zip");
  const response = await fetch(GAZETTEER_URL, {
    headers: { "User-Agent": "DreamDestination-data-pipeline" },
  });

  if (!response.ok) {
    throw new Error(`Failed to download gazetteer: HTTP ${response.status}`);
  }

  await writeFile(zipPath, Buffer.from(await response.arrayBuffer()));

  await new Promise<void>((resolve, reject) => {
    const unzip = spawn("unzip", ["-o", "-j", zipPath, "-d", RAW_DIR], {
      stdio: "ignore",
    });
    unzip.on("error", reject);
    unzip.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`)),
    );
  });

  log("  gazetteer: extracted");
}

interface Station {
  id: string;
  latitude: number;
  longitude: number;
}

/**
 * Parses the fixed-width station inventory.
 *
 * Restricted to `USW` stations — the airport network, which is the subset that
 * reliably publishes a full set of annual normals.
 */
function parseInventory(text: string): Station[] {
  const stations: Station[] = [];

  for (const line of text.split("\n")) {
    if (!line.startsWith("USW")) continue;

    const id = line.slice(0, 11).trim();
    const latitude = Number.parseFloat(line.slice(12, 20));
    const longitude = Number.parseFloat(line.slice(21, 30));

    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      stations.push({ id, latitude, longitude });
    }
  }

  return stations;
}

/** Reads the annual mean temperature from a station normals file. */
function parseAnnualMeanTemperature(csv: string): number | null {
  const [headerLine, valueLine] = csv.split("\n");
  if (!headerLine || !valueLine) return null;

  const headers = parseCsvLine(headerLine);
  const index = headers.indexOf("ANN-TAVG-NORMAL");
  if (index === -1) return null;

  const value = Number.parseFloat(parseCsvLine(valueLine)[index] ?? "");

  // NOAA uses -9999 for absent values.
  if (!Number.isFinite(value) || value <= -900) return null;

  return value;
}

/**
 * Matches each metro centroid to the nearest airport station that actually
 * publishes an annual mean, trying progressively further stations before
 * giving up.
 */
async function fetchClimate(): Promise<void> {
  const gazetteerPath = path.join(RAW_DIR, "2024_Gaz_cbsa_national.txt");
  const gazetteer = await readFile(gazetteerPath, "utf8");

  const inventoryResponse = await fetch(NOAA_INVENTORY_URL, {
    headers: { "User-Agent": "DreamDestination-data-pipeline" },
  });
  if (!inventoryResponse.ok) {
    throw new Error(
      `Failed to download NOAA inventory: HTTP ${inventoryResponse.status}`,
    );
  }
  const stations = parseInventory(await inventoryResponse.text());
  log(`  noaa: ${stations.length} airport stations in inventory`);

  // Only the metros that will actually make the universe need a station, so
  // rank by ACS population first rather than querying all ~390 of them.
  const populationText = await readFile(
    path.join(RAW_DIR, "acs-b01003.psv"),
    "utf8",
  );
  const populationByGeoid = new Map<string, number>();
  for (const row of populationText.trim().split("\n").slice(1)) {
    const [geoId, estimate] = row.split("|");
    if (!geoId?.startsWith(CBSA_GEO_PREFIX)) continue;
    const value = Number.parseFloat(estimate ?? "");
    if (Number.isFinite(value) && value > 0) {
      populationByGeoid.set(geoId.slice(CBSA_GEO_PREFIX.length), value);
    }
  }

  const metros = gazetteer
    .split("\n")
    .slice(1)
    .map((line) => line.split("\t").map((c) => c.trim()))
    // Gazetteer columns: CSAFP, GEOID, NAME, CBSA_TYPE, …, INTPTLAT, INTPTLONG
    .filter(
      (columns) => columns.length >= 10 && columns[2]?.endsWith("Metro Area"),
    )
    .map((columns) => ({
      geoid: columns[1] ?? "",
      latitude: Number.parseFloat(columns[8] ?? ""),
      longitude: Number.parseFloat(columns[9] ?? ""),
      population: populationByGeoid.get(columns[1] ?? "") ?? 0,
    }))
    .filter(
      (metro) =>
        metro.geoid &&
        Number.isFinite(metro.latitude) &&
        Number.isFinite(metro.longitude) &&
        metro.population > 0,
    )
    .sort(
      (a, b) => b.population - a.population || a.geoid.localeCompare(b.geoid),
    )
    .slice(0, UNIVERSE_SIZE);

  const results: Record<string, { stationId: string; value: number }> = {};

  let processed = 0;

  for (const { geoid, latitude, longitude } of metros) {
    const nearest = stations
      .map((station) => ({
        station,
        distance: haversineMiles(
          latitude,
          longitude,
          station.latitude,
          station.longitude,
        ),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);

    for (const { station } of nearest) {
      const response = await fetch(
        `${NOAA_STATION_BASE_URL}/${station.id}.csv`,
        { headers: { "User-Agent": "DreamDestination-data-pipeline" } },
      );
      if (!response.ok) continue;

      const value = parseAnnualMeanTemperature(await response.text());
      if (value !== null) {
        results[geoid] = { stationId: station.id, value };
        break;
      }
    }

    processed += 1;
    if (processed % 50 === 0) log(`  noaa: matched ${processed} metros`);
  }

  await writeFile(
    path.join(RAW_DIR, "noaa-climate.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );

  log(`  noaa: annual means for ${Object.keys(results).length} metros`);
}

async function main(): Promise<void> {
  await mkdir(RAW_DIR, { recursive: true });

  log("Downloading Census gazetteer…");
  await fetchGazetteer();

  log("Downloading ACS tables (filtered to metro rows)…");
  for (const table of ACS_TABLES) {
    await fetchAcsTable(table);
  }

  log("Matching metros to NOAA climate stations…");
  await fetchClimate();

  log("Done. Next: npm run data:transform");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
