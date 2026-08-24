import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The geography and integrity guarantees of the Phase 6B pipelines, asserted
 * against the committed coverage artefacts rather than against fixtures.
 *
 * These are the claims that would be most damaging to get wrong quietly: a
 * silently fuzzy-matched metro, a principal city standing in for its MSA, a
 * duplicated school inflating a count, or a coverage number that reads better
 * than the data behind it.
 */

const PROCESSED = path.join(process.cwd(), "data/processed");

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(PROCESSED, name), "utf8")) as T;
}

interface SafetyStat {
  cbsaGeoid: string;
  fbiMetroName: string;
  dataYear: number;
  violentCrimeRate: number | null;
  propertyCrimeRate: number | null;
  sourcePopulation: number | null;
  reportingCoverage: number | null;
  isEstimated: boolean;
}

interface SafetyCoverage {
  dataYear: number;
  candidateMetros: number;
  fbiMsaBlocks: number;
  metropolitanDivisionsSkipped: number;
  matched: number;
  unmatched: number;
  withBothRates: number;
  unmatchedMetros: { slug: string; metro: string; cbsaGeoid: string }[];
}

interface SchoolStat {
  cbsaGeoid: string;
  schoolYear: string;
  publicSchoolCount: number;
  schoolAgePopulation: number | null;
  populationPeriod: string;
  schoolsPer10kSchoolAge: number | null;
}

interface FamilyCoverage {
  schoolYear: string;
  populationPeriod: string;
  candidateMetros: number;
  ncesUniqueSchools: number;
  ncesDuplicateRowsSkipped: number;
  withSchoolAccessRate: number;
}

interface City {
  slug: string;
  metro: string;
  cbsaGeoid: string;
}

const cities = readJson<City[]>("cities.json");
const safety = readJson<SafetyStat[]>("safety-stats.json");
const safetyCoverage = readJson<SafetyCoverage>("safety-coverage.json");
const schools = readJson<SchoolStat[]>("school-stats.json");
const familyCoverage = readJson<FamilyCoverage>("family-coverage.json");

describe("FBI metro mapping", () => {
  it("maps every matched metro to a real candidate CBSA", () => {
    const known = new Set(cities.map((city) => city.cbsaGeoid));

    for (const stat of safety) {
      expect(known.has(stat.cbsaGeoid)).toBe(true);
    }
  });

  it("creates no duplicate observations from one MSA", () => {
    const seen = new Set(safety.map((stat) => stat.cbsaGeoid));

    expect(seen.size).toBe(safety.length);
  });

  it("uses only metropolitan statistical areas, never divisions", () => {
    // A Metropolitan Division is a subdivision of an MSA; counting one as a
    // metro would double count part of a larger area.
    for (const stat of safety) {
      expect(stat.fbiMetroName).toMatch(/M\.\s?S\.\s?A\.\d*$/);
      expect(stat.fbiMetroName).not.toMatch(/M\.\s?D\.\d*$/);
    }
    expect(safetyCoverage.metropolitanDivisionsSkipped).toBeGreaterThan(0);
  });

  it("never substitutes a principal city for its metro", () => {
    // Table 6 prints "City of X" rows; none may survive into the dataset.
    for (const stat of safety) {
      expect(stat.fbiMetroName).not.toMatch(/^City of /);
    }
  });

  it("reports unmatched metros rather than guessing at them", () => {
    expect(safetyCoverage.unmatched).toBe(
      safetyCoverage.unmatchedMetros.length,
    );
    expect(safetyCoverage.matched + safetyCoverage.unmatched).toBe(
      safetyCoverage.candidateMetros,
    );
    // Every unmatched metro is named, not merely counted.
    for (const item of safetyCoverage.unmatchedMetros) {
      expect(item.metro.length).toBeGreaterThan(0);
      expect(item.cbsaGeoid).toMatch(/^\d{5}$/);
    }
  });

  it("leaves an unmatched metro with no safety row at all", () => {
    const matched = new Set(safety.map((stat) => stat.cbsaGeoid));

    for (const item of safetyCoverage.unmatchedMetros) {
      // Absence, not a zero rate and not a national average.
      expect(matched.has(item.cbsaGeoid)).toBe(false);
    }
  });

  it("does not overstate coverage", () => {
    expect(safetyCoverage.matched).toBe(safety.length);
    expect(safetyCoverage.matched).toBeLessThanOrEqual(
      safetyCoverage.candidateMetros,
    );
    expect(safetyCoverage.withBothRates).toBeLessThanOrEqual(
      safetyCoverage.matched,
    );
  });

  it("carries the finalised 2025 data year throughout", () => {
    expect(safetyCoverage.dataYear).toBe(2025);
    for (const stat of safety) expect(stat.dataYear).toBe(2025);
  });

  it("keeps published rates plausible and non-negative", () => {
    for (const stat of safety) {
      for (const rate of [stat.violentCrimeRate, stat.propertyCrimeRate]) {
        if (rate === null) continue;
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThan(25_000);
      }
    }
  });

  it("records the FBI's own reported/estimated distinction", () => {
    // Both kinds occur in the real release; flattening them would lose the
    // source's own caveat about agencies that did not report a full year.
    expect(safety.some((stat) => stat.isEstimated)).toBe(true);
    expect(safety.some((stat) => !stat.isEstimated)).toBe(true);
  });
});

