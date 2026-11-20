import type { NextConfig } from "next";
// Applied only to production builds: development needs eval for fast refresh.
// Scripts and styles allow inline because Next's bootstrap uses them; every
// other source is limited to this site.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");
const productionHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];
const config: NextConfig = {
  // Vercel sets NEXT_DEPLOYMENT_ID and Next refuses a build whose config
  // names a different id, so use it whenever it is present.
  deploymentId:
    process.env.NEXT_DEPLOYMENT_ID ??
    process.env.DEPLOYMENT_VERSION ??
    "lunarsprints-local",
  poweredByHeader: false,
  devIndicators: false,
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["@openai/agents", "openai"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=(self)",
          },
          ...(process.env.NODE_ENV === "production" ? productionHeaders : []),
        ],
      },
    ];
  },
};
export default config;
