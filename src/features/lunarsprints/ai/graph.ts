import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { UsageMetadata } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { AppError } from "../domain";
import { AI_FAILURE_MESSAGE } from "../agents/contract";

/** The part of a chat model the graph needs. Tests pass a stand-in. */
export type StructuredModel = Pick<BaseChatModel, "withStructuredOutput">;

const AgentState = Annotation.Root({
  system: Annotation<string>,
  input: Annotation<string>,
  answer: Annotation<unknown>,
  payload: Annotation<unknown>,
  usage: Annotation<UsageMetadata | null>,
  outputCharacters: Annotation<number>,
});

/**
 * One agent as a two-step graph:
 * 1. propose: the model answers in the agent's JSON schema.
 * 2. check: the answer passes the same contract checks as the saved agents.
 * The graph only proposes. It never writes, approves or schedules anything.
 */
export function buildAgentGraph(options: {
  name: string;
  model: StructuredModel;
  jsonSchema: Record<string, unknown>;
  accept: (answer: unknown) => unknown;
}) {
  const structured = options.model.withStructuredOutput(options.jsonSchema, {
    name: options.name,
    includeRaw: true,
  });
  return new StateGraph(AgentState)
    .addNode("propose", async (state, config) => {
      const result = await structured.invoke(
        [new SystemMessage(state.system), new HumanMessage(state.input)],
        { signal: config.signal },
      );
      if (result.parsed === null || result.parsed === undefined)
        throw new AppError("invalid_model_output", AI_FAILURE_MESSAGE, 502);
      const raw = result.raw as { usage_metadata?: UsageMetadata };
      return {
        answer: result.parsed,
        usage: raw.usage_metadata ?? null,
        outputCharacters: JSON.stringify(result.parsed).length,
      };
    })
    .addNode("check", (state) => ({ payload: options.accept(state.answer) }))
    .addEdge(START, "propose")
    .addEdge("propose", "check")
    .addEdge("check", END)
    .compile();
}
