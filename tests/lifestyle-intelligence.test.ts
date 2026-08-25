import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LIFESTYLE_CATEGORIES } from "@/lib/constants";

/**
 * The geography, classification and integrity guarantees of the lifestyle
 * pipeline, asserted against the committed artefacts rather than fixtures.
 *
 * These are the claims that would be most damaging to get wrong quietly: a
 * place counted in two buckets, a venue classified from its name, a metro
 * matched by a radius rather than its polygon, or the deprecated Overture
 * `categories` property creeping back in.
 */

const ROOT = process.cwd();
const PROCESSED = path.join(ROOT, "data/processed");

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

interface LifestyleStat {
  cbsaGeoid: string;
  metro: string;
  category: string;
  placeCount: number;
  population: number;
  placesPer100k: number;
  sourceRelease: string;
  taxonomyMappingVersion: string;
  extractedOn: string;
}

interface Coverage {
  overtureRelease: string;
  overtureSchemaVersion: string;
  taxonomyMappingVersion: string;
  censusBoundaryVintage: string;
  candidateMetros: number;
  metrosMatchedToPolygon: number;
  metrosWithAnyPlace: number;
  metrosWithLifestyleFit: number;
  supportedCategories: string[];
  classifiedUsPlacesConsidered: number;
  duplicateRowsCollapsed: number;
  placesInsideCandidateMetros: number;
  countsByCategory: Record<string, number>;
  zeroCountRows: { metro: string; category: string }[];
}

interface Mapping {
  version: string;
  overtureRelease: string;
  classifiedOn: string;
  categories: Record<
    string,
    {
      label: string;
      definition: string;
      members: { basicCategory: string; root: string }[];
    }
  >;
}

interface City {
  slug: string;
  metro: string;
  cbsaGeoid: string;
}

const stats = readJson<LifestyleStat[]>(
  path.join(PROCESSED, "lifestyle-stats.json"),
);
const coverage = readJson<Coverage>(
  path.join(PROCESSED, "lifestyle-coverage.json"),
);
const mapping = readJson<Mapping>(
  path.join(ROOT, "scripts/lifestyle/taxonomy-mapping.json"),
);
const cities = readJson<City[]>(path.join(PROCESSED, "cities.json"));

describe("Overture source pinning", () => {
  it("pins one verified release everywhere", () => {
    expect(coverage.overtureRelease).toBe("2026-08-19.0");
    expect(mapping.overtureRelease).toBe(coverage.overtureRelease);
    for (const stat of stats) {
      expect(stat.sourceRelease).toBe(coverage.overtureRelease);
    }
  });

  it("records the schema version and mapping version", () => {
    expect(coverage.overtureSchemaVersion).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(coverage.taxonomyMappingVersion).toBeTruthy();
    for (const stat of stats) {
      expect(stat.taxonomyMappingVersion).toBe(coverage.taxonomyMappingVersion);
    }
  });

  it("classifies on the current taxonomy, not the deprecated categories field", () => {
    expect(mapping.classifiedOn).toBe("basic_category");

    // The extractor must never read `categories`, which Overture is removing.
    const extractor = readFileSync(
      path.join(ROOT, "scripts/lifestyle/extract_places.py"),
      "utf8",
    );
    expect(extractor).toContain("basic_category");
    expect(extractor).toMatch(/taxonomy\.hierarchy|taxonomy/);
    // Allowed in prose explaining the deprecation; never as a column read.
    expect(extractor).not.toMatch(/SELECT[^;]*\bcategories\b/i);
    expect(extractor).not.toMatch(/categories\.primary/);
  });
});

describe("CBSA geography", () => {
  it("joins on the five-digit CBSA code", () => {
    const known = new Set(cities.map((city) => city.cbsaGeoid));

    for (const stat of stats) {
      expect(stat.cbsaGeoid).toMatch(/^\d{5}$/);
      expect(known.has(stat.cbsaGeoid)).toBe(true);
    }
  });

  it("matches every candidate metro to a polygon", () => {
    expect(coverage.candidateMetros).toBe(cities.length);
    expect(coverage.metrosMatchedToPolygon).toBe(cities.length);
    expect(new Set(stats.map((s) => s.cbsaGeoid)).size).toBe(cities.length);
  });

  it("uses an official 2025 Census boundary vintage", () => {
    expect(coverage.censusBoundaryVintage).toBe("2025");
  });

  it("never falls back to a radius, city limit or name match", () => {
    const extractor = readFileSync(
      path.join(ROOT, "scripts/lifestyle/extract_places.py"),
      "utf8",
    );

    // The join is point-in-polygon on the CBSA code, and nothing else.
    expect(extractor).toMatch(/ST_Within|ST_Contains|ST_Intersects/);
    expect(extractor).toMatch(/CBSAFP/);

    // No distance-based or name-similarity fallback exists anywhere. These are
    // function names rather than prose words, so the module docstring — which
    // does say "No radius from a metro centre" — cannot trip them.
    expect(extractor).not.toMatch(/ST_DWithin|ST_Buffer|ST_Distance/i);
    expect(extractor).not.toMatch(/levenshtein|jaro_winkler|jaccard/i);
  });

  it("keeps the metro name as a label, never as the join key", () => {
    // Every row's metro name must agree with the name cities.json holds for
    // that code — proving the code drove the join, not the text.
    const nameByCbsa = new Map(
      cities.map((city) => [city.cbsaGeoid, city.metro]),
    );
    for (const stat of stats) {
      expect(nameByCbsa.get(stat.cbsaGeoid)).toBe(stat.metro);
    }
  });
});

