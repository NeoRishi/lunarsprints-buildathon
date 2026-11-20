"use client";
import { signOut, type User } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { authErrorMessage } from "@/lib/auth";
import { clientAuth } from "@/lib/firebase/client";

/** Turns any sign-in failure into a plain sentence for the screen. */
export function messageFor(error: unknown) {
  if (error instanceof FirebaseError) return authErrorMessage(error.code);
  if (error instanceof Error && error.message) return error.message;
  return "Sign-in could not be completed. Please try again.";
}

/**
 * Sends the user's fresh ID token to the server, which checks it and sets the
 * httpOnly session cookie. The browser copy of the Firebase sign-in is then
 * cleared, so the cookie is the only session.
 */
export async function startSession(user: User) {
  const idToken = await user.getIdToken(true);
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      body?.error?.message ?? "Sign-in could not be completed. Please try again.",
    ) as Error & { code?: string };
    error.code = body?.error?.code;
    throw error;
  }
  await signOut(await clientAuth());
}
