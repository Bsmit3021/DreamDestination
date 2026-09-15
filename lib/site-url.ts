/**
 * The canonical absolute URL of this deployment.
 *
 * Almost every redirect in the app is a relative path, which needs no origin
 * and is safest by construction. Two things do need an absolute URL: the email
 * confirmation link Supabase sends on sign-up, and any password-reset link if
 * one is added later. Those are handed to Supabase, which then requires the
 * result to match an allow-listed redirect URL exactly.
 *
 * ---------------------------------------------------------------------------
 * Why this branches on the environment instead of falling through a list
 * ---------------------------------------------------------------------------
 * The obvious implementation — try `NEXT_PUBLIC_SITE_URL`, then
 * `VERCEL_PROJECT_PRODUCTION_URL`, then `VERCEL_URL` — is wrong on Preview, and
 * wrong in a way that is invisible until someone signs up on a preview
 * deployment.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` is the project's *production* domain and
 * Vercel sets it in **every** environment, Preview included. A fall-through
 * list therefore resolves a Preview deployment to the production origin, and
 * the confirmation email sends the tester to production — where the account
 * they just created on preview may not even exist. `NEXT_PUBLIC_SITE_URL` has
 * the same failure mode whenever it is set for all environments, which is the
 * path of least resistance in the Vercel dashboard.
 *
 * So the environment decides first, and only then does a value get chosen.
 *
 * ---------------------------------------------------------------------------
 * Why not read the request's own origin
 * ---------------------------------------------------------------------------
 * Because the origin of an incoming request is attacker-influenced (`Host`,
 * `X-Forwarded-Host`), and an emailed link built from it would send the user
 * wherever the header said. The origin comes from deployment configuration
 * only.
 */

/** Local development fallback, matching `supabase/config.toml`'s `site_url`. */
const LOCAL_ORIGIN = "http://localhost:3000";

/** The subset of the environment this module reads. Injected so it is testable. */
export interface SiteUrlEnv {
  /** Vercel's environment indicator: "production" | "preview" | "development". */
  VERCEL_ENV?: string | undefined;
  /** This specific deployment's generated URL. Unique per preview deployment. */
  VERCEL_URL?: string | undefined;
  /** The project's production domain — set in *every* environment. */
  VERCEL_PROJECT_PRODUCTION_URL?: string | undefined;
  /** Explicit override. Authoritative in production, ignored on preview. */
  NEXT_PUBLIC_SITE_URL?: string | undefined;
}

/** Adds a scheme to the bare hostnames Vercel exposes, and trims any slash. */
function normalize(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function firstUsable(...values: (string | undefined)[]): string | null {
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized) return normalized;
  }
  return null;
}

/**
 * The origin of this deployment, without a trailing slash.
 *
 * Never throws: a missing configuration falls back to localhost rather than
 * breaking a page render, because the only callers are link builders where a
 * wrong-but-present origin is more debuggable than a crash.
 */
export function getSiteUrl(
  env: SiteUrlEnv = process.env as SiteUrlEnv,
): string {
  switch (env.VERCEL_ENV) {
    case "preview":
      // This deployment, and nothing else. `NEXT_PUBLIC_SITE_URL` and
      // `VERCEL_PROJECT_PRODUCTION_URL` are both deliberately ignored here:
      // each of them points at production, which is precisely the mistake this
      // branch exists to prevent. Preview URLs are generated per deployment, so
      // Supabase needs a wildcard redirect entry to accept them.
      return firstUsable(env.VERCEL_URL) ?? LOCAL_ORIGIN;

    case "production":
      // The explicit override wins, so a custom domain survives a project
      // rename. `VERCEL_PROJECT_PRODUCTION_URL` is the correct default here,
      // and this is the one environment where it means what it says.
      return (
        firstUsable(
          env.NEXT_PUBLIC_SITE_URL,
          env.VERCEL_PROJECT_PRODUCTION_URL,
          env.VERCEL_URL,
        ) ?? LOCAL_ORIGIN
      );

    default:
      // Local development, `vercel dev`, tests, and anything else that is not
      // a Vercel deployment. No Vercel URL is meaningful here.
      return firstUsable(env.NEXT_PUBLIC_SITE_URL) ?? LOCAL_ORIGIN;
  }
}

/**
 * An absolute URL for a path inside this deployment.
 *
 * Only accepts an app-relative path. A caller cannot pass an absolute URL and
 * have it echoed back, which is what would turn this helper into an open
 * redirect the moment one is built from user input.
 */
export function absoluteUrl(
  path: string,
  env: SiteUrlEnv = process.env as SiteUrlEnv,
): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error(
      `absoluteUrl expects an app-relative path beginning with a single "/", received "${path}"`,
    );
  }

  return `${getSiteUrl(env)}${path}`;
}
