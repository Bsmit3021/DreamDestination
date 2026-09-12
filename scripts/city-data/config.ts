/**
 * Configuration for the city data pipeline.
 *
 * ---------------------------------------------------------------------------
 * Candidate universe
 * ---------------------------------------------------------------------------
 * The 100 most populous U.S. **Metropolitan Statistical Areas**, ranked by ACS
 * 2023 5-year total population.
 *
 * Metro (CBSA) rather than city limits, because that is the unit every metric
 * here is published at. A "city" boundary is an administrative artefact — the
 * Atlanta city limit holds well under a tenth of the people who live in
 * Atlanta — so city-level rents and commutes would describe a different
 * population than the one a mover actually joins. Using one unit throughout
 * also avoids silently mixing geographies inside a single score.
 *
 * Micropolitan areas are excluded: they are below the ACS 1-year publication
 * threshold and have thinner coverage across these tables.
 *
 * ---------------------------------------------------------------------------
 * Geography caveat
 * ---------------------------------------------------------------------------
 * Every ACS metric is genuinely CBSA-level. Climate is NOT: NOAA publishes
 * normals per weather station, so each metro is matched to the nearest station
 * with a published annual mean. That is an approximation, and it is recorded in
 * the source's `geography_level` as `station` rather than `cbsa` so the
 * mismatch is visible in the data rather than buried here.
 */

export const UNIVERSE_SIZE = 100;

/** ACS publishes "not available" as large negative jam values, never as 0. */
export const ACS_MISSING_THRESHOLD = -100_000_000;

/** Rows for Metropolitan/Micropolitan Statistical Areas in summary files. */
export const CBSA_GEO_PREFIX = "310M700US";

export const ACS_YEAR = 2023;
export const ACS_PERIOD = "2019-2023";
export const ACS_BASE_URL = `https://www2.census.gov/programs-surveys/acs/summary_file/${ACS_YEAR}/table-based-SF/data/5YRData`;

export const FBI_CIUS_YEAR = 2025;
export const FBI_CDE_DOWNLOADS_URL =
  "https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/downloads";

/**
 * The pinned Overture Maps release.
 *
 * Verified against the official release calendar as the current *published*
 * release rather than taken from a schedule: proposed future dates appear
 * there before their data exists, and a pipeline must never silently follow
 * one. Pinned so a re-run reproduces the same dataset.
 */
/** OEWS reporting period, shared by the transform and the seed. */
export const OEWS_PERIOD = "May 2025";

export const OVERTURE_RELEASE = "2026-08-19.0";
export const OVERTURE_S3_BASE = "s3://overturemaps-us-west-2/release";

/** Schools counted per this many residents; places per this many residents. */
export const LIFESTYLE_PLACES_PER = 100_000;

export const CENSUS_CBSA_VINTAGE = "2025";
export const CENSUS_CBSA_BOUNDARY_URL =
  "https://www2.census.gov/geo/tiger/TIGER2025/CBSA/tl_2025_us_cbsa.zip";

export const NCES_SCHOOL_YEAR = "2024-2025";
export const NCES_EDGE_URL =
  "https://nces.ed.gov/programs/edge/data/EDGE_GEOCODE_PUBLICSCH_2425.zip";

export const GAZETTEER_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_cbsa_national.zip";

export const NOAA_INVENTORY_URL =
  "https://www.ncei.noaa.gov/data/normals-annualseasonal/1991-2020/doc/inventory_30yr.txt";
export const NOAA_STATION_BASE_URL =
  "https://www.ncei.noaa.gov/data/normals-annualseasonal/1991-2020/access";

/** ACS tables to download, keyed by the lowercase table id used in filenames. */
export const ACS_TABLES = [
  "b01003", // Total population
  "b25064", // Median gross rent
  "b25071", // Median gross rent as a percentage of household income
  "b23025", // Employment status for the population 16+
  "b15003", // Educational attainment for the population 25+
  "b08013", // Aggregate travel time to work
  "b08303", // Travel time to work (used for the worker denominator)
  "b27001", // Health insurance coverage by sex and age
] as const;

export type AcsTableId = (typeof ACS_TABLES)[number];

