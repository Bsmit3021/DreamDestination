import { describe, expect, it } from "vitest";

import {
  SeedRequestError,
  backoffDelay,
  classifySeedError,
  withSeedRetry,
} from "@/scripts/shared/retry";

/**
 * Bounded retry for seed writes.
 *
 * The behaviour that matters: a dropped connection must not abandon a
 * two-thirds-finished seed, and a deterministic rejection must not be retried
 * five times before reporting the same thing it said the first time.
 */

/** Never actually waits, so the suite stays fast and deterministic. */
const noSleep = async () => {};
/** Full jitter with random() = 1 gives the ceiling, making delays predictable. */
const maxJitter = () => 1;

function options(overrides: Record<string, unknown> = {}) {
  return {
    label: "batch 18/56 (rows 17000-17999)",
    sleep: noSleep,
    random: maxJitter,
    ...overrides,
  };
}

describe("classifying seed failures", () => {
  it("treats a thrown fetch failure as transient", () => {
    // Exactly what supabase-js surfaced in production.
    const result = classifySeedError(new TypeError("fetch failed"));

    expect(result.retryable).toBe(true);
    expect(result.reason).toBe("transport failure");
  });

  it.each([
    "read ECONNRESET",
    "connect ECONNREFUSED 1.2.3.4:443",
    "connect ETIMEDOUT",
    "write EPIPE",
    "getaddrinfo EAI_AGAIN db.example.supabase.co",
    "socket hang up",
    "terminated",
  ])("treats %s as transient", (message) => {
    expect(classifySeedError(new Error(message)).retryable).toBe(true);
  });

  it("retries HTTP 429", () => {
    const result = classifySeedError(
      new SeedRequestError("too many requests", { status: 429 }),
    );

    expect(result.retryable).toBe(true);
    expect(result.reason).toContain("429");
  });

  it.each([500, 502, 503, 504])("retries HTTP %i", (status) => {
    const result = classifySeedError(
      new SeedRequestError("server", { status }),
    );

    expect(result.retryable).toBe(true);
    expect(result.reason).toContain(String(status));
  });

  it.each([400, 401, 403, 404, 409, 422])(
    "does not retry deterministic HTTP %i",
    (status) => {
      const result = classifySeedError(
        new SeedRequestError("bad request", { status }),
      );

      expect(result.retryable).toBe(false);
      expect(result.reason).toContain(String(status));
    },
  );

  it("does not retry a constraint violation", () => {
    // 23505 would fail identically every time; retrying only delays the report.
    const result = classifySeedError(
      new SeedRequestError("duplicate key value", {
        status: 409,
        code: "23505",
      }),
    );

    expect(result.retryable).toBe(false);
    expect(result.reason).toContain("23505");
  });

  it("retries a supabase-js transport failure reported as status 0", () => {
    // The defect this module was written for, and which its first version
    // still got wrong: supabase-js does not always throw. It can return
    // `{ error, status: 0 }`, and 0 is not an HTTP status at all. Reading it as
    // a client error made the retry refuse the one failure it existed to
    // survive — observed in production as "HTTP 0 client error, not retrying".
    const result = classifySeedError(
      new SeedRequestError("metro_occupation_stats: TypeError: fetch failed", {
        status: 0,
      }),
    );

    expect(result.retryable).toBe(true);
    expect(result.reason).toBe("transport failure");
  });

  it("does not read any sub-100 status as an HTTP client error", () => {
    for (const status of [0, 1, 99]) {
      const result = classifySeedError(
        new SeedRequestError("fetch failed", { status }),
      );
      expect(result.reason).not.toContain("client error");
    }
  });

  it("defaults to not retrying an unrecognised error", () => {
    expect(
      classifySeedError(new Error("column does not exist")).retryable,
    ).toBe(false);
    expect(classifySeedError("something odd").retryable).toBe(false);
  });
});

