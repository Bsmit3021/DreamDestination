/**
 * Bounded retry for seed writes against hosted Supabase.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * Seeding the career table means ~56 sequential HTTPS round trips carrying a
 * thousand rows each. Over a long run on a residential connection, one of them
 * eventually dies in transport. `supabase-js` surfaces that inconsistently: it
 * may throw `TypeError: fetch failed`, or return `{ error, status: 0 }` — a
 * status that is not an HTTP response at all. The seed checked neither shape
 * properly, so a run that was two-thirds done simply stopped.
 *
 * Both shapes are handled here, and `status: 0` deliberately falls through to
 * message classification rather than being read as a client error. Reading it
 * as one is exactly the mistake that made the first version of this module
 * refuse to retry the very failure it was written for.
 *
 * Production evidence confirmed the shape of it: every batch the server
 * actually received returned 200/201, no 4xx or 5xx preceded the client error,
 * and the rows already written were intact with no duplicates. The write path
 * was correct; the transport was not.
 *
 * ---------------------------------------------------------------------------
 * What is and is not retried
 * ---------------------------------------------------------------------------
 * Only conditions that a later identical request could plausibly survive:
 * transport failures, connection resets, 429 and 5xx. A deterministic 4xx —
 * a constraint violation, a bad column, an RLS refusal — will fail exactly the
 * same way five times, so retrying it turns a clear error into a slow one.
 *
 * Retrying is only safe because every seed write is an upsert on a natural key.
 * A retried batch that in fact succeeded server-side rewrites the same rows to
 * the same values; it cannot duplicate them.
 */

/** A failed Supabase response, carried as a throw so retry can classify it. */
export class SeedRequestError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;

  constructor(
    message: string,
    options: { status?: number; code?: string } = {},
  ) {
    super(message);
    this.name = "SeedRequestError";
    this.status = options.status;
    this.code = options.code;
  }
}

/** Transport-level failures, by the text Node and undici actually produce. */
const TRANSIENT_PATTERNS = [
  /fetch failed/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /EPIPE/i,
  /EAI_AGAIN/i,
  /socket hang up/i,
  /network (?:error|timeout)/i,
  /terminated/i,
  /aborted/i,
];

export interface RetryClassification {
  retryable: boolean;
  /** Short, log-safe reason. Never contains a payload or a credential. */
  reason: string;
}

/**
 * Decides whether an error is worth another attempt.
 *
 * Errors carrying an HTTP status are judged on it; anything else is judged on
 * its message. The default is **not** to retry: an unrecognised failure is more
 * likely to be a real defect than a blip, and failing fast surfaces it.
 */
export function classifySeedError(error: unknown): RetryClassification {
  // A status below 100 is not an HTTP response at all. `supabase-js` reports
  // `status: 0` when the request never completed — the transport died before a
  // response existed — so it must fall through to message classification
  // rather than be read as a deterministic client error.
  const hasHttpStatus =
    error instanceof SeedRequestError &&
    typeof error.status === "number" &&
    error.status >= 100;

  if (error instanceof SeedRequestError && hasHttpStatus) {
    if (error.status === 429) {
      return { retryable: true, reason: "HTTP 429 rate limited" };
    }
    if (error.status >= 500) {
      return { retryable: true, reason: `HTTP ${error.status} server error` };
    }
    return {
      retryable: false,
      reason: `HTTP ${error.status} client error${error.code ? ` (${error.code})` : ""}`,
    };
  }

  const message = error instanceof Error ? error.message : String(error);

  for (const pattern of TRANSIENT_PATTERNS) {
    if (pattern.test(message)) {
      return { retryable: true, reason: "transport failure" };
    }
  }

  return { retryable: false, reason: "non-transient error" };
}

export interface RetryOptions {
  /** Identifies the unit of work in logs, e.g. "batch 18 (rows 17000-17999)". */
  label: string;
  /** Total attempts including the first. */
  attempts?: number;
  /** First backoff in ms; each retry roughly doubles it. */
  baseDelayMs?: number;
  /** Upper bound on any single backoff. */
  maxDelayMs?: number;
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so tests get deterministic jitter. */
  random?: () => number;
  onLog?: (message: string) => void;
}

const DEFAULT_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8_000;

/**
 * Exponential backoff with full jitter.
 *
 * Jittered rather than fixed because several batches failing at once would
 * otherwise retry in lockstep and recreate the burst that caused the problem.
 */
export function backoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  return Math.round(random() * ceiling);
}

/**
 * Runs `operation`, retrying it while the failure looks transient.
 *
 * Rethrows the last error once attempts are exhausted or the failure is
 * deterministic, so a caller still fails loudly — the point is to survive a
 * dropped connection, not to paper over a broken write.
 */
export async function withSeedRetry<T>(
  options: RetryOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const {
    label,
    attempts = DEFAULT_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
    onLog = () => {},
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await operation();
      if (attempt > 1) {
        onLog(`  ${label}: attempt ${attempt}/${attempts} succeeded`);
      }
      return result;
    } catch (error) {
      lastError = error;
      const { retryable, reason } = classifySeedError(error);

      if (!retryable) {
        onLog(
          `  ${label}: attempt ${attempt}/${attempts} failed — ${reason}, not retrying`,
        );
        throw error;
      }

      if (attempt === attempts) {
        onLog(
          `  ${label}: attempt ${attempt}/${attempts} failed — ${reason}, retries exhausted`,
        );
        break;
      }

      const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs, random);
      onLog(
        `  ${label}: attempt ${attempt}/${attempts} failed — ${reason}, retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
