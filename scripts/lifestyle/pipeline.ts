/**
 * Lifestyle pipeline: fetch -> (extract) -> transform -> validate.
 *
 *   npm run data:lifestyle:fetch      Census CBSA boundaries
 *   npm run data:lifestyle:extract    Overture -> per-metro counts (Python)
 *   npm run data:lifestyle:transform  counts -> canonical dataset + coverage
 *   npm run data:lifestyle:validate
 *
 * The extract step is Python because it is the only one that needs a
 * geospatial engine; see scripts/lifestyle/extract_places.py. Everything here
 * is ordinary TypeScript over its output, as with the other pipelines.
 *
 * ---------------------------------------------------------------------------
 * What this measures
 * ---------------------------------------------------------------------------
 * How many places of each kind Overture records inside a metro's official CBSA
 * polygon, and how many that is per resident. Availability and breadth — never
 * quality, popularity, ratings, walkability or how good a night out is.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  CENSUS_CBSA_BOUNDARY_URL,
  CENSUS_CBSA_VINTAGE,
  LIFESTYLE_PLACES_PER,
  OVERTURE_RELEASE,
  SOURCES,
} from "../city-data/config";
import { CITIES_FILE, PROCESSED_DIR, RAW_DIR, log } from "../city-data/shared";

const BOUNDARY_ARCHIVE = "tl_2025_us_cbsa.zip";
const MAPPING_FILE = path.join(import.meta.dirname, "taxonomy-mapping.json");
const COUNTS_FILE = path.join(RAW_DIR, "lifestyle-counts.tsv");
const AUDIT_FILE = path.join(RAW_DIR, "lifestyle-extraction-audit.json");

const OUT_FILE = path.join(PROCESSED_DIR, "lifestyle-stats.json");
const REPORT_FILE = path.join(PROCESSED_DIR, "lifestyle-coverage.json");
const PROVENANCE_FILE = path.join(PROCESSED_DIR, "lifestyle-provenance.json");

/** One metro/category measurement, ready to seed. */
export interface ProcessedLifestyleStat {
  cbsaGeoid: string;
  metro: string;
  category: string;
  /** Distinct Overture place ids inside the CBSA polygon. Zero is real. */
  placeCount: number;
  population: number;
  placesPer100k: number;
  sourceRelease: string;
  taxonomyMappingVersion: string;
  extractedOn: string;
}

interface ExtractionAudit {
  overtureRelease: string;
  overtureSchemaVersion: string;
  taxonomyMappingVersion: string;
  classifiedOn: string;
  boundarySource: string;
  extractedAt: string;
  extractedOn: string;
  candidateMetros: number;
  metrosMatchedToPolygon: number;
  mappedBasicCategories: number;
  classifiedUsPlacesConsidered: number;
  uniqueIdsConsidered: number;
  duplicateRowsCollapsed: number;
  placesInsideCandidateMetros: number;
  exclusions: Record<string, string>;
}

interface CityRecord {
  slug: string;
  metro: string;
  cbsaGeoid: string;
}

interface TaxonomyMapping {
  version: string;
  overtureRelease: string;
  classifiedOn: string;
  categories: Record<
    string,
    { label: string; members: { basicCategory: string }[] }
  >;
}

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