describe("retry behaviour", () => {
  it("recovers when a transient failure is followed by success", async () => {
    let calls = 0;
    const logs: string[] = [];

    const result = await withSeedRetry(
      options({ onLog: (m: string) => logs.push(m) }),
      async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("fetch failed");
        return "written";
      },
    );

    expect(result).toBe("written");
    expect(calls).toBe(2);
    expect(logs.join("\n")).toContain("attempt 1/5 failed — transport failure");
    expect(logs.join("\n")).toContain("attempt 2/5 succeeded");
  });

  it("succeeds first time without logging noise", async () => {
    const logs: string[] = [];

    await withSeedRetry(
      options({ onLog: (m: string) => logs.push(m) }),
      async () => Promise.resolve("ok"),
    );

    expect(logs).toEqual([]);
  });

  it("gives up after the attempt limit and rethrows the last error", async () => {
    let calls = 0;
    const logs: string[] = [];

    await expect(
      withSeedRetry(
        options({ attempts: 5, onLog: (m: string) => logs.push(m) }),
        async () => {
          calls += 1;
          throw new TypeError("fetch failed");
        },
      ),
    ).rejects.toThrow("fetch failed");

    expect(calls).toBe(5);
    expect(logs.join("\n")).toContain("attempt 5/5 failed");
    expect(logs.join("\n")).toContain("retries exhausted");
  });

  it("stops immediately on a deterministic 4xx", async () => {
    let calls = 0;

    await expect(
      withSeedRetry(options(), async () => {
        calls += 1;
        throw new SeedRequestError("invalid column", { status: 400 });
      }),
    ).rejects.toThrow("invalid column");

    // One attempt, not five: the answer would not change.
    expect(calls).toBe(1);
  });

  it("retries a 429 and then succeeds", async () => {
    let calls = 0;

    const result = await withSeedRetry(options(), async () => {
      calls += 1;
      if (calls < 3) throw new SeedRequestError("slow down", { status: 429 });
      return "written";
    });

    expect(result).toBe("written");
    expect(calls).toBe(3);
  });

  it("retries a 503 and then succeeds", async () => {
    let calls = 0;

    await withSeedRetry(options(), async () => {
      calls += 1;
      if (calls === 1)
        throw new SeedRequestError("unavailable", { status: 503 });
      return "written";
    });

    expect(calls).toBe(2);
  });

  it("identifies the batch in every log line", async () => {
    const logs: string[] = [];

    await withSeedRetry(
      options({
        label: "batch 18/56 (rows 17000-17999)",
        onLog: (m: string) => logs.push(m),
      }),
      async () => {
        if (logs.length === 0) throw new TypeError("fetch failed");
        return "ok";
      },
    );

    for (const line of logs) {
      expect(line).toContain("batch 18/56 (rows 17000-17999)");
      expect(line).toMatch(/attempt \d+\/\d+/);
    }
  });

  it("never logs credentials or row payloads", async () => {
    const logs: string[] = [];
    const secret = "sk-live-should-never-appear";

    await expect(
      withSeedRetry(
        options({ attempts: 2, onLog: (m: string) => logs.push(m) }),
        async () => {
          // A realistic failure: the message carries no secret, and the retry
          // layer must not add one by echoing the request.
          throw new TypeError("fetch failed");
        },
      ),
    ).rejects.toThrow();

    const output = logs.join("\n");
    expect(output).not.toContain(secret);
    expect(output).not.toContain("apikey");
    expect(output).not.toContain("Authorization");
    expect(output).not.toContain("service_role");
    expect(output).not.toMatch(/city_id|soc_code|median_annual_wage/);
  });
});

describe("backoff", () => {
  it("grows exponentially and is capped", () => {
    const delays = [1, 2, 3, 4, 5].map((attempt) =>
      backoffDelay(attempt, 500, 8_000, maxJitter),
    );

    expect(delays).toEqual([500, 1_000, 2_000, 4_000, 8_000]);
  });

  it("never exceeds the maximum", () => {
    expect(backoffDelay(20, 500, 8_000, maxJitter)).toBe(8_000);
  });

  it("applies jitter rather than a fixed schedule", () => {
    // Full jitter: the delay is somewhere in [0, ceiling], so simultaneous
    // failures do not retry in lockstep.
    expect(backoffDelay(3, 500, 8_000, () => 0)).toBe(0);
    expect(backoffDelay(3, 500, 8_000, () => 0.5)).toBe(1_000);
    expect(backoffDelay(3, 500, 8_000, () => 1)).toBe(2_000);
  });
});

describe("idempotent rerun", () => {
  it("is safe to replay a batch that already landed", async () => {
    // The reason retry is safe at all: the write is an upsert on
    // (city_id, soc_code, period), so replaying it rewrites the same rows to
    // the same values rather than inserting duplicates.
    const table = new Map<string, { wage: number }>();
    const rows = [
      { city_id: "c1", soc_code: "15-1252", period: "May 2025", wage: 120_000 },
      { city_id: "c1", soc_code: "29-1141", period: "May 2025", wage: 90_000 },
    ];

    const upsertBatch = () => {
      for (const row of rows) {
        table.set(`${row.city_id}|${row.soc_code}|${row.period}`, {
          wage: row.wage,
        });
      }
    };

    let calls = 0;
    await withSeedRetry(options(), async () => {
      calls += 1;
      upsertBatch();
      // The write landed, then the connection died before the response.
      if (calls === 1) throw new TypeError("fetch failed");
    });

    expect(calls).toBe(2);
    // Applied twice, still two distinct natural keys.
    expect(table.size).toBe(2);
    expect(table.get("c1|15-1252|May 2025")).toEqual({ wage: 120_000 });
  });
});
