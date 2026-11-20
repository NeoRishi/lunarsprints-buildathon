import { describe, expect, it, vi, afterEach } from "vitest";
import type { AuthError, SupabaseClient } from "@supabase/supabase-js";
import {
  authCallbackPath,
  authCommandSchema,
  executeAuth,
  verifiedOAuthUrl,
} from "../src/lib/auth";

const origin = "http://127.0.0.1:3000";
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  const auth = {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    resend: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    signInWithOAuth: vi.fn(),
  };
  return { auth, client: { auth } as unknown as SupabaseClient };
}
describe("Account confirmation and recovery", () => {
  it("starts Google sign-in through the existing provider with the exact app callback and no extra scopes", async () => {
    const { client, auth } = fixture();
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://jhkoxgyxrihsuhpjqkxc.supabase.co",
    );
    const url =
      "https://jhkoxgyxrihsuhpjqkxc.supabase.co/auth/v1/authorize?provider=google";
    auth.signInWithOAuth.mockResolvedValue({ data: { url }, error: null });
    expect(await executeAuth(client, { action: "google" }, origin)).toEqual({
      ok: true,
      redirectUrl: url,
    });
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: origin + "/auth/callback",
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });
  });
  it("rejects unexpected OAuth destinations rather than navigating to arbitrary hosts", () => {
    for (const url of [
      "https://untrusted.example/auth/v1/authorize?provider=google",
      "https://jhkoxgyxrihsuhpjqkxc.supabase.co/unexpected?provider=google",
      "https://jhkoxgyxrihsuhpjqkxc.supabase.co/auth/v1/authorize?provider=github",
      "not a url",
    ])
      expect(() =>
        verifiedOAuthUrl(url, "https://jhkoxgyxrihsuhpjqkxc.supabase.co"),
      ).toThrow("Google sign-in could not be started");
  });
  it("does not mistake an obfuscated duplicate signup for email delivery or reveal account existence", async () => {
    const { client, auth } = fixture();
    auth.signUp.mockResolvedValueOnce({
      data: { user: { identities: [] }, session: null },
      error: null,
    });
    const command = {
      action: "signup",
      email: "synthetic@example.com",
      password: "synthetic-password",
    } as const;
    const existing = await executeAuth(client, command, origin);
    auth.signUp.mockResolvedValueOnce({
      data: { user: { identities: [{ id: "new" }] }, session: null },
      error: null,
    });
    const fresh = await executeAuth(client, command, origin);
    expect(existing).toEqual(fresh);
    expect(existing.message).toContain("Already registered?");
    expect(existing.message).not.toMatch(/email (was|has been) sent/i);
  });
  it("accepts existing shorter passwords for login while enforcing stronger new passwords", () => {
    expect(
      authCommandSchema.safeParse({
        action: "login",
        email: "synthetic@example.com",
        password: "legacy8!",
      }).success,
    ).toBe(true);
    for (const action of ["signup", "update_password"])
      expect(
        authCommandSchema.safeParse({
          action,
          email: "synthetic@example.com",
          password: "short",
        }).success,
      ).toBe(false);
  });
  it("rejects oversized new passwords including multi-byte characters without truncating them", () => {
    for (const action of ["signup", "update_password"]) {
      for (const password of [
        "Aa9!" + "x".repeat(69),
        "Aa9!" + "🌓".repeat(20),
      ])
        expect(
          authCommandSchema.safeParse({
            action,
            email: "synthetic@example.com",
            password,
          }).success,
        ).toBe(false);
      expect(
        authCommandSchema.safeParse({
          action,
          email: "synthetic@example.com",
          password: "Aa9!" + "x".repeat(68),
        }).success,
      ).toBe(true);
    }
  });
  it("signs in without returning session tokens or the password", async () => {
    const { client, auth } = fixture();
    auth.signInWithPassword.mockResolvedValue({
      data: { session: { access_token: "private-token" } },
      error: null,
    });
    const result = await executeAuth(
      client,
      { action: "login", email: "synthetic@example.com", password: "legacy8!" },
      origin,
    );
    expect(result).toEqual({ ok: true, needsConfirmation: false });
    expect(JSON.stringify(result)).not.toMatch(/private-token|legacy8/);
  });
  it("preserves the exact allowlisted callback for resend and password recovery", async () => {
    const { client, auth } = fixture();
    auth.resend.mockResolvedValue({ error: null });
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    await executeAuth(
      client,
      { action: "resend_confirmation", email: "synthetic@example.com" },
      origin,
    );
    await executeAuth(
      client,
      { action: "request_password_reset", email: "synthetic@example.com" },
      origin,
    );
    expect(auth.resend).toHaveBeenCalledWith({
      type: "signup",
      email: "synthetic@example.com",
      options: { emailRedirectTo: origin + "/auth/callback" },
    });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "synthetic@example.com",
      { redirectTo: origin + "/auth/callback" },
    );
  });
  it("reports default-mailer recipient restrictions instead of promising an email", async () => {
    const { client, auth } = fixture();
    auth.resend.mockResolvedValue({
      error: {
        code: "email_address_not_authorized",
        status: 403,
        message: "private upstream details",
      } as AuthError,
    });
    await expect(
      executeAuth(
        client,
        { action: "resend_confirmation", email: "synthetic@example.com" },
        origin,
      ),
    ).rejects.toMatchObject({
      code: "email_delivery_unavailable",
      status: 503,
    });
  });
  it("preserves provider sending limits and indicates they cannot be fixed by repeated requests", async () => {
    const { client, auth } = fixture();
    auth.resetPasswordForEmail.mockResolvedValue({
      error: { code: "over_email_send_rate_limit", status: 429 } as AuthError,
    });
    await expect(
      executeAuth(
        client,
        { action: "request_password_reset", email: "synthetic@example.com" },
        origin,
      ),
    ).rejects.toMatchObject({ code: "email_rate_limited", status: 429 });
  });
  it("returns a specific recovery action for an unconfirmed login", async () => {
    const { client, auth } = fixture();
    auth.signInWithPassword.mockResolvedValue({
      error: { code: "email_not_confirmed", status: 400 } as AuthError,
    });
    await expect(
      executeAuth(
        client,
        {
          action: "login",
          email: "synthetic@example.com",
          password: "synthetic-password",
        },
        origin,
      ),
    ).rejects.toMatchObject({ code: "email_not_confirmed", status: 403 });
  });
  it("does not mislabel sign-in throttling as a failed email delivery", async () => {
    const { client, auth } = fixture();
    auth.signInWithPassword.mockResolvedValue({
      error: { code: "over_request_rate_limit", status: 429 } as AuthError,
    });
    await expect(
      executeAuth(
        client,
        {
          action: "login",
          email: "synthetic@example.com",
          password: "synthetic-password",
        },
        origin,
      ),
    ).rejects.toMatchObject({ code: "auth_rate_limited", status: 429 });
  });
  it("cannot update a password without a verified session", async () => {
    const { client, auth } = fixture();
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(
      executeAuth(
        client,
        { action: "update_password", password: "new-synthetic-password" },
        origin,
      ),
    ).rejects.toMatchObject({ code: "unauthenticated", status: 401 });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("updates only the authenticated user's password through the regular client", async () => {
    const { client, auth } = fixture();
    auth.getUser.mockResolvedValue({
      data: { user: { id: "synthetic-user" } },
      error: null,
    });
    auth.updateUser.mockResolvedValue({ error: null });
    await executeAuth(
      client,
      { action: "update_password", password: "new-synthetic-password" },
      origin,
    );
    expect(auth.updateUser).toHaveBeenCalledWith({
      password: "new-synthetic-password",
    });
  });
  it("routes PKCE recovery to the password form without accepting an arbitrary redirect", () => {
    expect(authCallbackPath("recovery")).toBe("/account/reset-password");
    expect(authCallbackPath(null)).toBe("/app");
    expect(authCallbackPath("https://untrusted.example")).toBe("/app");
  });
});