describe("NCES school join", () => {
  it("joins on CBSA identifiers, not city names", () => {
    const known = new Set(cities.map((city) => city.cbsaGeoid));

    for (const stat of schools) {
      expect(stat.cbsaGeoid).toMatch(/^\d{5}$/);
      expect(known.has(stat.cbsaGeoid)).toBe(true);
    }
  });

  it("produces exactly one row per candidate metro", () => {
    const seen = new Set(schools.map((stat) => stat.cbsaGeoid));

    expect(seen.size).toBe(schools.length);
    expect(schools.length).toBe(cities.length);
  });

  it("counts distinct schools, so duplicate ids cannot inflate a metro", () => {
    // The pipeline de-duplicates on NCESSCH before counting. On the real file
    // there are no duplicates, which is itself the assertion worth keeping:
    // a future release that introduced some would change this number.
    expect(familyCoverage.ncesDuplicateRowsSkipped).toBe(0);
    expect(familyCoverage.ncesUniqueSchools).toBeGreaterThan(50_000);
  });

  it("uses only the intended school-year collection", () => {
    expect(familyCoverage.schoolYear).toBe("2024-2025");
    for (const stat of schools) {
      expect(stat.schoolYear).toBe("2024-2025");
    }
  });

  it("keeps school counts non-negative integers", () => {
    for (const stat of schools) {
      expect(Number.isInteger(stat.publicSchoolCount)).toBe(true);
      expect(stat.publicSchoolCount).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("school access rate", () => {
  it("never produces Infinity or NaN", () => {
    for (const stat of schools) {
      if (stat.schoolsPer10kSchoolAge === null) continue;
      expect(Number.isFinite(stat.schoolsPer10kSchoolAge)).toBe(true);
    }
  });

  it("only exists where a positive denominator exists", () => {
    for (const stat of schools) {
      if (stat.schoolsPer10kSchoolAge === null) continue;
      expect(stat.schoolAgePopulation).not.toBeNull();
      expect(stat.schoolAgePopulation!).toBeGreaterThan(0);
    }
  });

  it("matches count / population x 10,000 for every metro", () => {
    for (const stat of schools) {
      if (stat.schoolsPer10kSchoolAge === null) continue;
      const expected =
        (stat.publicSchoolCount / stat.schoolAgePopulation!) * 10_000;
      expect(stat.schoolsPer10kSchoolAge).toBeCloseTo(expected, 9);
    }
  });

  it("uses the ACS school-age denominator, not total population", () => {
    // 5-17 year olds are a minority of any metro. If the total population had
    // been used by mistake, every rate would collapse toward zero.
    const rates = schools
      .map((stat) => stat.schoolsPer10kSchoolAge)
      .filter((rate): rate is number => rate !== null);

    expect(rates.length).toBe(familyCoverage.withSchoolAccessRate);
    // Real U.S. metros land in single-to-low-double digits per 10k aged 5-17.
    for (const rate of rates) {
      expect(rate).toBeGreaterThan(1);
      expect(rate).toBeLessThan(200);
    }
  });

  it("records the ACS vintage the denominator came from", () => {
    expect(familyCoverage.populationPeriod).toBe("2019-2023");
    for (const stat of schools) {
      expect(stat.populationPeriod).toBe("2019-2023");
    }
  });
});
