import "server-only";

import { z } from "zod";

import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import { DataAccessError } from "@/lib/data/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RankedRecommendation } from "@/lib/matching/types";
import type { PreferenceWeightKey, UsStateCode } from "@/types/profile";

/**
 * Reading and writing stored recommendations.
 *
 * Reads go through the ordinary server client, so RLS scopes them to the
 * signed-in user's own rows.
 *
 * Writes go through the service-role client, on purpose. `recommendations`
 * deliberately grants users no INSERT policy: they are derived data, and a user
 * who could write them could fabricate their own results. Ownership is still
 * resolved from `auth.uid()` before anything is written — the elevated client
 * is only used to write rows the user is not permitted to author, never to
 * reach another user's data.
 */

/** The scoring snapshot stored in `recommendations.reason_json`. */
const dimensionSnapshotSchema = z.object({
  normalizedScore: z.number(),
  effectiveWeight: z.number(),
  contribution: z.number(),
  rawValue: z.number(),
  unit: z.string(),
  sourceKey: z.string(),
});

const reasonSchema = z.object({
  dimension: z.enum(PREFERENCE_WEIGHT_KEYS),
  label: z.string(),
  detail: z.string(),
});

const reasonJsonSchema = z.object({
  dataCoverage: z.number(),
  dimensionsCovered: z.number(),
  dimensionsWeighted: z.number(),
  reasons: reasonSchema.array(),
  tradeoffs: reasonSchema.array(),
  dimensions: z.record(z.string(), dimensionSnapshotSchema),
});

export type ReasonJson = z.infer<typeof reasonJsonSchema>;

/** A stored recommendation, joined with its city, ready to render. */
export interface StoredRecommendation {
  id: string;
  rank: number;
  /** 0-100, restored from the 0-1 value the column stores. */
  score: number;
  algorithmVersion: string;
  createdAt: string;
  city: {
    id: string;
    slug: string;
    city: string;
    state: UsStateCode;
    metro: string | null;
    population: number | null;
  };
  reason: ReasonJson;
}

/**
 * `dream_score` is numeric(5,4) constrained to 0-1, so the 0-100 score is
 * stored as a fraction and expanded on read. The column predates Phase 3 and
 * changing its meaning would invalidate the existing CHECK constraint.
 */
function toStoredScore(totalScore: number): number {
  return Math.min(1, Math.max(0, totalScore / 100));
}

function buildReasonJson(recommendation: RankedRecommendation): ReasonJson {
  const dimensions: ReasonJson["dimensions"] = {};

  for (const key of PREFERENCE_WEIGHT_KEYS) {
    const dimension = recommendation.dimensions[key];
    if (!dimension.available || dimension.normalizedScore === null) continue;

    dimensions[key] = {
      normalizedScore: dimension.normalizedScore,
      effectiveWeight: dimension.effectiveWeight,
      contribution: dimension.contribution,
      rawValue: dimension.rawValue ?? 0,
      unit: dimension.unit ?? "",
      sourceKey: dimension.source?.key ?? "",
    };
  }

  return {
    dataCoverage: recommendation.dataCoverage,
    dimensionsCovered: recommendation.dimensionsCovered,
    dimensionsWeighted: recommendation.dimensionsWeighted,
    reasons: recommendation.reasons,
    tradeoffs: recommendation.tradeoffs,
    dimensions,
  };
}

/**
 * Replaces a profile's stored recommendations atomically.
 *
 * @param profileId must already have been resolved from the authenticated
 *   session by the caller; this function never derives ownership itself.
 */
export async function persistRecommendations(
  profileId: string,
  recommendations: readonly RankedRecommendation[],
  algorithmVersion: string,
): Promise<void> {
  const admin = createSupabaseAdminClient();

  const rows = recommendations.map((recommendation) => ({
    city_id: recommendation.city.id,
    dream_score: toStoredScore(recommendation.totalScore),
    rank: recommendation.rank,
    reason_json: buildReasonJson(recommendation),
  }));

  // One statement: delete + insert inside a single transaction, so the unique
  // (profile_id, rank) constraint cannot be violated by a concurrent rerun.
  const { error } = await admin.rpc("replace_recommendations", {
    p_profile_id: profileId,
    p_algorithm_version: algorithmVersion,
    p_rows: rows,
  });

  if (error) {
    throw new DataAccessError("Could not save your recommendations.", {
      cause: error,
    });
  }
}

/**
 * The signed-in user's stored recommendations, newest ranking first.
 *
 * Returns an empty array when none have been generated. RLS guarantees only
 * the caller's own rows come back.
 */
export async function getStoredRecommendations(): Promise<
  StoredRecommendation[]
> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("recommendations")
    .select(
      `id, rank, dream_score, algorithm_version, created_at, reason_json,
       cities ( id, slug, city, state, metro, population )`,
    )
    .order("rank", { ascending: true });

  if (error) {
    throw new DataAccessError("Could not load your recommendations.", {
      cause: error,
    });
  }

  const rows = data as unknown as {
    id: string;
    rank: number;
    dream_score: number;
    algorithm_version: string;
    created_at: string;
    reason_json: unknown;
    cities: {
      id: string;
      slug: string;
      city: string;
      state: string;
      metro: string | null;
      population: number | null;
    } | null;
  }[];

  const results: StoredRecommendation[] = [];

  for (const row of rows) {
    if (!row.cities) continue;

    // Parsed rather than cast: reason_json is jsonb and could predate a change
    // to the snapshot shape. A row we cannot read is skipped, not guessed at.
    const parsed = reasonJsonSchema.safeParse(row.reason_json);
    if (!parsed.success) continue;

    results.push({
      id: row.id,
      rank: row.rank,
      score: row.dream_score * 100,
      algorithmVersion: row.algorithm_version,
      createdAt: row.created_at,
      city: {
        id: row.cities.id,
        slug: row.cities.slug,
        city: row.cities.city,
        state: row.cities.state as UsStateCode,
        metro: row.cities.metro,
        population: row.cities.population,
      },
      reason: parsed.data,
    });
  }

  return results;
}

/** Dimension keys present in a stored snapshot, in registry order. */
export function snapshotDimensions(reason: ReasonJson): PreferenceWeightKey[] {
  return PREFERENCE_WEIGHT_KEYS.filter((key) => key in reason.dimensions);
}
