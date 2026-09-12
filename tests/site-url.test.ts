import { describe, expect, it } from "vitest";

import { absoluteUrl, getSiteUrl, type SiteUrlEnv } from "@/lib/site-url";

/**
 * Canonical deployment URL resolution.
 *
 * The behaviour that matters: a Preview deployment must build its own links,
 * never production's. Getting that wrong is invisible until a tester signs up
 * on a preview and the confirmation email sends them to production, where the
 * account they just made may not exist.
 */

const PROD = "dreamdestination.example";
const PREVIEW = "dreamdestination-git-feature-abc123.vercel.app";

describe("development", () => {
  it("falls back to localhost when nothing is configured", () => {
    expect(getSiteUrl({})).toBe("http://localhost:3000");
  });

  it("honours an explicit override locally", () => {
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "http://localhost:4000" })).toBe(
      "http://localhost:4000",
    );
  });

  it("treats VERCEL_ENV=development as local", () => {
    expect(getSiteUrl({ VERCEL_ENV: "development" })).toBe(
      "http://localhost:3000",
    );
  });

  it("ignores Vercel deployment URLs when not on Vercel", () => {
    // `vercel dev` and stray shell exports must not turn a local run into a
    // deployment origin.
    expect(
      getSiteUrl({
        VERCEL_URL: PREVIEW,
        VERCEL_PROJECT_PRODUCTION_URL: PROD,
      }),
    ).toBe("http://localhost:3000");
  });
});

describe("preview", () => {
  it("uses this deployment's own URL", () => {
    expect(getSiteUrl({ VERCEL_ENV: "preview", VERCEL_URL: PREVIEW })).toBe(
      `https://${PREVIEW}`,
    );
  });

  it("does NOT use VERCEL_PROJECT_PRODUCTION_URL", () => {
    // The regression this module was rewritten for. Vercel sets
    // VERCEL_PROJECT_PRODUCTION_URL in every environment, so a fall-through
    // list resolved preview to production.
    const url = getSiteUrl({
      VERCEL_ENV: "preview",
      VERCEL_URL: PREVIEW,
      VERCEL_PROJECT_PRODUCTION_URL: PROD,
    });

    expect(url).toBe(`https://${PREVIEW}`);
    expect(url).not.toContain(PROD);
  });

  it("does NOT use NEXT_PUBLIC_SITE_URL", () => {
    // Setting NEXT_PUBLIC_SITE_URL for "all environments" is the path of least
    // resistance in the Vercel dashboard, and would otherwise reintroduce the
    // same bug through a different door.
    const url = getSiteUrl({
      VERCEL_ENV: "preview",
      VERCEL_URL: PREVIEW,
      NEXT_PUBLIC_SITE_URL: `https://${PROD}`,
    });

    expect(url).toBe(`https://${PREVIEW}`);
    expect(url).not.toContain(PROD);
  });

  it("adds the scheme Vercel omits", () => {
    // VERCEL_URL is a bare hostname.
    expect(getSiteUrl({ VERCEL_ENV: "preview", VERCEL_URL: PREVIEW })).toMatch(
      /^https:\/\//,
    );
  });

  it("falls back to localhost if VERCEL_URL is somehow absent", () => {
    // Never returns production as a consolation prize.
    const url = getSiteUrl({
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_PRODUCTION_URL: PROD,
    });

    expect(url).toBe("http://localhost:3000");
    expect(url).not.toContain(PROD);
  });

  it("gives two preview deployments two different origins", () => {
    const first = getSiteUrl({ VERCEL_ENV: "preview", VERCEL_URL: PREVIEW });
    const second = getSiteUrl({
      VERCEL_ENV: "preview",
      VERCEL_URL: "dreamdestination-git-other-def456.vercel.app",
    });

    expect(first).not.toBe(second);
  });
});

describe("production", () => {
  it("prefers the explicit override", () => {
    expect(
      getSiteUrl({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SITE_URL: `https://${PROD}`,
        VERCEL_PROJECT_PRODUCTION_URL: "vercel-generated.vercel.app",
      }),
    ).toBe(`https://${PROD}`);
  });

  it("uses the project production domain when no override is set", () => {
    expect(
      getSiteUrl({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: PROD,
        VERCEL_URL: "deployment-specific.vercel.app",
      }),
    ).toBe(`https://${PROD}`);
  });

  it("falls back to the deployment URL as a last resort", () => {
    expect(
      getSiteUrl({
        VERCEL_ENV: "production",
        VERCEL_URL: "only-this.vercel.app",
      }),
    ).toBe("https://only-this.vercel.app");
  });

  it("is stable across deployments", () => {
    // Production links must not change every time something ships.
    const a = getSiteUrl({
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: PROD,
      VERCEL_URL: "deploy-one.vercel.app",
    });
    const b = getSiteUrl({
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: PROD,
      VERCEL_URL: "deploy-two.vercel.app",
    });

    expect(a).toBe(b);
  });
});

describe("normalisation", () => {
  it("strips trailing slashes so paths do not double up", () => {
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://example.com///" })).toBe(
      "https://example.com",
    );
  });

  it("preserves an explicit http scheme", () => {
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "http://example.com" })).toBe(
      "http://example.com",
    );
  });

  it("ignores blank and whitespace-only values", () => {
    expect(getSiteUrl({ NEXT_PUBLIC_SITE_URL: "   " })).toBe(
      "http://localhost:3000",
    );
    expect(getSiteUrl({ VERCEL_ENV: "preview", VERCEL_URL: "" })).toBe(
      "http://localhost:3000",
    );
  });
});

describe("absoluteUrl", () => {
  const preview: SiteUrlEnv = { VERCEL_ENV: "preview", VERCEL_URL: PREVIEW };

  it("joins an app-relative path onto the resolved origin", () => {
    expect(absoluteUrl("/onboarding", preview)).toBe(
      `https://${PREVIEW}/onboarding`,
    );
  });

  it("builds preview confirmation links against preview, not production", () => {
    const link = absoluteUrl("/onboarding", {
      ...preview,
      VERCEL_PROJECT_PRODUCTION_URL: PROD,
      NEXT_PUBLIC_SITE_URL: `https://${PROD}`,
    });

    expect(link).toBe(`https://${PREVIEW}/onboarding`);
    expect(link).not.toContain(PROD);
  });

  it.each([
    "https://evil.example/steal",
    "http://evil.example",
    "//evil.example",
    "evil.example",
    "onboarding",
    "",
  ])("rejects %s rather than echoing it back", (path) => {
    // The guard that stops this helper becoming an open redirect the moment
    // someone builds a path from user input.
    expect(() => absoluteUrl(path, preview)).toThrow(
      /app-relative path beginning with a single/,
    );
  });

  it("accepts a path that merely contains a protocol-like substring", () => {
    expect(absoluteUrl("/redirect?to=https://example.com", preview)).toBe(
      `https://${PREVIEW}/redirect?to=https://example.com`,
    );
  });

  it("never produces a double slash between origin and path", () => {
    expect(
      absoluteUrl("/onboarding", {
        NEXT_PUBLIC_SITE_URL: "https://example.com/",
      }),
    ).toBe("https://example.com/onboarding");
  });
});
