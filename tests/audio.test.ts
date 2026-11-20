import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { audioSignature } from "../src/lib/audio";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);

describe("audioSignature", () => {
  it("accepts the WAV test recording", async () => {
    const wav = new Uint8Array(
      await readFile(new URL("./fixtures/intention.wav", import.meta.url)),
    );
    expect(audioSignature(wav)).toBe(true);
  });
  it("accepts WebM, Ogg and MP4 headers", () => {
    expect(audioSignature(bytes(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0))).toBe(
      true,
    );
    expect(audioSignature(ascii("OggS\0\0\0\0"))).toBe(true);
    expect(audioSignature(ascii("\0\0\0\x20ftypM4A "))).toBe(true);
  });
  it("rejects text and empty files that claim to be audio", () => {
    expect(audioSignature(ascii("hello world"))).toBe(false);
    expect(audioSignature(new Uint8Array(0))).toBe(false);
  });
});
