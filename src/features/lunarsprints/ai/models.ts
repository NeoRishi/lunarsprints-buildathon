import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { assert } from "../domain";
import type { Env, ModelChoice } from "./config";

/**
 * Builds the LangChain chat model for one call. No retries: a failed call is
 * reported, never silently repeated. Switching provider is a config change.
 */
export function createChatModel(
  choice: ModelChoice,
  timeoutMs: number,
  env: Env = process.env,
): BaseChatModel {
  if (choice.provider === "anthropic") {
    assert(
      env.ANTHROPIC_API_KEY,
      "Anthropic is not configured.",
      "provider_unavailable",
      503,
    );
    return new ChatAnthropic({
      model: choice.model,
      apiKey: env.ANTHROPIC_API_KEY,
      maxRetries: 0,
      clientOptions: { timeout: timeoutMs },
    });
  }
  assert(
    env.OPENAI_API_KEY,
    "OpenAI is not configured.",
    "provider_unavailable",
    503,
  );
  return new ChatOpenAI({
    model: choice.model,
    apiKey: env.OPENAI_API_KEY,
    configuration: {
      project: env.OPENAI_PROJECT_ID || "proj_vI5AtNhbZISblXntDQZHNhZ1",
    },
    // Same effort the saved agents run with in this app's sessions.
    reasoning: { effort: "low" },
    maxRetries: 0,
    timeout: timeoutMs,
  });
}
