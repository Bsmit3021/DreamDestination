import { z } from "zod";

/**
 * Typed, validated environment access.
 *
 * Two separate schemas keep the server/client boundary explicit:
 *
 * - `clientEnvSchema` covers `NEXT_PUBLIC_*` values only. These are inlined
 *   into the browser bundle by Next.js and are therefore public by design.
 * - `serverEnvSchema` covers secrets. `getServerEnv()` refuses to run in the
 *   browser, and because the variables carry no `NEXT_PUBLIC_` prefix Next.js
 *   never inlines them into client bundles in the first place.
 *
 * Validation is lazy — it runs when an accessor is called, not at import time.
 * That keeps `next build` working on a machine without credentials (nothing at
 * build time reads Supabase) while still failing loudly the moment a request
 * actually needs a missing variable.
 */

export const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({
    message: "must be a valid URL, e.g. https://<project-ref>.supabase.co",
  }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, { message: "must not be empty" }),
});

export const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, { message: "must not be empty" }),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Raised when environment validation fails, with per-variable detail. */
export class EnvValidationError extends Error {
  constructor(scope: "client" | "server", issues: readonly z.core.$ZodIssue[]) {
    const details = issues
      .map(
        (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      )
      .join("\n");

    super(
      `Invalid ${scope} environment configuration:\n${details}\n\n` +
        `Copy .env.example to .env.local and fill in the missing values.`,
    );
    this.name = "EnvValidationError";
  }
}

function parseEnv<T extends z.ZodType>(
  schema: T,
  scope: "client" | "server",
  source: unknown,
): z.infer<T> {
  const result = schema.safeParse(source);

  if (!result.success) {
    throw new EnvValidationError(scope, result.error.issues);
  }

  return result.data;
}

/**
 * Public configuration. Safe to call from Client Components.
 *
 * The `process.env.X` reads below are written as static property accesses on
 * purpose: that is the only form Next.js can statically replace at build time.
 */
export function getClientEnv(): ClientEnv {
  return parseEnv(clientEnvSchema, "client", {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/**
 * Secret configuration. Throws if reached from the browser.
 *
 * @throws {EnvValidationError} when a required secret is missing or malformed.
 */
export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error(
      "getServerEnv() was called in the browser. Server secrets are not " +
        "available to client code — use getClientEnv() instead.",
    );
  }

  return parseEnv(serverEnvSchema, "server", {
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}
