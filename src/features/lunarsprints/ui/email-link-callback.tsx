"use client";
import { useEffect, useRef, useState } from "react";
import { isSignInWithEmailLink, signInWithEmailLink } from "firebase/auth";
import { clientAuth } from "@/lib/firebase/client";
import { EMAIL_FOR_SIGN_IN_KEY } from "@/lib/auth";
import { Button, Notice } from "./shared";
import { messageFor, startSession } from "./auth-client";

function rememberedEmail() {
  try {
    return window.localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY);
  } catch {
    return null;
  }
}
function forgetEmail() {
  try {
    window.localStorage.removeItem(EMAIL_FOR_SIGN_IN_KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}

/** Completes "Email me a sign-in link" and then starts the server session. */
export function EmailLinkCallback() {
  const [state, setState] = useState<
    "checking" | "ask_email" | "working" | "invalid" | "failed"
  >("checking");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const started = useRef(false);

  async function complete(address: string) {
    setState("working");
    setError("");
    try {
      const auth = await clientAuth();
      const { user } = await signInWithEmailLink(
        auth,
        address,
        window.location.href,
      );
      await startSession(user);
      forgetEmail();
      window.location.replace("/app");
    } catch (e) {
      setError(messageFor(e));
      setState("failed");
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const auth = await clientAuth();
        if (!isSignInWithEmailLink(auth, window.location.href)) {
          setState("invalid");
          return;
        }
        const saved = rememberedEmail();
        // Opened on another device or browser: ask which email it was sent to.
        if (saved) await complete(saved);
        else setState("ask_email");
      } catch (e) {
        setError(messageFor(e));
        setState("failed");
      }
    })();
  }, []);

  return (
    <main id="main-content" className="workspace">
      <section className="panel auth-panel">
        <div>
          <h2>Signing you in</h2>
          {(state === "checking" || state === "working") && (
            <p role="status">Checking your sign-in link…</p>
          )}
        </div>
        {state === "ask_email" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void complete(email.trim());
            }}
          >
            <p>
              This link was opened on a different device or browser. Enter the
              email address the link was sent to.
            </p>
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <Button type="submit">Continue</Button>
          </form>
        )}
        {state === "invalid" && (
          <Notice warning>
            This is not a valid sign-in link. Go back and request a new one.
          </Notice>
        )}
        {state === "failed" && (
          <div role="alert">
            <Notice warning>{error}</Notice>
          </div>
        )}
        {(state === "invalid" || state === "failed") && (
          <a className="button secondary" href="/app">
            Back to sign in
          </a>
        )}
      </section>
    </main>
  );
}
