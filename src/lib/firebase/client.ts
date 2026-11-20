"use client";
import { getApp, getApps, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  type Auth,
} from "firebase/auth";

/**
 * Browser Firebase Auth. The browser only proves who the user is; the server
 * then issues an httpOnly session cookie, so Firebase keeps nothing in browser
 * storage (in-memory persistence).
 */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const useEmulator = process.env.NEXT_PUBLIC_USE_AUTH_EMULATOR === "true";
/** Must match the auth port in firebase.json. */
export const AUTH_EMULATOR_URL = "http://127.0.0.1:9099";

export function firebaseClientConfigured() {
  return Boolean(
    config.apiKey && config.authDomain && config.projectId && config.appId,
  );
}

let auth: Auth | null = null;
let ready: Promise<void> | null = null;

export async function clientAuth(): Promise<Auth> {
  if (!firebaseClientConfigured())
    throw new Error(
      "Sign-in is not set up on this site yet. Please try again later.",
    );
  if (!auth) {
    const app = getApps().length ? getApp() : initializeApp(config);
    auth = getAuth(app);
    if (useEmulator)
      connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true });
    ready = setPersistence(auth, inMemoryPersistence);
  }
  await ready;
  return auth;
}
