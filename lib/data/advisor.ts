import "server-only";

import {
  MAX_HISTORY_MESSAGES,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MINUTES,
} from "@/lib/ai/config";
import { DataAccessError, MissingProfileError } from "@/lib/data/errors";
import { getCurrentUserProfile } from "@/lib/data/profiles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Advisor conversation persistence.
 *
 * Every function resolves the owning profile from the authenticated session
 * and scopes queries by it. A `conversationId` from the browser is only ever
 * used as a filter *in addition to* ownership — never as the authority for
 * it — and RLS enforces the same rule independently underneath.
 *
 * Uses the ordinary session-scoped client. No service-role client appears in
 * any advisor path, preserving the Phase 3.5 boundary.
 */

export interface AdvisorMessageRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  evidenceRefs: string[];
  model: string | null;
  promptVersion: string | null;
  createdAt: string;
}

export interface AdvisorConversationRecord {
  id: string;
  title: string;
  updatedAt: string;
}

/** The user's most recent thread, or null. */
export async function getLatestConversation(): Promise<AdvisorConversationRecord | null> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new MissingProfileError();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("advisor_conversations")
    .select("id, title, updated_at")
    .eq("profile_id", profile.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new DataAccessError("Could not load your advisor conversation.", {
      cause: error,
    });
  }

  return data
    ? { id: data.id, title: data.title, updatedAt: data.updated_at }
    : null;
}

/** Creates a thread on the caller's own profile. */
export async function createConversation(
  title = "New conversation",
): Promise<AdvisorConversationRecord> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new MissingProfileError();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("advisor_conversations")
    .insert({ profile_id: profile.id, title })
    .select("id, title, updated_at")
    .single();

  if (error) {
    throw new DataAccessError("Could not start an advisor conversation.", {
      cause: error,
    });
  }

  return { id: data.id, title: data.title, updatedAt: data.updated_at };
}

/**
 * Confirms the caller owns this conversation.
 *
 * Returns null rather than throwing for an unowned or unknown id, so a probe
 * for someone else's conversation is indistinguishable from a typo.
 */
export async function getOwnedConversation(
  conversationId: string,
): Promise<AdvisorConversationRecord | null> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new MissingProfileError();

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("advisor_conversations")
    .select("id, title, updated_at")
    .eq("id", conversationId)
    // Ownership filter applied server-side in addition to RLS.
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (error) {
    throw new DataAccessError("Could not load that conversation.", {
      cause: error,
    });
  }

  return data
    ? { id: data.id, title: data.title, updatedAt: data.updated_at }
    : null;
}

/** Messages for an owned conversation, oldest first. */
export async function getMessages(
  conversationId: string,
  limit = 50,
): Promise<AdvisorMessageRecord[]> {
  const owned = await getOwnedConversation(conversationId);
  if (!owned) return [];

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("advisor_messages")
    .select(
      "id, role, content, evidence_refs, model, prompt_version, created_at",
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new DataAccessError("Could not load advisor messages.", {
      cause: error,
    });
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    role: row.role as "user" | "assistant",
    content: row.content,
    evidenceRefs: Array.isArray(row.evidence_refs)
      ? (row.evidence_refs as unknown[]).filter(
          (ref): ref is string => typeof ref === "string",
        )
      : [],
    model: row.model,
    promptVersion: row.prompt_version,
    createdAt: row.created_at,
  }));
}

/**
 * The bounded window replayed to the provider.
 *
 * Only conversational turns are replayed — facts are rebuilt from the database
 * every request, so a stale wage quoted in an old message can never become
 * authoritative just because it appears earlier in the transcript.
 */
export async function getRecentHistory(
  conversationId: string,
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const all = await getMessages(conversationId, 200);
  return all
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({ role: message.role, content: message.content }));
}

export async function appendMessage(
  conversationId: string,
  message: {
    role: "user" | "assistant";
    content: string;
    evidenceRefs?: string[];
    model?: string | null;
    promptVersion?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    latencyMs?: number | null;
  },
): Promise<void> {
  const owned = await getOwnedConversation(conversationId);
  if (!owned) {
    throw new DataAccessError("That conversation is not available.");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("advisor_messages").insert({
    conversation_id: conversationId,
    role: message.role,
    content: message.content,
    evidence_refs: message.evidenceRefs ?? [],
    model: message.model ?? null,
    prompt_version: message.promptVersion ?? null,
    input_tokens: message.inputTokens ?? null,
    output_tokens: message.outputTokens ?? null,
    latency_ms: message.latencyMs ?? null,
  });

  if (error) {
    throw new DataAccessError("Could not save that message.", { cause: error });
  }

  // Keeps "most recent thread" ordering meaningful.
  await supabase
    .from("advisor_conversations")
    .update({ title: owned.title })
    .eq("id", conversationId);
}

/**
 * Simple per-user request budget.
 *
 * Counts the caller's own recent user turns; RLS means the query cannot see
 * anyone else's. Enough to stop a runaway loop or a bored tab without building
 * billing infrastructure.
 */
export async function isWithinRateLimit(): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
}> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new MissingProfileError();

  const since = new Date(
    Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000,
  ).toISOString();

  const supabase = await createSupabaseServerClient();
  const { data: conversations, error: conversationError } = await supabase
    .from("advisor_conversations")
    .select("id")
    .eq("profile_id", profile.id);

  if (conversationError) {
    throw new DataAccessError("Could not check advisor usage.", {
      cause: conversationError,
    });
  }

  const ids = (conversations ?? []).map((row) => row.id);
  if (ids.length === 0) {
    return { allowed: true, used: 0, limit: RATE_LIMIT_MAX_REQUESTS };
  }

  const { count, error } = await supabase
    .from("advisor_messages")
    .select("id", { count: "exact", head: true })
    .in("conversation_id", ids)
    .eq("role", "user")
    .gte("created_at", since);

  if (error) {
    throw new DataAccessError("Could not check advisor usage.", {
      cause: error,
    });
  }

  const used = count ?? 0;
  return {
    allowed: used < RATE_LIMIT_MAX_REQUESTS,
    used,
    limit: RATE_LIMIT_MAX_REQUESTS,
  };
}
