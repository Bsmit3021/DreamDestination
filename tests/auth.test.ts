import { describe, expect, it } from "vitest";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  signInSchema,
  signUpSchema,
} from "@/lib/validation/auth";

const VALID_SIGN_UP = {
  email: "person@example.com",
  password: "correct-horse-battery",
  confirmPassword: "correct-horse-battery",
};

function paths(issues: { path: PropertyKey[] }[]): string[] {
  return issues.map((issue) => issue.path.join("."));
}

describe("signUpSchema", () => {
  it("accepts valid credentials", () => {
    const result = signUpSchema.safeParse(VALID_SIGN_UP);

    expect(result.success).toBe(true);
  });

  it.each([
    ["missing @", "person.example.com"],
    ["missing domain", "person@"],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("rejects an invalid email (%s)", (_label, email) => {
    const result = signUpSchema.safeParse({ ...VALID_SIGN_UP, email });

    expect(result.success).toBe(false);
    expect(paths(result.error?.issues ?? [])).toContain("email");
  });

  it("rejects a password shorter than the minimum", () => {
    const short = "a".repeat(PASSWORD_MIN_LENGTH - 1);

    const result = signUpSchema.safeParse({
      ...VALID_SIGN_UP,
      password: short,
      confirmPassword: short,
    });

    expect(result.success).toBe(false);
    expect(paths(result.error?.issues ?? [])).toContain("password");
  });

  it("accepts a password of exactly the minimum length", () => {
    const exact = "a".repeat(PASSWORD_MIN_LENGTH);

    const result = signUpSchema.safeParse({
      ...VALID_SIGN_UP,
      password: exact,
      confirmPassword: exact,
    });

    expect(result.success).toBe(true);
  });

  it("rejects a password longer than bcrypt's 72-byte limit", () => {
    const long = "a".repeat(PASSWORD_MAX_LENGTH + 1);

    const result = signUpSchema.safeParse({
      ...VALID_SIGN_UP,
      password: long,
      confirmPassword: long,
    });

    expect(result.success).toBe(false);
    expect(paths(result.error?.issues ?? [])).toContain("password");
  });

  it("rejects a mismatched confirmation and blames the confirm field", () => {
    const result = signUpSchema.safeParse({
      ...VALID_SIGN_UP,
      confirmPassword: "something-else",
    });

    expect(result.success).toBe(false);
    expect(paths(result.error?.issues ?? [])).toEqual(["confirmPassword"]);
    expect(result.error?.issues[0]?.message).toBe("Passwords do not match");
  });

  it("rejects a missing confirmation", () => {
    const result = signUpSchema.safeParse({
      email: VALID_SIGN_UP.email,
      password: VALID_SIGN_UP.password,
    });

    expect(result.success).toBe(false);
    expect(paths(result.error?.issues ?? [])).toContain("confirmPassword");
  });
});

describe("signInSchema", () => {
  it("accepts valid credentials", () => {
    const result = signInSchema.safeParse({
      email: "person@example.com",
      password: "anything-non-empty",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = signInSchema.safeParse({
      email: "not-an-email",
      password: "anything",
    });

    expect(result.success).toBe(false);
    expect(paths(result.error?.issues ?? [])).toEqual(["email"]);
  });

  it("rejects a missing password", () => {
    const result = signInSchema.safeParse({ email: "person@example.com" });

    expect(result.success).toBe(false);
    expect(paths(result.error?.issues ?? [])).toEqual(["password"]);
  });

  it("rejects an empty password", () => {
    const result = signInSchema.safeParse({
      email: "person@example.com",
      password: "",
    });

    expect(result.success).toBe(false);
    expect(paths(result.error?.issues ?? [])).toEqual(["password"]);
  });

  it("does not apply sign-up strength rules to sign-in", () => {
    // A short password must still be *accepted by validation* so the auth
    // server decides. Rejecting it here would reveal which passwords could
    // possibly belong to an account.
    const result = signInSchema.safeParse({
      email: "person@example.com",
      password: "x",
    });

    expect(result.success).toBe(true);
  });
});
