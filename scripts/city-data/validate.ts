/**
 * Step 3: the data quality gate.
 *
 * Nothing reaches Supabase without passing this. Malformed input fails loudly
 * here rather than being coerced into something that looks plausible and scores
 * wrongly later.
 *
 *   npm run data:validate
 */

import { readFile } from "node:fs/promises";

import { z } from "zod";

import { PREFERENCE_WEIGHT_KEYS, US_STATE_CODES } from "@/lib/constants";
import { DIMENSIONS } from "@/lib/matching/dimensions";
import { MINIMUM_DATA_COVERAGE } from "@/lib/matching/filters";

import { SOURCES } from "./config";
import { CITIES_FILE, OBSERVATIONS_FILE, log } from "./shared";

const citySchema = z.object({
  slug: z
    .string()
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "slug must match the database constraint",
    ),
  city: z.string().min(1).max(120),
  state: z.enum(US_STATE_CODES),
  metro: z.string().min(1).max(160),
  cbsaGeoid: z.string().regex(/^\d{5}$/),
  population: z.int().positive(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const observationSchema = z.object({
  citySlug: z.string().min(1),
  metricKey: z.string().regex(/^[a-z0-9]+(_[a-z0-9]+)*$/),
  dimension: z.enum(PREFERENCE_WEIGHT_KEYS),
  // Finite and not NaN by construction: z.number() rejects both in Zod 4.
  rawValue: z.number(),
  unit: z.string().min(1),
  sourceKey: z.enum(
    Object.values(SOURCES).map((source) => source.key) as [string, ...string[]],
  ),
});

/** Plausibility bounds per unit. Deliberately generous — this catches blunders
 *  such as a percentage stored as a fraction, not marginal values. */
const UNIT_BOUNDS: Record<string, { min: number; max: number }> = {
  percent: { min: 0, max: 100 },
  usd_per_month: { min: 1, max: 20_000 },
  usd: { min: 0, max: 10_000_000 },
  minutes: { min: 1, max: 180 },
  degrees_fahrenheit: { min: -40, max: 110 },
  per_100k: { min: 0, max: 100_000 },
  count: { min: 0, max: 1_000_000_000 },
  index: { min: -1_000_000, max: 1_000_000 },
};

function fail(problems: string[]): never {
  log(`\n❌ Validation failed with ${problems.length} problem(s):\n`);
  for (const problem of problems.slice(0, 40)) {
    log(`  • ${problem}`);
  }
  if (problems.length > 40) {
    log(`  … and ${problems.length - 40} more`);
  }
  process.exit(1);
}

async function main(): Promise<void> {
  const cities = citySchema
    .array()
    .parse(JSON.parse(await readFile(CITIES_FILE, "utf8")));
  const observations = observationSchema
    .array()
    .parse(JSON.parse(await readFile(OBSERVATIONS_FILE, "utf8")));

  const problems: string[] = [];

  if (cities.length === 0) {
    problems.push("No cities were produced.");
  }

  // --- identity ------------------------------------------------------------

  const slugs = new Set<string>();
  const geoids = new Set<string>();

  for (const city of cities) {
    if (slugs.has(city.slug))
      problems.push(`Duplicate city slug: ${city.slug}`);
    slugs.add(city.slug);

    if (geoids.has(city.cbsaGeoid)) {
      problems.push(`Duplicate CBSA geoid: ${city.cbsaGeoid} (${city.slug})`);
    }
    geoids.add(city.cbsaGeoid);
  }

  // --- observation integrity ----------------------------------------------

  const seen = new Set<string>();

  for (const observation of observations) {
    const identity = `${observation.citySlug}/${observation.metricKey}`;

    if (!slugs.has(observation.citySlug)) {
      problems.push(`Observation references unknown city: ${identity}`);
    }
    if (seen.has(identity)) {
      problems.push(`Duplicate observation: ${identity}`);
    }
    seen.add(identity);

    const definition = DIMENSIONS[observation.dimension];
    if (!definition.metric) {
      problems.push(
        `${identity} targets "${observation.dimension}", which the registry marks unscored`,
      );
    } else {
      if (definition.metric.key !== observation.metricKey) {
        problems.push(
          `${identity} does not match the registry metric "${definition.metric.key}"`,
        );
      }
      if (definition.metric.unit !== observation.unit) {
        problems.push(
          `${identity} unit "${observation.unit}" != registry "${definition.metric.unit}"`,
        );
      }
    }

    const bounds = UNIT_BOUNDS[observation.unit];
    if (!bounds) {
      problems.push(
        `${identity} uses an unrecognised unit "${observation.unit}"`,
      );
    } else if (
      observation.rawValue < bounds.min ||
      observation.rawValue > bounds.max
    ) {
      problems.push(
        `${identity} value ${observation.rawValue} is outside the plausible ` +
          `range for ${observation.unit} (${bounds.min}..${bounds.max})`,
      );
    }
  }

  // --- coverage ------------------------------------------------------------

  const scoredDimensions = PREFERENCE_WEIGHT_KEYS.filter(
    (key) => DIMENSIONS[key].metric !== null,
  );

  const byCity = new Map<string, Set<string>>();
  for (const observation of observations) {
    const set = byCity.get(observation.citySlug) ?? new Set<string>();
    set.add(observation.dimension);
    byCity.set(observation.citySlug, set);
  }

  // Coverage here is measured against the dimensions that *can* be scored.
  // A user-weight-relative check happens at scoring time.
  const underCovered: string[] = [];
  for (const city of cities) {
    const covered = byCity.get(city.slug)?.size ?? 0;
    const share = covered / scoredDimensions.length;
    if (share < MINIMUM_DATA_COVERAGE) {
      underCovered.push(`${city.slug} (${covered}/${scoredDimensions.length})`);
    }
  }

  if (underCovered.length > 0) {
    problems.push(
      `${underCovered.length} cities fall below the ${Math.round(
        MINIMUM_DATA_COVERAGE * 100,
      )}% coverage floor: ${underCovered.slice(0, 8).join(", ")}`,
    );
  }

  if (problems.length > 0) {
    fail(problems);
  }

  log(`✅ ${cities.length} cities, ${observations.length} observations valid.`);
  log(`   scored dimensions: ${scoredDimensions.join(", ")}`);
  for (const dimension of scoredDimensions) {
    const count = observations.filter((o) => o.dimension === dimension).length;
    log(`   ${dimension}: ${count}/${cities.length} cities`);
  }
  log("Next: npm run data:seed");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
