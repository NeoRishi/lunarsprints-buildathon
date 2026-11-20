"use client";
import { useEffect, useState } from "react";
import { Moon } from "lucide-react";
import Link from "next/link";
import { Button, Notice } from "./shared";

export function ResetPassword() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetch("/api/auth")
      .then(async (r) => {
        const result = await r.json();
        if (alive) setReady(r.ok && Boolean(result.user));
      })
      .catch(() => {
        if (alive) setReady(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_password", password }),
      });
      const result = await r.json();
      if (!r.ok)
        throw new Error(
          result.error?.message ?? "Your password could not be updated.",
        );
      setPassword("");
      setConfirm("");
      setDone(true);
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
    <main className="workspace reset-page">
      <Link className="brand" href="/">
        <span className="brand-mark">
          <Moon size={21} fill="currentColor" />
        </span>
        LunarSprints
      </Link>
      <section className="panel reset-panel">
        <h1>{done ? "Your password is updated." : "Choose a new password."}</h1>
        {ready === null ? (
          <p role="status">Checking your recovery link…</p>
        ) : done ? (
          <p>You can continue to your saved sprints.</p>
        ) : !ready ? (
          <Notice warning>
            This recovery link is missing or expired. Return to sign-in and use
            Forgot password to request a new link, then open it in the same
            browser.
          </Notice>
        ) : (
          <>
            <p>
              Use 10–72 characters with uppercase and lowercase letters, a
              number and a symbol. Choose a password you haven’t used before.
            </p>
            <form onSubmit={save} aria-busy={busy}>
              <label>
                New password
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={72}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={72}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
              <Button type="submit" busy={busy}>
                Update password
              </Button>
              {error && (
                <div role="alert">
                  <Notice warning>{error}</Notice>
                </div>
              )}
            </form>
          </>
        )}
        <Link href="/app">
          {done ? "Continue to workspace" : "Back to sign-in"}
        </Link>
      </section>
    </main>
  );
}
