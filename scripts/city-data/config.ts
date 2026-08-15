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
