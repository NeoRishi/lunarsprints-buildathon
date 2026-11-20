import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { requestOrigin } from "@/lib/http";
import { authCallbackPath } from "@/lib/auth";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const client = await serverClient();
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    const redirectType =
      "redirectType" in data && typeof data.redirectType === "string"
        ? data.redirectType
        : null;
    if (!error)
      return NextResponse.redirect(
        new URL(authCallbackPath(redirectType), requestOrigin(request)),
      );
  }
  return NextResponse.redirect(
    new URL("/app?auth_error=confirmation_failed", requestOrigin(request)),
  );
}