describe("classification mapping", () => {
  it("covers exactly the product categories the app offers", () => {
    expect(Object.keys(mapping.categories).sort()).toEqual(
      [...LIFESTYLE_CATEGORIES].sort(),
    );
    expect(coverage.supportedCategories.sort()).toEqual(
      [...LIFESTYLE_CATEGORIES].sort(),
    );
  });

  it("assigns every Overture category to at most one bucket", () => {
    // Exclusivity is structural: Overture gives a place exactly one
    // basic_category, and each basic_category appears in exactly one bucket,
    // so a place can never be counted twice.
    const seen = new Map<string, string>();

    for (const [bucket, definition] of Object.entries(mapping.categories)) {
      for (const member of definition.members) {
        expect(seen.has(member.basicCategory)).toBe(false);
        seen.set(member.basicCategory, bucket);
      }
    }

    expect(seen.size).toBeGreaterThan(50);
  });

  it("records the Overture hierarchy root each category was observed under", () => {
    for (const definition of Object.values(mapping.categories)) {
      for (const member of definition.members) {
        expect(member.basicCategory).toMatch(/^[a-z0-9_]+$/);
        expect(member.root).toMatch(/^[a-z0-9_]+$/);
      }
    }
  });

  it("gives every bucket a stated definition", () => {
    for (const definition of Object.values(mapping.categories)) {
      expect(definition.definition.length).toBeGreaterThan(20);
      expect(definition.label.length).toBeGreaterThan(0);
    }
  });

  it("does not classify by venue name or substring", () => {
    const extractor = readFileSync(
      path.join(ROOT, "scripts/lifestyle/extract_places.py"),
      "utf8",
    );

    // Classification is an exact membership test against the committed list.
    expect(extractor).not.toMatch(
      /ILIKE|LIKE '%|contains\(names|regexp_matches\(names/i,
    );
  });
});

describe("place filtering", () => {
  it("excludes permanently closed places and places certain not to exist", () => {
    const audit = readJson<{ exclusions: Record<string, string> }>(
      path.join(ROOT, "data/raw/lifestyle-extraction-audit.json"),
    );

    expect(audit.exclusions.operatingStatus).toMatch(/permanently_closed/);
    expect(audit.exclusions.confidence).toMatch(/confidence = 0/);
    expect(audit.exclusions.geometry).toMatch(/NULL/);
    expect(audit.exclusions.unclassified).toMatch(/no bucket/);
  });

  it("counts distinct place ids, so duplicates cannot inflate a metro", () => {
    expect(coverage.duplicateRowsCollapsed).toBe(0);
    expect(coverage.classifiedUsPlacesConsidered).toBeGreaterThan(1_000_000);
  });

  it("keeps unclassified places out of every bucket", () => {
    // Places inside the metros are a strict subset of those classified, and
    // classification happened before the spatial join.
    expect(coverage.placesInsideCandidateMetros).toBeLessThan(
      coverage.classifiedUsPlacesConsidered,
    );
    expect(coverage.placesInsideCandidateMetros).toBeGreaterThan(0);
  });
});

describe("metro lifestyle metrics", () => {
  it("produces one row per metro per supported category", () => {
    expect(stats.length).toBe(cities.length * LIFESTYLE_CATEGORIES.length);

    const seen = new Set(stats.map((s) => `${s.cbsaGeoid}:${s.category}`));
    expect(seen.size).toBe(stats.length);
  });

  it("matches count / population x 100,000 for every row", () => {
    for (const stat of stats) {
      expect(stat.placesPer100k).toBeCloseTo(
        (stat.placeCount / stat.population) * 100_000,
        6,
      );
    }
  });

  it("never divides by a non-positive population", () => {
    for (const stat of stats) {
      expect(stat.population).toBeGreaterThan(0);
      expect(Number.isFinite(stat.placesPer100k)).toBe(true);
    }
  });

  it("keeps counts non-negative integers", () => {
    for (const stat of stats) {
      expect(Number.isInteger(stat.placeCount)).toBe(true);
      expect(stat.placeCount).toBeGreaterThanOrEqual(0);
    }
  });

  it("lists any zero-count row rather than hiding it", () => {
    const measuredZeros = stats.filter((s) => s.placeCount === 0);
    expect(coverage.zeroCountRows.length).toBe(measuredZeros.length);
  });

  it("finds every broad category present in every top-100 metro", () => {
    // A broad lifestyle category reading zero for a top-100 metro would point to a
    // mapping or boundary fault rather than a real absence.
    expect(coverage.zeroCountRows).toEqual([]);
    expect(coverage.metrosWithAnyPlace).toBe(cities.length);
    expect(coverage.metrosWithLifestyleFit).toBe(cities.length);
  });

  it("keeps per-capita rates within a plausible range", () => {
    for (const stat of stats) {
      expect(stat.placesPer100k).toBeGreaterThan(0);
      expect(stat.placesPer100k).toBeLessThan(5_000);
    }
  });
});

describe("no raw place data is committed", () => {
  it("stores only derived per-metro counts", () => {
    for (const stat of stats) {
      expect(Object.keys(stat).sort()).toEqual([
        "category",
        "cbsaGeoid",
        "extractedOn",
        "metro",
        "placeCount",
        "placesPer100k",
        "population",
        "sourceRelease",
        "taxonomyMappingVersion",
      ]);
    }
  });
});
