/**
 * Sign-in flows against the Firebase Auth emulator and the local test
 * database. Run with: npm run test:auth (it starts the emulator for you).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  isSignInWithEmailLink,
  sendEmailVerification,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signOut,
  type Auth,
} from "firebase/auth";

const EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT = process.env.FIREBASE_PROJECT_ID;
if (!EMULATOR || !PROJECT)
  throw new Error(
    "The auth tests need the Firebase Auth emulator and FIREBASE_PROJECT_ID. Run them with npm run test:auth.",
  );
if (!process.env.DATABASE_URL_TEST)
  throw new Error(
    "DATABASE_URL_TEST is not set. The auth tests need the local lunarsprints_test database.",
  );
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
const ORIGIN = "http://127.0.0.1:3000";
process.env.APP_ORIGIN = ORIGIN;

const route = await import("../src/app/api/auth/session/route");
const { userFromSessionCookie } = await import("../src/lib/session");
const { closePool } = await import("../src/lib/db");

const app = initializeApp(
  { apiKey: "emulator-test-key", projectId: PROJECT },
  "auth-emulator-test",
);
let auth: Auth;
const run = crypto.randomUUID().slice(0, 8);
const password = "Moonlit-Test-9!";

beforeAll(() => {
  auth = getAuth(app);
  connectAuthEmulator(auth, `http://${EMULATOR}`, { disableWarnings: true });
});
afterAll(async () => {
  await signOut(auth).catch(() => undefined);
  await deleteApp(app);
  await closePool();
});

type OobCode = { email: string; requestType: string; oobLink: string };
async function latestLink(email: string, requestType: string) {
  const response = await fetch(
    `http://${EMULATOR}/emulator/v1/projects/${PROJECT}/oobCodes`,
  );
  const { oobCodes } = (await response.json()) as { oobCodes: OobCode[] };
  const match = oobCodes
    .filter((c) => c.email === email && c.requestType === requestType)
    .at(-1);
  if (!match) throw new Error(`No ${requestType} email for ${email}`);
  return match.oobLink;
}

function sessionPost(idToken: string, origin = ORIGIN) {
  return route.POST(
    new Request(`${ORIGIN}/api/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ idToken }),
    }),
  );
}
function cookieFrom(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  const match = /__session=([^;]*)/.exec(header);
  return { value: match ? decodeURIComponent(match[1]) : "", header };
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Firebase sign-in with server session cookies", () => {
  const email = `pw-${run}@example.com`;
  let cookie = "";
  let internalId = "";

  it("blocks a new password account until its email is confirmed", async () => {
    const { user } = await createUserWithEmailAndPassword(
      auth,
      email,
      password,
    );
    await sendEmailVerification(user);
    const response = await sessionPost(await user.getIdToken());
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("email_not_verified");
    expect(response.headers.get("set-cookie")).toBeNull();
    await signOut(auth);
  });

  it("signs in with email and password once the email is confirmed", async () => {
    const link = await latestLink(email, "VERIFY_EMAIL");
    expect((await fetch(link)).ok).toBe(true);
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    expect(user.emailVerified).toBe(true);
    const response = await sessionPost(await user.getIdToken());
    expect(response.status).toBe(200);
    const body = await response.json();
    internalId = body.user.id;
    expect(internalId).toMatch(/^[0-9a-f-]{36}$/);
    const set = cookieFrom(response);
    cookie = set.value;
    expect(cookie.length).toBeGreaterThan(20);
    expect(set.header).toMatch(/HttpOnly/i);
    expect(set.header).toMatch(/SameSite=lax/i);
    expect(set.header).toMatch(/Path=\//);
    expect(set.header).toMatch(/Max-Age=432000/);
    await signOut(auth);
  });

  it("verifies the session cookie and maps it to the ls_users id", async () => {
    expect(await userFromSessionCookie(cookie)).toEqual({
      id: internalId,
      email,
    });
    const status = await route.GET(
      new Request(`${ORIGIN}/api/auth/session`, {
        headers: { cookie: `__session=${encodeURIComponent(cookie)}` },
      }),
    );
    const body = await status.json();
    expect(body.user.id).toBe(internalId);
    expect(body.callbackUrl).toBe(`${ORIGIN}/auth/callback`);
    await expect(userFromSessionCookie("not-a-cookie")).rejects.toThrow(
      "Sign in",
    );
  });

  it("signing in again keeps the same internal user", async () => {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    const body = await (await sessionPost(await user.getIdToken())).json();
    expect(body.user.id).toBe(internalId);
    await signOut(auth);
  });

  it("sign-out clears the cookie and revokes the session everywhere", async () => {
    // Revocation is recorded in whole seconds after the sign-in time.
    await pause(1100);
    const response = await route.DELETE(
      new Request(`${ORIGIN}/api/auth/session`, {
        method: "DELETE",
        headers: {
          Origin: ORIGIN,
          cookie: `__session=${encodeURIComponent(cookie)}`,
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(
      /__session=;.*Max-Age=0/i,
    );
    await expect(userFromSessionCookie(cookie)).rejects.toThrow("Sign in");
  });

  it("signs in with an email sign-in link, even with no password", async () => {
    const linkEmail = `link-${run}@example.com`;
    await sendSignInLinkToEmail(auth, linkEmail, {
      url: `${ORIGIN}/auth/callback`,
      handleCodeInApp: true,
    });
    const link = await latestLink(linkEmail, "EMAIL_SIGNIN");
    expect(isSignInWithEmailLink(auth, link)).toBe(true);
    const { user } = await signInWithEmailLink(auth, linkEmail, link);
    expect(user.emailVerified).toBe(true);
    const response = await sessionPost(await user.getIdToken());
    expect(response.status).toBe(200);
    const { value } = cookieFrom(response);
    const signedIn = await userFromSessionCookie(value);
    expect(signedIn.email).toBe(linkEmail);
    expect(signedIn.id).not.toBe(internalId);
    await signOut(auth);
  });

  it("rejects session requests from another site", async () => {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    const token = await user.getIdToken();
    const response = await sessionPost(token, "https://attacker.example");
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
    expect(response.headers.get("set-cookie")).toBeNull();
    const del = await route.DELETE(
      new Request(`${ORIGIN}/api/auth/session`, {
        method: "DELETE",
        headers: { Origin: "https://attacker.example" },
      }),
    );
    expect(del.status).toBe(403);
    await signOut(auth);
  });

  it("rejects a forged token", async () => {
    const response = await sessionPost("x".repeat(64));
    expect(response.status).toBe(401);
  });
});
