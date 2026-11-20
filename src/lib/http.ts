import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/features/lunarsprints/domain";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(\b(?:cookie|set-cookie|authorization)\s*:\s*)[^\r\n]+/gi, "$1[REDACTED]"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
  [
    /\b(sk-[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]{8,}|sb_publishable_[A-Za-z0-9_-]{8,}|re_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
    "[REDACTED_KEY]",
  ],
  [
    /((?:cookie|set-cookie|authorization|x-api-key|apikey|password|secret)\s*[:=]\s*)[^\r\n;,&"']+/gi,
    "$1[REDACTED]",
  ],
];

export function redactSensitive(input: string): string {
  let out = input;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export function failure(error: unknown) {
  if (error instanceof AppError)
    return NextResponse.json(
      { error: { code: error.code, message: redactSensitive(error.message) } },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  if (error instanceof z.ZodError)
    return NextResponse.json(
      {
        error: {
          code: "invalid_input",
          message: redactSensitive(
            error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .slice(0, 5)
              .join("; "),
          ),
        },
      },
      { status: 400 },
    );
  // Never log provider error payloads, credentials, transcripts or raw prompts.
  console.error("LunarSprints request failed", {
    type: error instanceof Error ? error.name : "unknown",
  });
  return NextResponse.json(
    {
      error: {
        code: "internal_error",
        message:
          "The request could not be saved. Your last committed plan is safe. Try again.",
      },
    },
    { status: 500 },
  );
}
export function requestOrigin(request: Request) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN;
  // Never trust the Host header in production: it builds sign-in and reset
  // links and anchors the cross-site write check. Every deployment must set
  // APP_ORIGIN.
  if (process.env.NODE_ENV === "production")
    throw new AppError(
      "configuration_error",
      "This deployment is missing its public address. Please try again later.",
      503,
    );
  // Local development: Next may normalize request.url to localhost, so the
  // Host header is the browser's actual target.
  const url = new URL(request.url);
  return `${url.protocol}//${request.headers.get("host") ?? url.host}`;
}
/** Rejects state-changing requests that do not come from this site's pages. */
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const target = requestOrigin(request);
  if (origin) {
    if (origin !== target)
      throw new AppError(
        "forbidden",
        "Cross-origin writes are not allowed.",
        403,
      );
    return;
  }
  // Browsers send Origin on every fetch POST/DELETE. Without it, accept only an
  // explicit same-origin fetch marker; reject anything else.
  if (request.headers.get("sec-fetch-site") !== "same-origin")
    throw new AppError(
      "forbidden",
      "Cross-origin writes are not allowed.",
      403,
    );
}
export async function limitedBody(request: Request, maximum: number) {
  if (Number(request.headers.get("content-length") ?? 0) > maximum)
    throw new AppError("invalid_input", "The request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new AppError("invalid_input", "The request is too large.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
export async function jsonBody(request: Request) {
  const body = new TextDecoder().decode(await limitedBody(request, 500000));
  try {
    return JSON.parse(body);
  } catch {
    throw new AppError("invalid_input", "Send a valid JSON request.");
  }
}
