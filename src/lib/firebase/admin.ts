import {
  applicationDefault,
  getApp,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { AppError } from "@/features/lunarsprints/domain";

/**
 * Server Firebase Admin.
 * - Emulator: FIREBASE_AUTH_EMULATOR_HOST is set. No credentials are used.
 * - Real Firebase: Application Default Credentials (locally from
 *   `gcloud auth application-default login`, on Cloud Run from the service
 *   account). A downloaded service-account key file is never used.
 */
const APP_NAME = "lunarsprints-server";

export function firebaseAdminConfigured() {
  return Boolean(process.env.FIREBASE_PROJECT_ID);
}

function misconfigured() {
  return new AppError(
    "configuration_error",
    "Sign-in is not set up on this server yet. Your saved plans are safe. Please try again later.",
    503,
  );
}

export function adminAuth(): Auth {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw misconfigured();
  const emulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
  // The emulator accepts unsigned tokens. It must never be trusted in a
  // production server.
  if (emulator && process.env.NODE_ENV === "production") {
    console.error("Refusing the Auth emulator in a production server");
    throw misconfigured();
  }
  let app: App;
  if (getApps().some((a) => a.name === APP_NAME)) app = getApp(APP_NAME);
  else
    app = initializeApp(
      emulator
        ? { projectId }
        : { projectId, credential: applicationDefault() },
      APP_NAME,
    );
  return getAuth(app);
}
