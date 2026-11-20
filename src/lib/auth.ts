import { z } from "zod";

/** POST /api/auth/session body: a Firebase ID token from the browser SDK. */
export const sessionRequestSchema = z.object({
  idToken: z.string().min(20).max(8192),
});

/** Session cookie name. "__session" also passes through Firebase Hosting. */
export const SESSION_COOKIE = "__session";
/** Five days, the length the session cookie is valid for. */
export const SESSION_MAX_AGE_SECONDS = 5 * 24 * 60 * 60;

/** Browser storage key for the address an email sign-in link was sent to. */
export const EMAIL_FOR_SIGN_IN_KEY = "lunarsprints.emailForSignIn";

/** Password rule shown on sign-up. Firebase also enforces its own minimum. */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72;

/**
 * Plain messages for Firebase Auth error codes. Account existence is never
 * revealed: wrong password and unknown email read the same.
 */
export function authErrorMessage(code: string | undefined): string {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-login-credentials":
      return "Could not sign in with these details. Check your email and password, or use Forgot password.";
    case "auth/email-already-in-use":
      return "This email already has an account. Sign in, or use Forgot password.";
    case "auth/invalid-email":
    case "auth/missing-email":
      return "Enter a valid email address.";
    case "auth/weak-password":
    case "auth/password-does-not-meet-requirements":
      return `Use ${PASSWORD_MIN} to ${PASSWORD_MAX} characters, with uppercase and lowercase letters, a number and a symbol.`;
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a few minutes before trying again.";
    case "auth/network-request-failed":
      return "Could not reach the sign-in service. Check your connection and try again.";
    case "auth/invalid-action-code":
    case "auth/expired-action-code":
      return "This sign-in link has expired or was already used. Request a new one.";
    case "auth/user-disabled":
      return "This account is turned off. Contact us if you think this is a mistake.";
    case "auth/operation-not-allowed":
      return "This way of signing in is not turned on yet. Please use another option.";
    case "auth/unauthorized-continue-uri":
    case "auth/invalid-continue-uri":
      return "Sign-in emails are not set up for this address yet. Please try again later.";
    case "auth/quota-exceeded":
      return "The email service has reached its limit for now. Please try again later.";
    default:
      return "Sign-in could not be completed. Please try again.";
  }
}
