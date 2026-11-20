import "./safe-test-errors";
import { request, chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const ref = "jhkoxgyxrihsuhpjqkxc";
assert.equal(
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname,
  ref + ".supabase.co",
);
const api = await request.newContext({
  baseURL: "http://127.0.0.1:3000",
  extraHTTPHeaders: { Origin: new URL("http://127.0.0.1:3000").origin },
});
const health = await (await api.get("/health")).json();
assert.equal(health.ok, true);
const response = await api.post("/api/auth", { data: { action: "google" } });
assert.equal(response.status(), 200);
const result = await response.json();
const authorize = new URL(result.redirectUrl);
assert.equal(authorize.origin, "https://" + ref + ".supabase.co");
assert.equal(authorize.searchParams.get("provider"), "google");
assert.equal(
  authorize.searchParams.get("redirect_to"),
  "http://127.0.0.1:3000/auth/callback",
);
assert.equal(authorize.searchParams.get("code_challenge_method"), "s256");
const cookie = (await api.storageState()).cookies.find(
  (c) => c.name.includes(ref) && c.name.includes("code-verifier"),
);
assert(
  cookie?.httpOnly && cookie.sameSite === "Lax",
  "PKCE verifier must stay in an HttpOnly SameSite cookie",
);
const redirect = await api.get(result.redirectUrl, { maxRedirects: 0 });
assert.equal(redirect.status(), 302);
const google = new URL(redirect.headers().location);
assert.equal(google.hostname, "accounts.google.com");
assert.equal(
  google.searchParams.get("redirect_uri"),
  "https://" + ref + ".supabase.co/auth/v1/callback",
);
assert(
  !/drive|calendar|gmail/i.test(google.searchParams.get("scope") ?? ""),
  "No additional Google data scopes may be requested",
);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:3000/app");
await page
  .getByRole("button", { name: "Continue with Google", exact: true })
  .waitFor();
await page
  .locator(".auth-panel")
  .screenshot({ path: "docs/evidence/lifeos-sign-in.png" });
await page.setViewportSize({ width: 390, height: 844 });
assert(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
);
await page.screenshot({
  path: "docs/evidence/lifeos-sign-in-mobile.png",
  fullPage: true,
});
assert.deepEqual(errors, []);
await writeFile(
  "docs/evidence/lifeos-oauth.json",
  JSON.stringify(
    {
      passed: true,
      projectRef: ref,
      verifiedAt: new Date().toISOString(),
      checks: [
        "running Desktop app uses LifeOS",
        "Google can start without an email/password field",
        "provider redirect reaches accounts.google.com",
        "exact local app callback preserved",
        "PKCE uses S256 and an HttpOnly SameSite Lax cookie",
        "existing LifeOS Google callback reused",
        "no additional Google data scopes requested",
        "Google button rendered",
        "mobile no overflow",
        "no browser page errors",
      ],
      googleAccountConsent:
        "User completes Google sign-in; the gateway check does not claim to complete account consent.",
    },
    null,
    2,
  ),
);
await browser.close();
await api.dispose();
console.log(
  "LifeOS runtime and existing Google authorization gateway verified. No Google account consent was automated.",
);
