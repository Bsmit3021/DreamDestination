import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EnvValidationError,
  clientEnvSchema,
  getClientEnv,
  getServerEnv,
  serverEnvSchema,
} from "@/lib/env";

const VALID_CLIENT_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key-placeholder",
};

afterEach(() => {
  vi.unstubAllEnvs();
  Reflect.deleteProperty(globalThis, "window");
});

describe("clientEnvSchema", () => {
  it("accepts a well-formed public configuration", () => {
    const result = clientEnvSchema.safeParse(VALID_CLIENT_ENV);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(VALID_CLIENT_ENV);
  });

  it("rejects a missing Supabase URL", () => {
    const result = clientEnvSchema.safeParse({
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key-placeholder",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
  });

  it("rejects a Supabase URL that is not a URL", () => {
    const result = clientEnvSchema.safeParse({
      ...VALID_CLIENT_ENV,
      NEXT_PUBLIC_SUPABASE_URL: "abcdefghijklmnop.supabase.co",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path.join(".")).toBe(
      "NEXT_PUBLIC_SUPABASE_URL",
    );
  });

  it("rejects an empty anon key", () => {
    const result = clientEnvSchema.safeParse({
      ...VALID_CLIENT_ENV,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]);
  });
});

describe("serverEnvSchema", () => {
  it("accepts a present service-role key", () => {
    const result = serverEnvSchema.safeParse({
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-placeholder",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a missing service-role key", () => {
    const result = serverEnvSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
  });

  it("does not accept the public keys as a substitute", () => {
    const result = serverEnvSchema.safeParse(VALID_CLIENT_ENV);

    expect(result.success).toBe(false);
  });
});

describe("getClientEnv", () => {
  it("reads the public variables from the environment", () => {
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      VALID_CLIENT_ENV.NEXT_PUBLIC_SUPABASE_URL,
    );
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      VALID_CLIENT_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );

    expect(getClientEnv()).toEqual(VALID_CLIENT_ENV);
  });

  it("throws a descriptive error naming the missing variable", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    expect(() => getClientEnv()).toThrow(EnvValidationError);
    expect(() => getClientEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});

describe("getServerEnv", () => {
  it("reads the service-role key on the server", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-placeholder");

    expect(getServerEnv()).toEqual({
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key-placeholder",
    });
  });

  it("throws when the service-role key is absent", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    expect(() => getServerEnv()).toThrow(EnvValidationError);
    expect(() => getServerEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("refuses to run in a browser-like environment", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-placeholder");
    Object.defineProperty(globalThis, "window", {
      value: {},
      configurable: true,
      writable: true,
    });

    expect(() => getServerEnv()).toThrow(/called in the browser/);
  });
});
