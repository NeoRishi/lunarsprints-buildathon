import type { Role } from "../contracts";

/** What the LangGraph engine needs to run one agent. */
export type AgentDefinition = {
  /** The agent's instructions, in place of the saved OpenAI agent's text. */
  instructions: string;
};

/**
 * Agents available in the LangGraph engine. Empty in the scaffold: roles are
 * added in small groups, each ported from `agents/prompts/` and
 * `agents/policies.ts`. A role that is not listed fails with
 * `agent_not_ported` instead of falling back silently.
 */
export const agentDefinitions: Partial<Record<Role, AgentDefinition>> = {};
