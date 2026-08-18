import "server-only";

import { DataAccessError } from "@/lib/data/errors";
import { getCurrentUserProfile } from "@/lib/data/profiles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OccupationTitleEntry } from "@/lib/occupations/resolver";

/**
 * The signed-in user's structured career target.
 *
 * Ownership always resolves through their own profile, which itself comes from
 * `auth.uid()`. No function here takes a profile or user id, so a request
 * cannot name someone else's target. RLS enforces the same rule independently.
 *
 * `profiles.occupation` — the user's original free text — is never overwritten.
 * This table sits alongside it.
 */

export interface CareerTarget {
  socCode: string;
  title: string;
  sourceText: string;
  matchMethod: string;
  matchConfidence: number;
  confirmedByUser: boolean;
}

export async function getCurrentUserCareerTarget(): Promise<CareerTarget | null> {
  const profile = await getCurrentUserProfile();
  if (!profile) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profile_career_targets")
    .select(
      "soc_code, source_text, match_method, match_confidence, confirmed_by_user, occupations ( title )",
    )
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (error) {
    throw new DataAccessError("Could not load your career target.", {
      cause: error,
    });
  }
  if (!data) return null;

  const row = data as unknown as {
    soc_code: string;
    source_text: string;
    match_method: string;
    match_confidence: number;
    confirmed_by_user: boolean;
    occupations: { title: string } | null;
  };

  return {
    socCode: row.soc_code,
    title: row.occupations?.title ?? row.soc_code,
    sourceText: row.source_text,
    matchMethod: row.match_method,
    matchConfidence: row.match_confidence,
    confirmedByUser: row.confirmed_by_user,
  };
}

/**
 * Saves the user's confirmed occupation.
 *
 * The profile is resolved from the session here, not supplied by the caller.
 */
export async function saveCareerTarget(input: {
  socCode: string;
  sourceText: string;
  matchMethod: string;
  matchConfidence: number;
  confirmedByUser: boolean;
}): Promise<void> {
  const profile = await getCurrentUserProfile();
  if (!profile) {
    throw new DataAccessError(
      "Complete your profile before setting an occupation.",
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("profile_career_targets").upsert(
    {
      profile_id: profile.id,
      soc_code: input.socCode,
      source_text: input.sourceText,
      match_method: input.matchMethod,
      match_confidence: input.matchConfidence,
      confirmed_by_user: input.confirmedByUser,
    },
    { onConflict: "profile_id" },
  );

  if (error) {
    throw new DataAccessError("Could not save your occupation.", {
      cause: error,
    });
  }
}

/** The searchable title index used by the deterministic resolver. */
export async function loadOccupationTitleIndex(): Promise<
  OccupationTitleEntry[]
> {
  const supabase = await createSupabaseServerClient();
  const index: OccupationTitleEntry[] = [];
  const PAGE = 1000;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("occupation_titles")
      .select(
        "soc_code, title, normalized_title, title_kind, occupations ( title )",
      )
      .range(from, from + PAGE - 1);

    if (error) {
      throw new DataAccessError("Could not load the occupation index.", {
        cause: error,
      });
    }
    if (!data || data.length === 0) break;

    for (const row of data as unknown as {
      soc_code: string;
      title: string;
      normalized_title: string;
      title_kind: string;
      occupations: { title: string } | null;
    }[]) {
      index.push({
        socCode: row.soc_code,
        socTitle: row.occupations?.title ?? row.title,
        title: row.title,
        normalizedTitle: row.normalized_title,
        kind: row.title_kind as OccupationTitleEntry["kind"],
      });
    }

    if (data.length < PAGE) break;
  }

  return index;
}
