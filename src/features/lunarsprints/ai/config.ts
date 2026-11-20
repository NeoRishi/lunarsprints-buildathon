import type { Role } from "../contracts";
import { AppError } from "../domain";
import { openAIModelFor } from "../agents/contract";

/**
 * AI settings, read from environment variables. Nothing here is secret: keys
 * are read only by the model factory and never logged.
 *
 * AI_ENGINE    saved_agents (default) | langgraph | shadow
 * AI_PROVIDER  openai (default) | anthropic
 * AI_MODEL     optional model for every role
 * AI_MODEL_<ROLE>  optional model for one role, for example AI_MODEL_STORY_DECOMPOSER
 */
export type Env = Record<string, string | undefined>;

export const engines = ["saved_agents", "langgraph", "shadow"] as const;
export type Engine = (typeof engines)[number];
export const providers = ["openai", "anthropic"] as const;
export type Provider = (typeof providers)[number];
export type ModelChoice = { provider: Provider; model: string };

/** LangSmith reads these. Tracing would send prompts and user text to a third party. */
const TRACING_VARIABLES = [
  "LANGSMITH_TRACING_V2",
  "LANGCHAIN_TRACING_V2",
  "LANGSMITH_TRACING",
  "LANGCHAIN_TRACING",
];

function misconfigured(setting: string): never {
  throw new AppError(
    "ai_misconfigured",
    `The AI setting ${setting} is not valid. Your saved plan is safe.`,
    503,
  );
}

export function aiEngine(env: Env = process.env): Engine {
  const value = env.AI_ENGINE || "saved_agents";
  return (engines as readonly string[]).includes(value)
    ? (value as Engine)
    : misconfigured("AI_ENGINE");
}

export function aiProvider(env: Env = process.env): Provider {
  const value = env.AI_PROVIDER || "openai";
  return (providers as readonly string[]).includes(value)
    ? (value as Provider)
    : misconfigured("AI_PROVIDER");
}

/**
 * The model for one role. A role setting beats AI_MODEL. With OpenAI and no
 * override, each role uses the same model as its saved agent does today, so
 * side-by-side comparisons are fair. Anthropic has no default: set AI_MODEL.
 */
export function modelFor(role: Role, env: Env = process.env): ModelChoice {
  const provider = aiProvider(env);
  const override =
    env[`AI_MODEL_${role.toUpperCase()}`] || env.AI_MODEL || undefined;
  if (override) return { provider, model: override };
  if (provider === "openai")
    return { provider, model: openAIModelFor(role, env) };
  return misconfigured("AI_MODEL");
}

/** Refuses to run the LangGraph engine while LangSmith tracing is switched on. */
export function assertNoTracing(env: Env = process.env) {
  const on = TRACING_VARIABLES.filter(
    (name) => env[name]?.trim().toLowerCase() === "true",
  );
  if (on.length) misconfigured(on.join(", "));
}
