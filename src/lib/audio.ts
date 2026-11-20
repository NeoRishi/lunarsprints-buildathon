/**
 * True when the bytes start like a WebM, WAV, Ogg or MP4 recording. Checks the
 * file's own header, not the type the browser claims. Kept for the voice
 * feature that returns in a later step.
 */
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
