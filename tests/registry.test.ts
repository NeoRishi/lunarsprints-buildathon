import { describe, expect, it } from "vitest";
import registry from "../config/agent-registry.json";
import {
  instructionsAllowed,
  instructionsHash,
  type RegistryEntry,
} from "../src/features/lunarsprints/agents/registry-check";

const entries = registry as unknown as Record<string, RegistryEntry>;
const fixed = (hash: string): RegistryEntry => ({ instructionsSha256: hash });

describe("saved-agent instruction hash check", () => {
  const text = "saved instructions";
  const hash = instructionsHash(text);
  it("accepts only the registered hash when no transition is listed", () => {
    expect(instructionsAllowed(fixed(hash), text)).toBe(true);
    expect(instructionsAllowed(fixed(hash), text + " edited")).toBe(false);
    expect(instructionsAllowed(fixed(instructionsHash("")), null)).toBe(true);
  });
  it("accepts either listed hash during a transition, and nothing else", () => {
    const next = "saved instructions, revised";
    const entry: RegistryEntry = {
      instructionsSha256: hash,
      acceptedInstructionsSha256: [hash, instructionsHash(next)],
    };
    expect(instructionsAllowed(entry, text)).toBe(true);
    expect(instructionsAllowed(entry, next)).toBe(true);
    expect(instructionsAllowed(entry, "something else")).toBe(false);
  });
});

describe("agent registry", () => {
  it("has no transitional hash lists left", () => {
    for (const entry of Object.values(entries))
      expect(entry.acceptedInstructionsSha256).toBeUndefined();
  });
  it("pins Agent 05 to its revised instructions", () => {
    expect(entries.story_decomposer.instructionsSha256).toBe(
      "6eb8815ed6852abdcf9fb9a548bda86c9cbbec0c5451429080afb6abecd24357",
    );
  });
});
