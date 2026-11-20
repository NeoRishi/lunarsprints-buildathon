# Moving the agents to LangGraph

This note tracks the move from the 10 saved OpenAI agents to LangGraph, in plain language first.

## The idea

Today every AI call goes through one interface, `Intelligence`. The saved OpenAI agents implement it (`agents/managed.ts`). The LangGraph engine (`ai/`) implements the same interface, builds the same output schema, and accepts answers through the same checks (`agents/contract.ts`). The coordinator, the database and the screens cannot tell which engine answered.

The saved agents stay live and untouched until the new engine is proven. The owner retires them.

## Decisions

| Question | Decision |
|---|---|
| Where it runs | LangGraph.js inside the Next.js app on Vercel. The longest call is 180 seconds; routes allow 300. |
| Models | LangChain wrappers. OpenAI today (same models per role as the saved agents), Anthropic by config. |
| State and checkpoints | The shared LifeOS Supabase, new additive `ls_` tables with row level security (added with the API). |
| API auth | Supabase JWT first, hashed API keys in a later PR. |
| URLs | `/api/v1/agents/{role}/runs`, `/api/v1/workflows/{name}/runs`, `/api/v1/runs/{id}`, `/api/v1/runs/{id}/resume`, `/api/v1/openapi.json` |
| Agent instructions | Ported from the summaries in `agents/prompts/` plus `agents/policies.ts`. The full saved text was not exported, so behaviour may differ from the live agents; the side-by-side comparison measures how much. |

## Settings

| Variable | Values | Default |
|---|---|---|
| `AI_ENGINE` | `saved_agents`, `langgraph`, `shadow` | `saved_agents` |
| `AI_PROVIDER` | `openai`, `anthropic` | `openai` |
| `AI_MODEL` | any model name, for every role | the saved agent's model per role (OpenAI only) |
| `AI_MODEL_<ROLE>` | a model for one role, for example `AI_MODEL_STORY_DECOMPOSER` | unset |
| `ANTHROPIC_API_KEY` | only when `AI_PROVIDER=anthropic` | unset |

* **`shadow`** gives users the saved agents' answers and runs the LangGraph engine alongside, after the response, for comparison. Shadow runs are stored in `ls_agent_runs` with `metrics.shadow = true` and are never shown to users. It doubles AI cost while it is on.
* **`langgraph`** serves users from the new engine. Do not turn it on until every role the app calls is ported: an unported role fails with `agent_not_ported` instead of falling back silently.
* **LangSmith tracing must stay off.** It would send prompts and user text to a third party. The new engine refuses to run if `LANGSMITH_TRACING`, `LANGSMITH_TRACING_V2`, `LANGCHAIN_TRACING` or `LANGCHAIN_TRACING_V2` is `true`.

## Phases

1. Scaffold: packages, settings, model factory, graph, engine, shadow mode. No user-visible change. (This PR.)
2. Agents, group A: smart_goal, intent_alignment.
3. Agents, group B: story_decomposer, scheduling, adaptive_backlog.
4. Agents, group C: daily_execution, reflection; orchestrator, capacity and rhythm ported but off.
5. The `/api/v1` API: auth, rate limits, request IDs, structured errors, OpenAPI spec, migration.
6. Side-by-side comparison on synthetic 3, 15 and 45 day sprints.
7. Switch the default engine.
