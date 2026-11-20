import { NextResponse } from "next/server";
import { configured, serverClient } from "@/lib/supabase/server";
import { failure, sameOrigin, jsonBody, requestOrigin } from "@/lib/http";
import { authCommandSchema, executeAuth } from "@/lib/auth";
export async function GET() {
  try {
    if (!configured())
      return NextResponse.json({ configured: false, user: null });
    const client = await serverClient();
    const { data } = await client.auth.getUser();
    return NextResponse.json(
      {
        configured: true,
        user: data.user ? { id: data.user.id, email: data.user.email } : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const data = authCommandSchema.parse(await jsonBody(request));
    const client = await serverClient();
    return NextResponse.json(
      await executeAuth(client, data, requestOrigin(request)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
