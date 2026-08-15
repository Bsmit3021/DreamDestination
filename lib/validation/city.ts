import { z } from "zod";

import { US_STATE_CODES } from "@/lib/constants";

/**
 * Validation for curated city reference data.
 *
 * No city data is ingested on Day 1. This schema exists so that whichever
 * ingestion path lands first — a seed script or an admin route — validates
 * against the same rules the database enforces.
 */

/** Lower-case words separated by single hyphens, e.g. `san-francisco-ca`. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const citySlugSchema = z.string().min(1).regex(SLUG_PATTERN, {
  message: "Slug must be lower-case words separated by single hyphens",
});

export const latitudeSchema = z
  .number()
  .min(-90, { message: "Latitude must be at least -90" })
  .max(90, { message: "Latitude must be at most 90" });

export const longitudeSchema = z
  .number()
  .min(-180, { message: "Longitude must be at least -180" })
  .max(180, { message: "Longitude must be at most 180" });

export const cityInputSchema = z.object({
  slug: citySlugSchema,
  city: z.string().trim().min(1).max(120),
  state: z.enum(US_STATE_CODES),
  metro: z.string().trim().min(1).max(160).nullable(),
  population: z.int().min(0).nullable(),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});

export type CityInputSchema = z.infer<typeof cityInputSchema>;
