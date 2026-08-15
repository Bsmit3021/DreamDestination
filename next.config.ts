import type { NextConfig } from "next";

/**
 * Conservative baseline headers.
 *
 * Deliberately no Content-Security-Policy yet: a CSP is only worth shipping
 * once the real script and connection origins are known, and a permissive
 * placeholder would give the appearance of protection without the substance.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
