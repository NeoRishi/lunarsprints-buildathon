import { describe, expect, it } from "vitest";
import {
  authErrorMessage,
  sessionRequestSchema,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from "../src/lib/auth";

describe("sign-in helpers", () => {
  it("does not reveal whether an account exists on a failed sign-in", () => {
    const messages = new Set(
      [
        "auth/invalid-credential",
        "auth/wrong-password",
        "auth/user-not-found",
      ].map(authErrorMessage),
    );
    expect(messages.size).toBe(1);
    expect([...messages][0]).toContain("Check your email and password");
  });
  it("never says an email already has an account when signing up", () => {
    expect(authErrorMessage("auth/email-already-in-use")).toBe(
      "If this email can be used, we've sent you the next step.",
    );
  });
  it("gives a plain message for every code, including unknown ones", () => {
    for (const code of [
      "auth/too-many-requests",
      "auth/network-request-failed",
      "auth/expired-action-code",
      "auth/something-new",
      undefined,
    ]) {
      const message = authErrorMessage(code);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/auth\/|firebase|magic link/i);
    }
  });
  it("accepts only a token-shaped body for session creation", () => {
    expect(
      sessionRequestSchema.safeParse({ idToken: "x".repeat(40) }).success,
    ).toBe(true);
    expect(sessionRequestSchema.safeParse({}).success).toBe(false);
    expect(sessionRequestSchema.safeParse({ idToken: "" }).success).toBe(false);
    expect(
      sessionRequestSchema.safeParse({ idToken: "x".repeat(9000) }).success,
    ).toBe(false);
  });
  it("keeps sessions to five days in the __session cookie", () => {
    expect(SESSION_COOKIE).toBe("__session");
    expect(SESSION_MAX_AGE_SECONDS).toBe(432000);
  });
});