/** Provenance rows, mirrored into `metric_sources` by the seed script. */
export const SOURCES = {
  acs: {
    key: "acs-2023-5yr",
    organization: "U.S. Census Bureau",
    dataset:
      "American Community Survey 5-Year Estimates, Table-Based Summary File",
    url: ACS_BASE_URL,
    period: ACS_PERIOD,
    geographyLevel: "cbsa" as const,
    notes:
      "Five-year estimates are used because they are the only ACS product published for every metro consistently. Values are period estimates for 2019-2023, not single-year figures.",
  },
  noaa: {
    key: "noaa-normals-1991-2020",
    organization: "NOAA National Centers for Environmental Information",
    dataset: "U.S. Climate Normals, Annual/Seasonal, 1991-2020",
    url: NOAA_STATION_BASE_URL,
    period: "1991-2020",
    geographyLevel: "station" as const,
    notes:
      "Station-level, not metro-level: each metro is matched to the nearest station publishing an annual mean temperature. Recorded as `station` geography so the mismatch with the ACS metrics stays visible.",
  },
  fbi: {
    key: "fbi-cius-2025",
    organization: "U.S. Federal Bureau of Investigation",
    dataset:
      "Uniform Crime Reporting Program, Crime in the United States 2025, Table 6 (by Metropolitan Statistical Area)",
    url: FBI_CDE_DOWNLOADS_URL,
    period: "2025",
    geographyLevel: "cbsa" as const,
    notes:
      'Finalised annual release, published within "Reported Crimes in the Nation, 2025"; 17,075 agencies covering 96.2% of the population served by agencies eligible to participate. Rates are the FBI\'s own published per-100,000 MSA figures, never a sum over police agencies and never a principal city standing in for its metro. Where the FBI printed an "Estimated total" row the rate accounts for agencies that did not report a full year. Metro-level only: these figures describe an entire metropolitan area and say nothing about a neighbourhood or an individual. Table 6 notes limited 2025 data for Florida and North Dakota.',
  },
  nces: {
    key: "nces-edge-2024-25",
    organization:
      "U.S. Department of Education, National Center for Education Statistics",
    dataset:
      "EDGE Public School Locations, 2024-25 (Common Core of Data geocodes)",
    url: NCES_EDGE_URL,
    period: NCES_SCHOOL_YEAR,
    geographyLevel: "cbsa" as const,
    notes:
      "Point locations for public elementary and secondary schools, joined to metros on the file's own CBSA identifier (OMB July 2023 definitions). Measures where public schools are, and nothing else: NCES EDGE publishes locations, not quality, achievement, ratings or teaching. The geocode file carries no open/closed status field, so no status filtering is applied.",
  },
  overture: {
    key: "overture-places-2026-08-19",
    organization: "Overture Maps Foundation",
    dataset: "Overture Maps Places, release 2026-08-19.0 (schema v1.18.0)",
    url: "https://docs.overturemaps.org/guides/places/",
    period: OVERTURE_RELEASE,
    geographyLevel: "cbsa" as const,
    /**
     * Places is an aggregation of upstream datasets under *different* licences,
     * not a single one. Calling the whole release CDLA Permissive 2.0 would be
     * wrong, and DreamDestination cannot attribute row by row because the
     * extraction aggregates counts and never retains the per-place `sources`
     * field. The honest description is therefore: derived aggregate statistics
     * built from the release, with the upstream breakdown pointed at Overture's
     * official attribution page rather than restated or guessed.
     */
    license:
      "Mixed upstream licensing (CDLA Permissive 2.0, Apache 2.0, CC0 1.0)",
    licenseUrl: "https://docs.overturemaps.org/attribution/",
    attribution:
      'Derived from Overture Maps Places (Overture Maps Foundation, overturemaps.org). The Places release aggregates upstream sources under different licences — CDLA Permissive 2.0 (Meta, Microsoft, PinMeTo, Krick, RenderSEO, DAC, BrightQuery), Apache 2.0 (Foursquare) and CC0 1.0 (AllThePlaces). Foursquare data carries the notice "Copyright 2024 Foursquare Labs, Inc. All rights reserved."; see NOTICE.txt at opensource.foursquare.com. Full breakdown: https://docs.overturemaps.org/attribution/',
    notes:
      "Point locations for real-world entities, assigned to metros by point-in-polygon against official Census TIGER/Line 2025 CBSA boundaries. Classified on `basic_category` under the current taxonomy; the deprecated `categories` property is not used. Counts measure availability and breadth only — never quality, popularity, ratings, opening hours or walkability. Permanently closed places and places Overture is certain no longer exist (confidence 0) are excluded; a place whose category is absent from the committed mapping enters no bucket. DreamDestination stores only derived per-metro, per-category aggregate counts — never raw place records — and does not retain per-place source attribution, so upstream licensing is documented at the release level rather than per row.",
  },
  gazetteer: {
    key: "census-gazetteer-2024",
    organization: "U.S. Census Bureau",
    dataset: "2024 Gazetteer Files, Core Based Statistical Areas",
    url: GAZETTEER_URL,
    period: "2024",
    geographyLevel: "cbsa" as const,
    notes: "Provides CBSA names and internal-point coordinates.",
  },
} as const;

