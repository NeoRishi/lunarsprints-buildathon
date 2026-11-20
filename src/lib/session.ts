import { cookies } from "next/headers";
import type { DecodedIdToken } from "firebase-admin/auth";
import { AppError } from "@/features/lunarsprints/domain";
import { adminAuth, firebaseAdminConfigured } from "@/lib/firebase/admin";
import { databaseConfigured, withoutUser } from "@/lib/db";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

export type SessionUser = { id: string; email: string | null };

export function sessionConfigured() {
  return firebaseAdminConfigured() && databaseConfigured();
}

function signedOut() {
  return new AppError(
    "unauthenticated",
    "Sign in to save and plan your sprint.",
    401,
  );
}

/** Firebase error codes that mean "not signed in", not "service down". */
function isAuthRejection(error: unknown) {
  const code = (error as { code?: string })?.code ?? "";
  return code.startsWith("auth/");
}

function serviceDown() {
  return new AppError(
    "auth_unavailable",
    "Sign-in is temporarily unavailable. Your saved plans are safe. Please try again shortly.",
    503,
  );
}

/** Finds the internal ls_users id for a Firebase account, or null. */
async function internalId(firebaseUid: string) {
  return withoutUser(async (db) => {
    const { rows } = await db.query<{ id: string | null }>(
      "select public.ls_user_id($1)::text as id",
      [firebaseUid],
    );
    return rows[0]?.id ?? null;
  });
}

/**
 * Verifies a session cookie value, including revocation, and returns the
 * ls_users id. Unverified email accounts never pass.
 */
export async function userFromSessionCookie(
  value: string | undefined,
): Promise<SessionUser> {
  if (!value) throw signedOut();
  let decoded: DecodedIdToken;
  try {
    decoded = await adminAuth().verifySessionCookie(value, true);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isAuthRejection(error)) throw signedOut();
    throw serviceDown();
  }
  if (decoded.email_verified !== true) throw signedOut();
  const id = await internalId(decoded.uid);
  if (!id) throw signedOut();
  return { id, email: decoded.email ?? null };
}

/**
 * Exchanges a fresh Firebase ID token for a five-day session cookie.
 * Rejects tokens for accounts whose email is not confirmed yet.
 */
export async function createSession(idToken: string) {
  const auth = adminAuth();
  let decoded: DecodedIdToken;
  try {
    decoded = await auth.verifyIdToken(idToken, true);
  } catch (error) {
    if (isAuthRejection(error)) throw signedOut();
    throw serviceDown();
  }
  if (decoded.email_verified !== true)
    throw new AppError(
      "email_not_verified",
      "Check your inbox to confirm your email, then sign in again.",
      403,
    );
  // Only accept a recent sign-in, so an old leaked token cannot start a session.
  if (Date.now() / 1000 - decoded.auth_time > 5 * 60)
    throw new AppError(
      "reauthentication_required",
      "Please sign in again to continue.",
      401,
    );
  const id = await withoutUser(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      "select public.ls_sign_in($1, $2)::text as id",
      [decoded.uid, decoded.email ?? null],
    );
    return rows[0].id;
  });
  let cookie: string;
  try {
    cookie = await auth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
    });
  } catch (error) {
    if (isAuthRejection(error)) throw signedOut();
    throw serviceDown();
  }
  return { cookie, user: { id, email: decoded.email ?? null } };
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/** Reads the request's session cookie. Used by every signed-in route. */
export async function authenticated(): Promise<{ user: SessionUser }> {
  const store = await cookies();
  return {
    user: await userFromSessionCookie(store.get(SESSION_COOKIE)?.value),
  };
}
