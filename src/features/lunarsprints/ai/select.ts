import type { z } from "zod";
import type { Role } from "../contracts";
import {
  ManagedIntelligence,
  type AgentContext,
  type Intelligence,
} from "../agents/managed";
import { aiEngine, type Env } from "./config";
import { LangGraphIntelligence } from "./intelligence";

/**
 * Shadow mode: the user always gets the saved agents' answer. The LangGraph
 * engine runs the same call alongside, and its run is recorded with
 * `shadow: true` for comparison only. Its answer is never shown or stored as
 * plan data, and its errors never reach the user.
 *
 * Shadow mode doubles AI cost for every call while it is on.
 */
export class ShadowIntelligence implements Intelligence {
  private pending: Promise<unknown>[] = [];
  constructor(
    private primary: Intelligence,
    private shadow: Intelligence,
  ) {}
  invoke<T extends z.ZodType>(
    role: Role,
    schema: T,
    data: unknown,
    instructions?: string,
  ): Promise<z.infer<T>> {
    // A shadow failure is not lost: the shadow engine records it as an error
    // run (with its code) before rejecting. It must never reach the user.
    this.pending.push(
      this.shadow.invoke(role, schema, data, instructions).catch(() => null),
    );
    return this.primary.invoke(role, schema, data, instructions);
  }
  /** Waits for comparison runs. Call it after the response is sent. */
  async settle() {
    const pending = this.pending;
    this.pending = [];
    await Promise.allSettled(pending);
  }
}

/** Picks the AI engine from AI_ENGINE. The default is the saved agents. */
export function createIntelligence(
  context: AgentContext,
  env: Env = process.env,
): { ai: Intelligence; settle: () => Promise<void> } {
  const engine = aiEngine(env);
  if (engine === "langgraph")
    return {
      ai: new LangGraphIntelligence(context, { env }),
      settle: async () => {},
    };
  if (engine === "shadow") {
    const shadow = new ShadowIntelligence(
      new ManagedIntelligence(context),
      new LangGraphIntelligence({ ...context, shadow: true }, { env }),
    );
    return { ai: shadow, settle: () => shadow.settle() };
  }
  return { ai: new ManagedIntelligence(context), settle: async () => {} };
}
