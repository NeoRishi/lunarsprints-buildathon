"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import { Button } from "./shared";
export function VoiceInput({
  onTranscript,
  disabled,
}: {
  onTranscript: (t: string) => void;
  disabled: boolean;
}) {
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const started = useRef(0);
  const cancelled = useRef(false);
  const stopTracks = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    if (timer.current) clearTimeout(timer.current);
  };
  useEffect(
    () => () => {
      cancelled.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      stopTracks();
    },
    [],
  );
  async function start() {
    setError("");
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "This browser cannot record audio. Type your intention below.",
        );
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      cancelled.current = false;
      chunks.current = [];
      const type = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      recorder.current = new MediaRecorder(
        stream.current,
        type ? { mimeType: type } : undefined,
      );
      recorder.current.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      recorder.current.onstop = async () => {
        const duration = Math.max(0.1, (Date.now() - started.current) / 1000);
        stopTracks();
        setRecording(false);
        if (cancelled.current) return;
        setLoading(true);
        try {
          const mime = recorder.current?.mimeType ?? "audio/webm";
          const blob = new Blob(chunks.current, { type: mime });
          const form = new FormData();
          form.append(
            "audio",
            blob,
            mime.includes("mp4")
              ? "intention.mp4"
              : mime.includes("ogg")
                ? "intention.ogg"
                : "intention.webm",
          );
          form.append("consent", "true");
          form.append("duration", String(duration));
          const response = await fetch("/api/voice/transcribe", {
            method: "POST",
            body: form,
          });
          const body = await response.json();
          if (!response.ok)
            throw new Error(
              body.error?.message ??
                "Recording could not be transcribed. Try again or type your intention.",
            );
          onTranscript(body.transcript);
        } catch (e) {
          setError(
            e instanceof Error
              ? e.message
              : "Transcription failed. You can type below.",
          );
        } finally {
          setLoading(false);
          chunks.current = [];
        }
      };
      started.current = Date.now();
      recorder.current.start();
      setRecording(true);
      timer.current = setTimeout(
        () =>
          recorder.current?.state === "recording" && recorder.current.stop(),
        90000,
      );
    } catch (e) {
      stopTracks();
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone permission was denied. You can type your intention below."
          : e instanceof Error
            ? e.message
            : "Microphone unavailable. You can type below.",
      );
    }
  }
  return (
    <div className="voice-composer">
      <div className="voice-control">
        <Button
          secondary
          disabled={disabled || !consent || loading}
          onClick={() => (recording ? recorder.current?.stop() : void start())}
          busy={loading}
        >
          {recording ? <Square size={18} /> : <Mic size={18} />}{" "}
          {loading
            ? "Transcribing…"
            : recording
              ? "Stop & transcribe"
              : "Speak your intention"}
        </Button>
        {recording && (
          <>
            <span role="status" className="recording">
              Recording, up to 90 seconds
            </span>
            <button
              className="text-button"
              onClick={() => {
                cancelled.current = true;
                recorder.current?.stop();
              }}
            >
              <X size={14} /> Cancel
            </button>
          </>
        )}
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={consent}
          disabled={recording || loading}
          onChange={(e) => setConsent(e.target.checked)}
        />{" "}
        I agree to send this recording to OpenAI for transcription. LunarSprints
        does not retain the audio.
      </label>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
