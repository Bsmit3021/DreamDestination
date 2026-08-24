import "server-only";

import { z } from "zod";

import { PREFERENCE_WEIGHT_KEYS } from "@/lib/constants";
import { DataAccessError } from "@/lib/data/errors";
import { measurementLabel } from "@/lib/matching/explanations";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RankedRecommendation } from "@/lib/matching/types";
import type { PreferenceWeightKey, UsStateCode } from "@/types/profile";

/**
 * Reading and writing stored recommendations.
 *
 * Both directions use the ordinary session-scoped client. Reads are limited by
 * RLS to the caller's own rows.
 *
 * Writes go through `replace_my_recommendations`, a SECURITY DEFINER function
 * that resolves the owner from `auth.uid()` itself. `recommendations` still
 * grants users no direct INSERT — they are derived data, and a user able to
 * write them could fabricate their own results — but the function performs
 * that write on the caller's behalf for their own profile only. No
 * service-role credential is involved in the user request path.
 */

/** The scoring snapshot stored in `recommendations.reason_json`. */
const dimensionSnapshotSchema = z.object({
  normalizedScore: z.number(),
  effectiveWeight: z.number(),
  contribution: z.number(),
  rawValue: z.number(),
  unit: z.string(),
  sourceKey: z.string(),
  /**
   * What `rawValue` is, once a dimension can be scored on more than one
   * measurement. Optional so snapshots written before Phase 6A still parse;
   * the reader falls back to the registry's metric label.
   */
  measureLabel: z.string().optional(),
  /**
   * For career only: `occupation_specific`, `occupation_data_fallback`, or
   * `general_labor_market`. Recorded so the UI can never imply an occupational
   * score when there was not one, and so the two metro-wide cases stay
   * distinguishable — BLS publishing too little about a requested occupation is
   * not the same as the user naming no occupation.
   *
   * Kept as a plain string rather than an enum: snapshots written before
   * `occupation_data_fallback` existed carry `general_labor_market`, whose
   * original meaning ("scored on the metro-wide labour market") is still true,
   * and must keep parsing.
   */
  basis: z.string().optional(),
  /**
   * For career only: the score before the evidence-confidence adjustment, and
   * the factor applied to it. Stored so a saved recommendation can still
   * separate "this labour market looks strong" from "the app can actually
   * speak to this user's occupation here". Optional — snapshots written before
   * the adjustment existed carry neither.
   */
  rawScore: z.number().optional(),
  evidenceConfidence: z.number().optional(),
  /**
   * For career and family only: the share of intended evidence that was
   * available. Optional so snapshots predating either adjustment still parse.
   */
  coverage: z.number().optional(),
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
      measureLabel: measurementLabel(dimension),
      ...(dimension.detail?.kind === "career"
        ? {
            basis: dimension.detail.basis,
            rawScore: dimension.detail.rawScore,
            evidenceConfidence: dimension.detail.evidenceConfidence,
            coverage: dimension.detail.coverage,
          }
        : {}),
      // Family stores the same three facts, so a saved recommendation can
      // still separate "what the available evidence said" from "how much of
      // the intended evidence there was".
      ...(dimension.detail?.kind === "family"
        ? {
            rawScore: dimension.detail.rawScore,
            evidenceConfidence: dimension.detail.evidenceConfidence,
            coverage: dimension.detail.coverage,
          }
        : {}),
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
 * Replaces the signed-in user's stored recommendations atomically.
 *
 * Takes no profile or user id. The database resolves the owner from
 * `auth.uid()` inside `replace_my_recommendations`, so there is no argument
 * here that could name someone else's profile — cross-user writes are
 * unexpressible rather than merely forbidden.
 */
export async function persistRecommendations(
  recommendations: readonly RankedRecommendation[],
  algorithmVersion: string,
): Promise<void> {
  // The ordinary session-scoped client: the caller's JWT is what the function
  // reads to identify them. No elevated credential is involved.
  const supabase = await createSupabaseServerClient();

  const rows = recommendations.map((recommendation) => ({
    city_id: recommendation.city.id,
    dream_score: toStoredScore(recommendation.totalScore),
    rank: recommendation.rank,
    reason_json: buildReasonJson(recommendation),
  }));

  // One call: delete + insert inside a single transaction, so the unique
  // (profile_id, rank) constraint cannot be violated by a concurrent rerun.
  const { error } = await supabase.rpc("replace_my_recommendations", {
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
