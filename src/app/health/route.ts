import { NextResponse } from "next/server";
import { configured } from "@/lib/supabase/server";
// Public liveness check. It reveals no project identifiers or provider setup.
export async function GET() {
  const ok = configured() && Boolean(process.env.OPENAI_API_KEY);
  return NextResponse.json(
    { ok },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
