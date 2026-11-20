"use client";
import { useRef, useState } from "react";
import {
  sendEmailVerification,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  type User,
} from "firebase/auth";
import { clientAuth } from "@/lib/firebase/client";
import { signUpNeutral } from "@/lib/firebase/flows";
import { EMAIL_FOR_SIGN_IN_KEY, PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth";
import { Button, Notice } from "./shared";
import { messageFor, startSession } from "./auth-client";

type Mode = "login" | "signup" | "link" | "verify";

export function AuthPanel({
  callbackUrl,
  onAuthenticated,
}: {
  callbackUrl: string;
  onAuthenticated: () => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const emailInput = useRef<HTMLInputElement>(null);
  // The account waiting for email confirmation, kept in memory only.
  const pending = useRef<User | null>(null);
  // Where confirmation and password emails send the user back to.
  const appUrl = new URL("/app", callbackUrl).href;

  async function run(work: () => Promise<void>, needsEmail = true) {
    if (busy || (needsEmail && !emailInput.current?.reportValidity())) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish(user: User) {
    if (!user.emailVerified) {
      pending.current = user;
      setPassword("");
      setMode("verify");
      return;
    }
    await startSession(user);
    await onAuthenticated();
  }

  const signUp = () =>
    run(async () => {
      if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)
        throw new Error(
          `Use ${PASSWORD_MIN} to ${PASSWORD_MAX} characters for your password.`,
        );
      const message = await signUpNeutral(
        await clientAuth(),
        email.trim(),
        password,
        appUrl,
      );
      setPassword("");
      setMode("login");
      setNotice(message);
    });

  const signIn = () =>
    run(async () => {
      const auth = await clientAuth();
      const { user } = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password,
      );
      await finish(user);
    });

  const sendLink = () =>
    run(async () => {
      const auth = await clientAuth();
      const address = email.trim();
      await sendSignInLinkToEmail(auth, address, {
        url: callbackUrl,
        handleCodeInApp: true,
      });
      try {
        window.localStorage.setItem(EMAIL_FOR_SIGN_IN_KEY, address);
      } catch {
        // Storage can be blocked. The callback page then asks for the email.
      }
      setNotice(
        `We sent a sign-in link to ${address}. Open it on this device to sign in. Check your spam folder if it does not arrive in a few minutes.`,
      );
    });

  const forgot = () =>
    run(async () => {
      const auth = await clientAuth();
      await sendPasswordResetEmail(auth, email.trim(), {
        url: appUrl,
      });
      setNotice(
        "If an account uses this email, we sent a link to choose a new password. Check your inbox and spam folder.",
      );
    });

  const sendAgain = () =>
    run(async () => {
      const user = pending.current;
      if (!user) {
        setMode("login");
        throw new Error("Sign in again to get a new confirmation email.");
      }
      await sendEmailVerification(user, { url: appUrl });
      setNotice("We sent a new confirmation email. Use the newest one.");
    }, false);

  const confirmed = () =>
    run(async () => {
      const user = pending.current;
      if (!user) {
        setMode("login");
        throw new Error("Sign in with your email and password to continue.");
      }
      await user.reload();
      if (!user.emailVerified)
        throw new Error(
          "Your email is not confirmed yet. Open the link in the email we sent, then try again.",
        );
      pending.current = null;
      await startSession(user);
      await onAuthenticated();
    }, false);

  function switchTo(next: Mode) {
    setMode(next);
    setError("");
    setNotice("");
  }

  if (mode === "verify")
    return (
      <section className="panel auth-panel">
        <div>
          <h2>Check your inbox to confirm your email</h2>
          <p>
            We sent a confirmation link to {email.trim() || "your email"}. Open
            it, then come back here and continue.
          </p>
        </div>
        <div className="auth-help">
          <Button busy={busy} onClick={() => void confirmed()}>
            I have confirmed my email
          </Button>
          <Button secondary busy={busy} onClick={() => void sendAgain()}>
            Send the email again
          </Button>
        </div>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            pending.current = null;
            switchTo("login");
          }}
        >
          Use a different account
        </button>
        {notice && (
          <div role="status">
            <Notice>{notice}</Notice>
          </div>
        )}
        {error && (
          <div role="alert">
            <Notice warning>{error}</Notice>
          </div>
        )}
      </section>
    );

  return (
    <section className="panel auth-panel">
      <div>
        <h2>Sign in or create your NeoRishi account</h2>
        <p>
          One free account for every NeoRishi product. Your sprint is saved to
          it, so you can pick it up on any device.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void (mode === "signup"
            ? signUp()
            : mode === "link"
              ? sendLink()
              : signIn());
        }}
        aria-busy={busy}
      >
        <label>
          Email
          <input
            ref={emailInput}
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        {mode !== "link" && (
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              required
              minLength={mode === "signup" ? PASSWORD_MIN : 1}
              maxLength={mode === "signup" ? PASSWORD_MAX : 200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {mode === "signup" && (
          <p className="small">
            Use {PASSWORD_MIN} to {PASSWORD_MAX} characters with uppercase and
            lowercase letters, a number and a symbol. Confirm your email before
            you sign in.
          </p>
        )}
        {mode === "link" && (
          <p className="small">
            No password needed. We will email you a link that signs you in.
          </p>
        )}
        <Button type="submit" busy={busy}>
          {mode === "login"
            ? "Sign in"
            : mode === "signup"
              ? "Create account"
              : "Email me a sign-in link"}
        </Button>
        {mode !== "link" ? (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => switchTo("link")}
          >
            Email me a sign-in link instead
          </button>
        ) : (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => switchTo("login")}
          >
            Sign in with a password instead
          </button>
        )}
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => switchTo(mode === "signup" ? "login" : "signup")}
        >
          {mode === "signup"
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
        {mode === "login" && (
          <div className="auth-help">
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => void forgot()}
            >
              Forgot password?
            </button>
          </div>
        )}
        {notice && (
          <div role="status">
            <Notice>{notice}</Notice>
          </div>
        )}
        {error && (
          <div role="alert">
            <Notice warning>{error}</Notice>
          </div>
        )}
      </form>
    </section>
  );
}
