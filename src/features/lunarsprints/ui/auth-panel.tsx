"use client";
import { useRef, useState } from "react";
import type { AuthCommand } from "@/lib/auth";
import { Button, Notice } from "./shared";

export function AuthPanel({
  onAuthenticated,
}: {
  onAuthenticated: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const emailInput = useRef<HTMLInputElement>(null);

  async function submit(action: AuthCommand["action"]) {
    if (busy || (action !== "google" && !emailInput.current?.reportValidity()))
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(action === "google" ? {} : { email: email.trim() }),
          ...(["login", "signup"].includes(action) ? { password } : {}),
        }),
      });
      const result = await r.json();
      if (!r.ok)
        throw new Error(
          result.error?.message ??
            "This request could not be completed. Please try again.",
        );
      if (result.redirectUrl) {
        window.location.assign(result.redirectUrl);
        return;
      }
      if (
        ["resend_confirmation", "request_password_reset"].includes(action) ||
        result.needsConfirmation
      ) {
        setNotice(result.message);
        setPassword("");
        setMode("login");
      } else await onAuthenticated();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Connection unavailable. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
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
          void submit(mode);
        }}
        aria-busy={busy}
      >
        <Button
          type="button"
          secondary
          busy={busy}
          onClick={() => void submit("google")}
        >
          Continue with Google
        </Button>
        <div className="auth-divider">
          <span>or use email</span>
        </div>
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
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            required
            minLength={mode === "signup" ? 10 : 1}
            maxLength={mode === "signup" ? 72 : 200}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {mode === "signup" && (
          <p className="small">
            Use 10–72 characters with uppercase and lowercase letters, a number
            and a symbol. Confirm your email before signing in.
          </p>
        )}
        <Button type="submit" busy={busy}>
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError("");
            setNotice("");
          }}
        >
          {mode === "login"
            ? "New here? Create an account"
            : "Already have an account? Sign in"}
        </button>
        <div className="auth-help">
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void submit("request_password_reset")}
          >
            Forgot password?
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => void submit("resend_confirmation")}
          >
            Resend confirmation
          </button>
        </div>
        <p className="small">
          Email links must be opened in the same browser that requested them.
        </p>
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
