import { NextResponse } from "next/server";
import { failure, jsonBody, requestOrigin, sameOrigin } from "@/lib/http";
import { SESSION_COOKIE, sessionRequestSchema } from "@/lib/auth";
import { AppError } from "@/features/lunarsprints/domain";
import {
  createSession,
  sessionConfigured,
  sessionCookieOptions,
  userFromSessionCookie,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

function readCookie(request: Request) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/**
 * Who is signed in. Also returns the email-link landing address, decided by
 * the server from APP_ORIGIN, never from the browser.
 */
export async function GET(request: Request) {
  try {
    if (!sessionConfigured())
      return NextResponse.json(
        { configured: false, user: null },
        { headers: noStore },
      );
    const callbackUrl = new URL("/auth/callback", requestOrigin(request)).href;
    let user = null;
    try {
      user = await userFromSessionCookie(readCookie(request));
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "unauthenticated")
        throw error;
    }
    return NextResponse.json(
      { configured: true, user, callbackUrl },
      { headers: noStore },
    );
  } catch (error) {
    return failure(error);
  }
}

/** Exchanges a Firebase ID token for an httpOnly session cookie. */
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { idToken } = sessionRequestSchema.parse(await jsonBody(request));
    const { cookie, user } = await createSession(idToken);
    const response = NextResponse.json(
      { ok: true, user },
      { headers: noStore },
    );
    response.cookies.set(SESSION_COOKIE, cookie, sessionCookieOptions());
    return response;
  } catch (error) {
    return failure(error);
  }
}

/**
 * Signs out on this device only: clears this browser's session cookie.
 * Sessions on other devices keep working until they expire or sign out.
 */
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
  } catch (error) {
    return failure(error);
  }
  const response = NextResponse.json({ ok: true }, { headers: noStore });
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
