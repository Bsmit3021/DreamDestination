import { z } from "zod";

/**
 * Credential validation, shared by the sign-in/sign-up forms and their server
 * actions so both agree on what "valid" means.
 */

/** Kept in step with `minimum_password_length` in supabase/config.toml. */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * bcrypt only considers the first 72 bytes, so anything longer is silently
 * truncated at the auth server. Reject it instead of accepting a password
 * that would not round-trip.
 */
export const PASSWORD_MAX_LENGTH = 72;

const emailSchema = z
  .email({ message: "Enter a valid email address" })
  .max(254, { message: "Email address is too long" });

export const signInSchema = z.object({
  email: emailSchema,
  // Deliberately only a presence check: applying strength rules to sign-in
  // would leak which passwords could possibly be valid.
  password: z.string().min(1, { message: "Enter your password" }),
});

export const signUpSchema = z
  .object({
    email: emailSchema,
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, {
        message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
      })
      .max(PASSWORD_MAX_LENGTH, {
        message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
      }),
    confirmPassword: z.string().min(1, { message: "Confirm your password" }),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
