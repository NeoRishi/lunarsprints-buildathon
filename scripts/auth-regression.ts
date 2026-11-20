import "./safe-test-errors";
import { createClient } from "@supabase/supabase-js";
import { chromium, request } from "@playwright/test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

assert(
  process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("jhkoxgyxrihsuhpjqkxc"),
  "Only the authorized LifeOS project may be tested.",
);
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
);
const email = `qa-auth-${crypto.randomUUID().slice(0, 8)}@lunarsprints.example`;
const oldPassword = "OlderPass8!";
const newPassword = "Aa9!" + crypto.randomUUID() + "-Updated";
const user = await admin.auth.admin.createUser({
  email,
  password: oldPassword,
  email_confirm: true,
  app_metadata: { lunarsprints_test: true },
});
assert(!user.error, "Could not create synthetic auth-test user");
const api = await request.newContext({
  baseURL: "http://127.0.0.1:3000",
  extraHTTPHeaders: { Origin: new URL("http://127.0.0.1:3000").origin },
});
const denied = await api.post("/api/auth", {
  data: { action: "update_password", password: newPassword },
});
assert.equal(denied.status(), 401);
const duplicate = await api.post("/api/auth", {
  data: { action: "signup", email, password: newPassword },
});
assert.equal(duplicate.status(), 200);
const signup = await duplicate.json();
assert(signup.message.includes("Already registered?"));
assert(!/email (was|has been) sent/i.test(signup.message));
const login = await api.post("/api/auth", {
  data: { action: "login", email, password: oldPassword },
});
assert.equal(
  login.status(),
  200,
  "Existing policy-compliant password must remain valid",
);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState: await api.storageState(),
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:3000/account/reset-password");
await page.getByLabel("New password", { exact: true }).fill(newPassword);
await page
  .getByLabel("Confirm new password", { exact: true })
  .fill(newPassword);
const saved = page.waitForResponse(
  (r) => r.url().endsWith("/api/auth") && r.request().method() === "POST",
);
await page
  .getByRole("button", { name: "Update password", exact: true })
  .click();
assert.equal((await saved).status(), 200);
await page
  .getByRole("heading", { name: "Your password is updated." })
  .waitFor();
await page.screenshot({
  path: "docs/evidence/password-updated.png",
  fullPage: true,
});
assert.deepEqual(errors, []);
const unsigned = await request.newContext({
  baseURL: "http://127.0.0.1:3000",
  extraHTTPHeaders: { Origin: new URL("http://127.0.0.1:3000").origin },
});
assert.equal(
  (
    await unsigned.post("/api/auth", {
      data: { action: "login", email, password: oldPassword },
    })
  ).status(),
  400,
  "Old password should fail",
);
assert.equal(
  (
    await unsigned.post("/api/auth", {
      data: { action: "login", email, password: newPassword },
    })
  ).status(),
  200,
  "New password should succeed",
);
const anonContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const anon = await anonContext.newPage();
await anon.goto("http://127.0.0.1:3000/account/reset-password");
await anon
  .getByText("This recovery link is missing or expired.", { exact: false })
  .waitFor();
assert.equal(
  await anon
    .getByRole("button", { name: "Update password", exact: true })
    .count(),
  0,
);
await anon.goto("http://127.0.0.1:3000/app");
await anon
  .getByRole("button", { name: "Forgot password?", exact: true })
  .waitFor();
assert.equal(
  await anon
    .getByRole("button", { name: "Resend confirmation", exact: true })
    .count(),
  1,
);
assert(
  await anon.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
);
await anon.screenshot({
  path: "docs/evidence/auth-mobile.png",
  fullPage: true,
});
await writeFile(
  "docs/evidence/auth-fix.json",
  JSON.stringify(
    {
      passed: true,
      verifiedAt: new Date().toISOString(),
      checks: [
        "duplicate confirmed signup has no false email promise",
        "existing policy-compliant password accepted for login",
        "password updates require a verified session",
        "actual authenticated password form saved through Supabase",
        "old password rejected and new password accepted",
        "missing recovery session shows safe recovery instructions",
        "resend and forgot-password controls rendered",
        "mobile no overflow",
        "no browser page errors",
      ],
      limits: [
        "Synthetic password update verifies the form and API; the human user chooses their own password via the emailed PKCE recovery link.",
        "Default SMTP is still restricted; custom SMTP is required before public signup.",
      ],
    },
    null,
    2,
  ),
);
await browser.close();
await api.dispose();
await unsigned.dispose();
console.log(
  "Live signup and password-recovery regression checks passed; no real user's password was changed.",
);
