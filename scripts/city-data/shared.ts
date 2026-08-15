import path from "node:path";

/** Shared paths and helpers for the city data pipeline scripts. */

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
export const RAW_DIR = path.join(PROJECT_ROOT, "data/raw");
export const PROCESSED_DIR = path.join(PROJECT_ROOT, "data/processed");

export const CITIES_FILE = path.join(PROCESSED_DIR, "cities.json");
export const OBSERVATIONS_FILE = path.join(PROCESSED_DIR, "observations.json");

export function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

/**
 * Splits one CSV line, honouring quoted fields.
 *
 * Required, not decorative: NOAA station names embed a comma
 * ("NEW YORK JFK INTL AP, NY US"), so a naive split shifts every later column
 * and silently reads the wrong value.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      // A doubled quote inside a quoted field is a literal quote.
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  fields.push(current.trim());
  return fields;
}

/** Great-circle distance in miles, for matching metros to weather stations. */
export function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const EARTH_RADIUS_MILES = 3958.8;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Turns a metro title into a URL-safe slug matching the `cities_slug_format`
 * constraint: lower-case alphanumeric words joined by single hyphens.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