/**
 * The metrics derived from the ACS tables.
 *
 * Each label states exactly what the source measures. None of them is renamed
 * into a stronger claim — `rent_share_of_income` is a rent burden, not an
 * "affordability score"; the transformation into a score happens in the
 * matching engine, not here.
 */
export interface DerivedMetricSpec {
  metricKey: string;
  dimension: string;
  unit: string;
  sourceKey: string;
  /** Computes the value, or null when the inputs are unavailable. */
  compute: (
    get: (table: AcsTableId, cell: number) => number | null,
  ) => number | null;
}

function ratioPercent(
  numerator: number | null,
  denominator: number | null,
): number | null {
  if (numerator === null || denominator === null) return null;
  if (denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

/** B27001 cells reporting "No health insurance coverage", male then female. */
const UNINSURED_CELLS = [
  5,
  8,
  11,
  14,
  17,
  20,
  23,
  26,
  29, // male age bands
  33,
  36,
  39,
  42,
  45,
  48,
  51,
  54,
  57, // female age bands
];

export const DERIVED_METRICS: DerivedMetricSpec[] = [
  {
    metricKey: "median_gross_rent",
    dimension: "housing",
    unit: "usd_per_month",
    sourceKey: SOURCES.acs.key,
    compute: (get) => get("b25064", 1),
  },
  {
    metricKey: "rent_share_of_income",
    dimension: "cost",
    unit: "percent",
    sourceKey: SOURCES.acs.key,
    compute: (get) => get("b25071", 1),
  },
  {
    metricKey: "unemployment_rate",
    dimension: "career",
    unit: "percent",
    sourceKey: SOURCES.acs.key,
    // Unemployed (E005) over the civilian labour force (E003).
    compute: (get) => ratioPercent(get("b23025", 5), get("b23025", 3)),
  },
  {
    metricKey: "bachelors_or_higher_share",
    dimension: "education",
    unit: "percent",
    sourceKey: SOURCES.acs.key,
    // Bachelor's + master's + professional + doctorate, over all adults 25+.
    compute: (get) => {
      const total = get("b15003", 1);
      const parts = [22, 23, 24, 25].map((cell) => get("b15003", cell));
      if (parts.some((part) => part === null)) return null;
      const attained = parts.reduce<number>(
        (sum, part) => sum + (part ?? 0),
        0,
      );
      return ratioPercent(attained, total);
    },
  },
  {
    metricKey: "mean_commute_minutes",
    dimension: "transport",
    unit: "minutes",
    sourceKey: SOURCES.acs.key,
    // Aggregate minutes over the number of commuters.
    compute: (get) => {
      const aggregate = get("b08013", 1);
      const workers = get("b08303", 1);
      if (aggregate === null || workers === null || workers <= 0) return null;
      return aggregate / workers;
    },
  },
  {
    metricKey: "uninsured_share",
    dimension: "healthcare",
    unit: "percent",
    sourceKey: SOURCES.acs.key,
    compute: (get) => {
      const total = get("b27001", 1);
      const cells = UNINSURED_CELLS.map((cell) => get("b27001", cell));
      if (cells.some((cell) => cell === null)) return null;
      const uninsured = cells.reduce<number>(
        (sum, cell) => sum + (cell ?? 0),
        0,
      );
      return ratioPercent(uninsured, total);
    },
  },
];

/** Highest B27001 cell index the uninsured calculation depends on. */
export const B27001_REQUIRED_CELLS = Math.max(...UNINSURED_CELLS);