async function fetchBoundaries(): Promise<void> {
  const destination = path.join(RAW_DIR, BOUNDARY_ARCHIVE);

  try {
    const existing = await readFile(destination);
    if (existing.byteLength > 0) {
      log(`  ${BOUNDARY_ARCHIVE}: already downloaded, skipping`);
      return;
    }
  } catch {
    /* not present yet */
  }

  const response = await fetch(CENSUS_CBSA_BOUNDARY_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to download Census CBSA boundaries: HTTP ${response.status}`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(destination, bytes);
  log(`  ${BOUNDARY_ARCHIVE}: ${bytes.byteLength.toLocaleString()} bytes`);
  log("  next: npm run data:lifestyle:extract");
}

// ---------------------------------------------------------------------------
// transform
// ---------------------------------------------------------------------------

interface CoverageReport {
  source: string;
  overtureRelease: string;
  overtureSchemaVersion: string;
  taxonomyMappingVersion: string;
  censusBoundaryVintage: string;
  extractedOn: string;
  candidateMetros: number;
  metrosMatchedToPolygon: number;
  metrosWithAnyPlace: number;
  metrosWithEveryCategory: number;
  metrosWithLifestyleFit: number;
  supportedCategories: string[];
  classifiedUsPlacesConsidered: number;
  duplicateRowsCollapsed: number;
  placesInsideCandidateMetros: number;
  classificationCoverage: {
    placesInsideCandidateMetros: number;
    shareOfClassifiedUsPlaces: number;
  };
  populationCoverage: { metrosWithPositivePopulation: number };
  countsByCategory: Record<string, number>;
  zeroCountRows: { metro: string; category: string }[];
  exclusions: Record<string, string>;
  notes: string[];
}

async function transform(): Promise<void> {
  const audit = JSON.parse(
    await readFile(AUDIT_FILE, "utf8"),
  ) as ExtractionAudit;
  const mapping = JSON.parse(
    await readFile(MAPPING_FILE, "utf8"),
  ) as TaxonomyMapping;

  if (audit.overtureRelease !== OVERTURE_RELEASE) {
    throw new Error(
      `Extraction used Overture ${audit.overtureRelease} but the pipeline is pinned to ${OVERTURE_RELEASE}. Re-run the extractor before transforming.`,
    );
  }

  const text = await readFile(COUNTS_FILE, "utf8");
  const lines = text.trim().split("\n");
  const header = lines[0]?.split("\t") ?? [];

  if (header.join(",") !== "cbsa,metro,category,place_count,population") {
    throw new Error(
      `${COUNTS_FILE} has unexpected columns [${header.join(", ")}]. Re-run \`npm run data:lifestyle:extract\`.`,
    );
  }

  const cities = JSON.parse(
    await readFile(CITIES_FILE, "utf8"),
  ) as CityRecord[];
  const metroByCbsa = new Map(cities.map((city) => [city.cbsaGeoid, city]));
  const supported = Object.keys(mapping.categories).sort();

  const stats: ProcessedLifestyleStat[] = [];
  const seen = new Set<string>();

  for (const line of lines.slice(1)) {
    const [cbsa, metro, category, count, population] = line.split("\t");
    if (!cbsa || !category) continue;

    if (!metroByCbsa.has(cbsa)) {
      throw new Error(
        `Counts contain CBSA ${cbsa}, which is not a candidate metro. The extractor and cities.json disagree.`,
      );
    }
    if (!supported.includes(category)) {
      throw new Error(
        `Counts contain category "${category}", which is not in the committed mapping. Re-run the extractor.`,
      );
    }

    const key = `${cbsa}:${category}`;
    if (seen.has(key)) {
      throw new Error(
        `Duplicate row for ${key}; the extractor emitted it twice.`,
      );
    }
    seen.add(key);

    const placeCount = Number(count);
    const populationValue = Number(population);

    // A zero population would make the rate meaningless rather than large, so
    // it is rejected here rather than divided by.
    if (!Number.isFinite(populationValue) || populationValue <= 0) {
      throw new Error(
        `${metro}: population ${population} is not usable as a denominator`,
      );
    }
    if (!Number.isInteger(placeCount) || placeCount < 0) {
      throw new Error(`${metro}/${category}: invalid place count ${count}`);
    }

    stats.push({
      cbsaGeoid: cbsa,
      metro: metro ?? metroByCbsa.get(cbsa)!.metro,
      category,
      placeCount,
      population: populationValue,
      placesPer100k: (placeCount / populationValue) * LIFESTYLE_PLACES_PER,
      sourceRelease: audit.overtureRelease,
      taxonomyMappingVersion: audit.taxonomyMappingVersion,
      extractedOn: audit.extractedOn,
    });
  }

  const expected = cities.length * supported.length;
  if (stats.length !== expected) {
    throw new Error(
      `Expected ${expected} metro/category rows (${cities.length} metros x ${supported.length} categories) but found ${stats.length}. Coverage dropped — investigate before seeding.`,
    );
  }

  const byMetro = new Map<string, ProcessedLifestyleStat[]>();
  for (const stat of stats) {
    byMetro.set(stat.cbsaGeoid, [...(byMetro.get(stat.cbsaGeoid) ?? []), stat]);
  }

  const countsByCategory: Record<string, number> = {};
  for (const category of supported) {
    countsByCategory[category] = stats
      .filter((stat) => stat.category === category)
      .reduce((total, stat) => total + stat.placeCount, 0);
  }

  const report: CoverageReport = {
    source: SOURCES.overture.key,
    overtureRelease: audit.overtureRelease,
    overtureSchemaVersion: audit.overtureSchemaVersion,
    taxonomyMappingVersion: audit.taxonomyMappingVersion,
    censusBoundaryVintage: CENSUS_CBSA_VINTAGE,
    extractedOn: audit.extractedOn,
    candidateMetros: cities.length,
    metrosMatchedToPolygon: audit.metrosMatchedToPolygon,
    metrosWithAnyPlace: [...byMetro.values()].filter((rows) =>
      rows.some((row) => row.placeCount > 0),
    ).length,
    metrosWithEveryCategory: [...byMetro.values()].filter((rows) =>
      rows.every((row) => row.placeCount > 0),
    ).length,
    metrosWithLifestyleFit: [...byMetro.values()].filter((rows) =>
      rows.some((row) => row.placeCount > 0),
    ).length,
    supportedCategories: supported,
    classifiedUsPlacesConsidered: audit.classifiedUsPlacesConsidered,
    duplicateRowsCollapsed: audit.duplicateRowsCollapsed,
    placesInsideCandidateMetros: audit.placesInsideCandidateMetros,
    classificationCoverage: {
      placesInsideCandidateMetros: audit.placesInsideCandidateMetros,
      shareOfClassifiedUsPlaces:
        audit.placesInsideCandidateMetros / audit.classifiedUsPlacesConsidered,
    },
    populationCoverage: {
      metrosWithPositivePopulation: byMetro.size,
    },
    countsByCategory,
    // A measured zero is a real finding, not missing data — but a broad
    // lifestyle category reading zero for a top-100 metro would be suspicious,
    // so every one is listed rather than counted.
    zeroCountRows: stats
      .filter((stat) => stat.placeCount === 0)
      .map((stat) => ({ metro: stat.metro, category: stat.category })),
    exclusions: audit.exclusions,
    notes: [
      "Places are assigned to a metro by point-in-polygon against the official Census CBSA boundary, joined on the five-digit CBSA code. No radius, city limit, principal-city boundary, county guess, geocode or name match is involved.",
      "Each Overture place carries exactly one basic_category, and each basic_category belongs to exactly one DreamDestination bucket, so a place is counted at most once overall.",
      "A place whose basic_category is absent from the committed mapping is unclassified and enters no bucket.",
      "Counts measure availability and breadth. They say nothing about quality, popularity, ratings, opening hours or walkability.",
    ],
  };

  const boundaryBytes = await readFile(path.join(RAW_DIR, BOUNDARY_ARCHIVE));

  await mkdir(PROCESSED_DIR, { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(stats, null, 2)}\n`);
  await writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(
    PROVENANCE_FILE,
    `${JSON.stringify(
      {
        places: {
          organization: SOURCES.overture.organization,
          dataset: SOURCES.overture.dataset,
          release: audit.overtureRelease,
          schemaVersion: audit.overtureSchemaVersion,
          accessLocation: `s3://overturemaps-us-west-2/release/${audit.overtureRelease}/theme=places/type=place/`,
          provider: "Overture Maps Foundation public S3 bucket (us-west-2)",
          classifiedOn: audit.classifiedOn,
          taxonomyMappingVersion: audit.taxonomyMappingVersion,
          taxonomyMappingFile: "scripts/lifestyle/taxonomy-mapping.json",
          extractedAt: audit.extractedAt,
          placesConsidered: audit.classifiedUsPlacesConsidered,
          placesClassifiedInsideMetros: audit.placesInsideCandidateMetros,
          duplicateRowsCollapsed: audit.duplicateRowsCollapsed,
          exclusions: audit.exclusions,
          // Places aggregates upstream datasets under different licences, so
          // the release is not describable by a single one. The extraction
          // aggregates counts and does not retain the per-place `sources`
          // field, so no row-level attribution exists to record — inventing
          // one would be worse than pointing at the authoritative page.
          licensing: {
            summary:
              "Mixed upstream licensing. DreamDestination publishes derived aggregate metro/category statistics built from the Overture Places release, not the underlying records.",
            upstreamLicenses: {
              "CDLA Permissive 2.0": [
                "Meta",
                "Microsoft",
                "PinMeTo",
                "Krick",
                "RenderSEO",
                "DAC",
                "BrightQuery",
              ],
              "Apache 2.0": ["Foursquare"],
              "CC0 1.0": ["AllThePlaces"],
            },
            foursquareNotice:
              "Copyright 2024 Foursquare Labs, Inc. All rights reserved. See NOTICE.txt at opensource.foursquare.com.",
            attributionPage: SOURCES.overture.licenseUrl,
            citation: "Overture Maps Foundation, overturemaps.org",
            rowLevelAttributionRetained: false,
            rowLevelAttributionNote:
              "The extraction aggregates to metro/category counts and discards the per-place `sources` field, so upstream licensing is documented at release level. No per-record attribution is claimed or fabricated.",
          },
          rawRecordsCommitted: false,
        },
        boundaries: {
          organization: "U.S. Census Bureau",
          dataset: `TIGER/Line Shapefiles, Core Based Statistical Areas, ${CENSUS_CBSA_VINTAGE}`,
          vintage: CENSUS_CBSA_VINTAGE,
          url: CENSUS_CBSA_BOUNDARY_URL,
          archive: BOUNDARY_ARCHIVE,
          sha256: createHash("sha256").update(boundaryBytes).digest("hex"),
          bytes: boundaryBytes.byteLength,
          joinKey: "CBSAFP (five-digit CBSA code)",
          retrievedOn: audit.extractedOn,
        },
        population: {
          organization: SOURCES.acs.organization,
          dataset: `${SOURCES.acs.dataset} — B01003 (total population)`,
          period: SOURCES.acs.period,
          note: "Reuses the ACS metro population DreamDestination already stores. No additional population source was fetched for this phase.",
        },
      },
      null,
      2,
    )}\n`,
  );

  log(
    `  ${stats.length} metro/category rows across ${byMetro.size} metros, ${supported.length} categories`,
  );
  log(
    `  ${audit.placesInsideCandidateMetros.toLocaleString()} places inside candidate metros`,
  );
  if (report.zeroCountRows.length > 0) {
    log(`  ${report.zeroCountRows.length} zero-count rows (investigate):`);
    for (const row of report.zeroCountRows.slice(0, 12)) {
      log(`    - ${row.metro} / ${row.category}`);
    }
  }
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

async function validate(): Promise<void> {
  const stats = JSON.parse(
    await readFile(OUT_FILE, "utf8"),
  ) as ProcessedLifestyleStat[];
  const cities = JSON.parse(
    await readFile(CITIES_FILE, "utf8"),
  ) as CityRecord[];

  const known = new Set(cities.map((city) => city.cbsaGeoid));
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const stat of stats) {
    const key = `${stat.cbsaGeoid}:${stat.category}`;
    if (seen.has(key)) errors.push(`${key}: duplicate row`);
    seen.add(key);

    if (!known.has(stat.cbsaGeoid)) {
      errors.push(`${stat.cbsaGeoid}: not a candidate metro`);
    }
    if (stat.sourceRelease !== OVERTURE_RELEASE) {
      errors.push(
        `${key}: release ${stat.sourceRelease} is not the pinned ${OVERTURE_RELEASE}`,
      );
    }
    if (!Number.isInteger(stat.placeCount) || stat.placeCount < 0) {
      errors.push(`${key}: invalid place count ${stat.placeCount}`);
    }
    if (!Number.isFinite(stat.population) || stat.population <= 0) {
      errors.push(
        `${key}: population ${stat.population} is not a usable denominator`,
      );
    }
    if (!Number.isFinite(stat.placesPer100k) || stat.placesPer100k < 0) {
      errors.push(
        `${key}: rate ${stat.placesPer100k} is not finite and non-negative`,
      );
    }

    const expected = (stat.placeCount / stat.population) * LIFESTYLE_PLACES_PER;
    if (Math.abs(stat.placesPer100k - expected) > 1e-6) {
      errors.push(
        `${key}: rate ${stat.placesPer100k} does not match count/population`,
      );
    }
    // Every US metro sits far below this. Exceeding it means the denominator
    // was wrong rather than that the metro is unusually well supplied.
    if (stat.placesPer100k > 5_000) {
      errors.push(`${key}: rate ${stat.placesPer100k} implausibly high`);
    }
  }

  const categories = new Set(stats.map((stat) => stat.category));
  const expectedRows = cities.length * categories.size;
  if (stats.length !== expectedRows) {
    errors.push(
      `${stats.length} rows for ${cities.length} metros x ${categories.size} categories; expected ${expectedRows}`,
    );
  }

  if (errors.length > 0) {
    for (const error of errors.slice(0, 20)) log(`  ✗ ${error}`);
    throw new Error(`${errors.length} lifestyle validation error(s)`);
  }

  const rates = stats.map((stat) => stat.placesPer100k).sort((a, b) => a - b);
  log(
    `  ✅ ${stats.length} rows, ${new Set(stats.map((s) => s.cbsaGeoid)).size} metros, ${categories.size} categories`,
  );
  log(
    `     places per 100k: min ${rates[0]?.toFixed(1)}, median ${rates[Math.floor(rates.length / 2)]?.toFixed(1)}, max ${rates.at(-1)?.toFixed(1)}`,
  );
  log(
    `     zero-count rows: ${stats.filter((s) => s.placeCount === 0).length}`,
  );
}

// ---------------------------------------------------------------------------

const COMMANDS = { fetch: fetchBoundaries, transform, validate } as const;

async function main(): Promise<void> {
  const command = process.argv[2] as keyof typeof COMMANDS | undefined;
  if (!command || !(command in COMMANDS)) {
    throw new Error(`Usage: pipeline.ts <${Object.keys(COMMANDS).join("|")}>`);
  }

  log(`lifestyle: ${command}`);
  await COMMANDS[command]();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
