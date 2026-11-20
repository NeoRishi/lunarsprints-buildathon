import { createHash } from "node:crypto";

export type RegistryEntry = {
  instructionsSha256: string;
  /**
   * Transitional only. While a saved agent's instructions are being edited,
   * the registry may list both the current and the replacement hash so there
   * is no window where live calls fail. Remove it once the edit is confirmed.
   */
  acceptedInstructionsSha256?: string[];
};

export function instructionsHash(instructions: string | null | undefined) {
  return createHash("sha256")
    .update(instructions ?? "")
    .digest("hex");
}

/** True when the live saved instructions match a hash the registry allows. */
export function instructionsAllowed(
  entry: RegistryEntry,
  instructions: string | null | undefined,
) {
  const allowed = entry.acceptedInstructionsSha256?.length
    ? entry.acceptedInstructionsSha256
    : [entry.instructionsSha256];
  return allowed.includes(instructionsHash(instructions));
}
