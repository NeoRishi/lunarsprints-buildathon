import type { AuthError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { AppError } from "@/features/lunarsprints/domain";

const newPassword = z
  .string()
  .min(10)
  .max(72)
  .refine(
    (value) => new TextEncoder().encode(value).length <= 72,
    "This password is too long. Use fewer characters.",
  );

export const authCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("google") }),
  z.object({ action: z.literal("logout") }),
  z.object({
    action: z.literal("login"),
    email: z.email(),
    password: z.string().min(1).max(200),
  }),
  z.object({
    action: z.literal("signup"),
    email: z.email(),
    password: newPassword,
  }),
  z.object({ action: z.literal("resend_confirmation"), email: z.email() }),
  z.object({ action: z.literal("request_password_reset"), email: z.email() }),
  z.object({
    action: z.literal("update_password"),
    password: newPassword,
  }),
]);
export type AuthCommand = z.infer<typeof authCommandSchema>;

export function authError(
  error: AuthError,
  action: AuthCommand["action"],
): never {
  if (error.code === "email_not_confirmed")
    throw new AppError(
      "email_not_confirmed",
      "Your email is not confirmed yet. Use Resend confirmation below.",
      403,
    );
  if (error.code === "email_address_not_authorized")
    throw new AppError(
      "email_delivery_unavailable",
      "The app’s email provider cannot send to this address yet. The workspace owner needs to configure email delivery before confirmation or password-reset emails can arrive.",
      503,
    );
  if (error.code === "over_email_send_rate_limit")
    throw new AppError(
      "email_rate_limited",
      "The provider’s sending limit has been reached. Please wait before requesting another email; repeated attempts will not speed up delivery.",
      429,
    );
  if (error.code === "over_request_rate_limit" || error.status === 429)
    throw new AppError(
      "auth_rate_limited",
      "Too many account requests. Please wait before trying again.",
      429,
    );
  if (error.code === "same_password")
    throw new AppError(
      "invalid_input",
      "Choose a password different from your current password.",
    );
  if (error.code === "weak_password")
    throw new AppError(
      "invalid_input",
      "Use at least 10 characters, including uppercase and lowercase letters, a number and a symbol. Avoid common or previously exposed passwords.",
    );
  if (
    error.code === "reauthentication_needed" ||
    error.code === "reauthentication_not_valid"
  )
    throw new AppError(
      "reauthentication_required",
      "Request a fresh password-reset link and open it in this browser.",
      403,
    );
  if (!error.status || error.status >= 500)
    throw new AppError(
      "auth_unavailable",
      ["signup", "resend_confirmation", "request_password_reset"].includes(
        action,
      )
        ? "The email service could not process this request. No delivery is confirmed. Please try again later or ask the workspace owner to check email delivery."
        : "Sign-in is temporarily unavailable. Please try again later.",
      503,
    );
  throw new AppError(
    "auth_error",
    action === "login"
      ? "Could not sign in with these details. Check your email and password, or use Forgot password below."
      : "This request could not be completed. Please check your details and try again.",
  );
}

export async function executeAuth(
  client: SupabaseClient,
  command: AuthCommand,
  origin: string,
) {
  const callback = new URL("/auth/callback", origin).toString();
  if (command.action === "google") {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback,
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) authError(error, command.action);
    return {
      ok: true,
      redirectUrl: verifiedOAuthUrl(
        data.url,
        process.env.NEXT_PUBLIC_SUPABASE_URL,
      ),
    };
  }
  if (command.action === "logout") {
    const { error } = await client.auth.signOut();
    if (error) authError(error, command.action);
    return { ok: true };
  }
  if (command.action === "update_password") {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user)
      throw new AppError(
        "unauthenticated",
        "Open a valid password-reset link before choosing your new password.",
        401,
      );
    const result = await client.auth.updateUser({ password: command.password });
    if (result.error) authError(result.error, command.action);
    return {
      ok: true,
      message:
        "Your password has been updated. You can continue to your workspace.",
    };
  }
  if (command.action === "resend_confirmation") {
    const { error } = await client.auth.resend({
      type: "signup",
      email: command.email,
      options: { emailRedirectTo: callback },
    });
    if (error) authError(error, command.action);
    return {
      ok: true,
      message:
        "If this address needs confirmation, a new link has been requested. Check your inbox and spam, and open the newest link in this browser. Already confirmed? Sign in or use Forgot password.",
    };
  }
  if (command.action === "request_password_reset") {
    const { error } = await client.auth.resetPasswordForEmail(command.email, {
      redirectTo: callback,
    });
    if (error) authError(error, command.action);
    return {
      ok: true,
      message:
        "If an account can be recovered at this address, a password-reset link has been requested. Check your inbox and spam, then open the newest link in this browser.",
    };
  }
  const result =
    command.action === "signup"
      ? await client.auth.signUp({
          email: command.email,
          password: command.password,
          options: { emailRedirectTo: callback },
        })
      : await client.auth.signInWithPassword({
          email: command.email,
          password: command.password,
        });
  if (result.error) authError(result.error, command.action);
  // Supabase deliberately returns an obfuscated successful signup for an existing
  // confirmed account. A missing session is not evidence that an email was sent.
  // Keep the same response for both cases to preserve account privacy.
  return {
    ok: true,
    needsConfirmation: !result.data.session,
    ...(!result.data.session
      ? {
          message:
            "If this address needs confirmation, a link has been requested. Check your inbox and spam. Already registered? Sign in with your existing password or use Forgot password. No email? Try Resend confirmation.",
        }
      : {}),
  };
}

export function authCallbackPath(redirectType: string | null | undefined) {
  return redirectType === "recovery" ? "/account/reset-password" : "/app";
}

export function verifiedOAuthUrl(
  value: string | null,
  supabaseUrl: string | undefined,
) {
  try {
    const url = new URL(value ?? "");
    if (
      supabaseUrl &&
      url.origin === new URL(supabaseUrl).origin &&
      url.pathname === "/auth/v1/authorize" &&
      url.searchParams.get("provider") === "google"
    )
      return url.toString();
  } catch {
    /* A malformed provider response cannot navigate the browser. */
  }
  throw new AppError(
    "auth_unavailable",
    "Google sign-in could not be started. Please try again.",
    503,
  );
}
