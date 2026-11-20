import { NextResponse } from "next/server";
import { withoutUser } from "@/lib/db";
import { firebaseAdminConfigured } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public liveness check. It reveals no project identifiers or provider setup:
// only whether the database answers (as ls_app) and sign-in is configured.
export async function GET() {
  let database = false;
  try {
    database = await withoutUser(async (db) => {
      const { rows } = await db.query<{ ok: number }>("select 1 as ok");
      return rows[0]?.ok === 1;
    });
  } catch {
    database = false;
  }
  const signIn =
    firebaseAdminConfigured() &&
    Boolean(
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY &&
        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN &&
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
        process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    );
  const ok = database && signIn;
  return NextResponse.json(
    { ok, database, signIn },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
