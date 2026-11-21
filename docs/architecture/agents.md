# LunarSprints agents (Step 3, Run 1)

The web app owns every decision. The agent service only proposes. Each proposal is checked twice (Pydantic in the service, then the zod contract and the coordinator's own rules in the app) before anything is saved, and only the person can approve it.

## Planning flow

```mermaid
flowchart TD
    U([Person]) -->|writes an intention| APP

    subgraph APP[Next.js app: coordinator]
        direction TB
        A1[assess] --> SEL{one intention?}
        SEL -- no --> PICK[[Person picks intentions]]
        SEL -- yes --> C1
        PICK --> C1[clarify]
        C1 --> ANS[[Person answers questions]]
        ANS --> G1[goals]
        G1 --> AG[[Person edits or approves the goal]]
        AG --> R1[readiness]
        R1 -->|scope is clear| S1[stories]
        R1 -->|scope missing| Q[[Person answers one question]]
        Q --> G1
        S1 --> AS[[Person edits or approves milestones and steps]]
        AS --> SCH[Deterministic schedule: planSchedule]
        SCH --> N1[schedule_notes]
        N1 --> AP[[Person approves the schedule]]
        AP --> ACT[[Person starts the sprint]]
    end

    subgraph SVC[Agent service: Python, Google ADK]
        direction TB
        IA[intent_alignment.assess]
        SGc[smart_goal.clarify]
        SGg[smart_goal.goals]
        SGr[smart_goal.readiness]
        SD[story_decomposer.stories]
        SC[scheduling.schedule_notes]
    end

    A1 -. POST /v1/roles/intent_alignment .-> IA
    C1 -. POST /v1/roles/smart_goal .-> SGc
    G1 -. POST /v1/roles/smart_goal .-> SGg
    R1 -. POST /v1/roles/smart_goal .-> SGr
    S1 -. POST /v1/roles/story_decomposer .-> SD
    N1 -. POST /v1/roles/scheduling .-> SC

    SVC -->|Gemini, one call, no retry, 45 s limit| GEM[(Gemini)]
    APP -->|save only after checks and approval| DB[(PostgreSQL, RLS on every ls_ table)]
    APP -->|role, model, latency, tokens, outcome| RUNS[(ls_agent_runs)]
```

Double brackets mark a checkpoint where the person decides. Nothing after a checkpoint runs until the person acts.

## One call, end to end

```mermaid
sequenceDiagram
    participant C as Coordinator (TypeScript)
    participant E as GeminiAgentsIntelligence
    participant S as Agent service (FastAPI)
    participant A as ADK LlmAgent
    participant G as Gemini

    C->>E: invoke(role, stage schema, planning data)
    E->>E: pick the task from the schema, drop fields the role does not need
    E->>S: POST /v1/roles/{role} with X-Service-Token and a random requestId
    S->>S: check the token (constant time) and the request schema
    S->>A: run once in a fresh in-memory session
    A->>G: instructions plus planning data, response schema
    G-->>A: JSON answer
    A-->>S: answer
    S->>S: check the answer against the strict Pydantic model
    S-->>E: { result, usage }
    E->>E: check the answer with the zod contract
    E-->>C: proposal, a follow-up question, or a plain error
    C->>C: run the coordinator's own checks, then save or keep the old plan
```

## Calls kept separate (no SequentialAgent yet)

| Back-to-back calls with no person in between | Decision | Why |
|---|---|---|
| intent_alignment.assess, then smart_goal.clarify (when there is one intention) | Separate | The app checks the intention ids are unique and decides whether the person must pick intentions first. |
| smart_goal.readiness, then story_decomposer.stories | Separate | The app checks the readiness answer first. If scope is missing it stops and asks the person, so no tokens are spent on steps that would be thrown away. |

A SequentialAgent would put both calls in one service request and skip the app's check between them. If a later run needs fewer round trips, the steps agent must be told to stop when readiness says scope is missing, and the app must still check both answers in order before saving.

## Roles not connected yet

daily_execution, adaptive_backlog and reflection return "AI suggestions are being upgraded. Your saved plan is safe." until Run 2. orchestrator and capacity are never called; rhythm is disabled.
