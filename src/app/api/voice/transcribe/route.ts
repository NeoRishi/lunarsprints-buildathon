import OpenAI from "openai";
import { NextResponse } from "next/server";
import { authenticated } from "@/lib/supabase/server";
import { failure, limitedBody, sameOrigin } from "@/lib/http";
import { AppError } from "@/features/lunarsprints/domain";
import { rateLimit } from "@/features/lunarsprints/store";
export const runtime = "nodejs";
export const maxDuration = 120;
export function audioSignature(bytes: Uint8Array) {
  return (
    (bytes[0] === 0x1a &&
      bytes[1] === 0x45 &&
      bytes[2] === 0xdf &&
      bytes[3] === 0xa3) ||
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" ||
    String.fromCharCode(...bytes.slice(0, 4)) === "OggS" ||
    String.fromCharCode(...bytes.slice(4, 8)) === "ftyp"
  );
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { user } = await authenticated();
    await rateLimit(user.id, "voice", 20, 3600);
    if (Number(request.headers.get("content-length") ?? 0) > 11 * 1024 * 1024)
      throw new AppError(
        "invalid_audio",
        "Recording exceeds the 10 MB limit.",
        413,
      );
    const body = await limitedBody(request, 11 * 1024 * 1024);
    const form = await new Response(body, {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
    const file = form.get("audio");
    if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024)
      throw new AppError("invalid_audio", "Send a recording up to 10 MB.");
    if (form.get("consent") !== "true")
      throw new AppError(
        "missing_consent",
        "Confirm permission to transcribe this recording.",
      );
    const duration = Number(form.get("duration"));
    if (!Number.isFinite(duration) || duration <= 0 || duration > 95)
      throw new AppError("invalid_audio", "Record up to 90 seconds.");
    const allowed = [
      "audio/webm",
      "video/webm",
      "audio/mp4",
      "audio/ogg",
      "audio/wav",
      "audio/x-wav",
    ];
    if (!allowed.includes(file.type.split(";")[0]))
      throw new AppError(
        "invalid_audio",
        "Use a supported WebM, MP4, Ogg or WAV recording.",
      );
    const buffer = new Uint8Array(await file.arrayBuffer());
    if (!audioSignature(buffer))
      throw new AppError(
        "invalid_audio",
        "This file does not contain a supported recording.",
      );
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 0,
      timeout: 60000,
    });
    let transcript;
    try {
      transcript = await client.audio.transcriptions.create(
        { model: "gpt-4o-mini-transcribe", file, response_format: "json" },
        { signal: AbortSignal.timeout(60000) },
      );
    } catch {
      throw new AppError(
        "transcription_unavailable",
        "Recording could not be transcribed. Try again or type your intention.",
        502,
      );
    }
    // Audio is handled in memory only and is not written to application storage.
    return NextResponse.json(
      { transcript: transcript.text },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
