import { FirebaseError } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  type Auth,
} from "firebase/auth";
import { NEUTRAL_SIGN_UP_MESSAGE } from "@/lib/auth";

/**
 * Creates an account without revealing whether the email already has one.
 * - New email: the account is created and a confirmation email is sent.
 * - Email already in use: a password-reset email is sent instead, so the
 *   owner of that address can get back in.
 * Both cases end signed out and return the same neutral message.
 */
export async function signUpNeutral(
  auth: Auth,
  email: string,
  password: string,
  continueUrl: string,
): Promise<string> {
  try {
    const { user } = await createUserWithEmailAndPassword(
      auth,
      email,
      password,
    );
    await sendEmailVerification(user, { url: continueUrl });
  } catch (error) {
    if (
      !(error instanceof FirebaseError) ||
      error.code !== "auth/email-already-in-use"
    )
      throw error;
    await sendPasswordResetEmail(auth, email, { url: continueUrl });
  } finally {
    await signOut(auth).catch(() => undefined);
  }
  return NEUTRAL_SIGN_UP_MESSAGE;
}
