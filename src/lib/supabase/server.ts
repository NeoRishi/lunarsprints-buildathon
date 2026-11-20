import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { AppError } from "@/features/lunarsprints/domain";

export function configured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SECRET_KEY,
  );
}
export async function serverClient() {
  if (!configured())
    throw new AppError(
      "database_unavailable",
      "The Supabase development database is not connected yet. Your input has not been submitted.",
      503,
    );
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (values) => {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
            }),
          );
        },
      },
    },
  );
}
export function adminClient() {
  if (!configured())
    throw new AppError(
      "database_unavailable",
      "The Supabase development database is not connected yet.",
      503,
    );
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function authenticated() {
  const client = await serverClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw new AppError(
      "unauthenticated",
      "Sign in to save and plan your sprint.",
      401,
    );
  return { client, user: data.user };
}
