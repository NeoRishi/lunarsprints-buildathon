import { reconcileUsage } from "@/features/lunarsprints/agents/usage";
import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { authenticated } from "@/lib/supabase/server";
import { failure, jsonBody, sameOrigin } from "@/lib/http";
import { commandSchema, type Sprint } from "@/features/lunarsprints/contracts";
import { AppError, capacity, sprintDays } from "@/features/lunarsprints/domain";
import {
  assertCanActivate,
  planFor,
  type ActiveSprintSummary,
} from "@/features/lunarsprints/entitlements";
import {
  coordinate,
  hash,
  hashes,
  newSprint,
} from "@/features/lunarsprints/coordinator";
import type { RunRecord } from "@/features/lunarsprints/agents/managed";
import { createIntelligence } from "@/features/lunarsprints/ai/select";
import {
  commit,
  rateLimit,
  recordRuns,
  replay,
} from "@/features/lunarsprints/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const view = (s: Sprint) => ({
  sprint: { ...s, pendingReplan: s.pendingReplan ?? null },
  hashes: hashes(s),
  capacity: capacity(s),
});
export async function GET(request: Request) {
  try {
    const { client, user } = await authenticated();
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const { data, error } = await client
        .from("ls_sprints")
        .select("state")
        .eq("id", id)
        .maybeSingle();
      if (error)
        throw new AppError(
          "database_unavailable",
          "Could not load your sprint.",
          503,
        );
      const state = data?.state as
        (Sprint & { archivedAt?: string }) | undefined;
      if (!state || state.archivedAt)
        throw new AppError("not_found", "Sprint not found.", 404);
      if (url.searchParams.get("export") === "1") {
        return NextResponse.json(
          {
            schemaVersion: "1.0",
            exportedAt: new Date().toISOString(),
            ...view(state),
          },
          {
            headers: {
              "Cache-Control": "private, no-store",
              "Content-Disposition": `attachment; filename="lunarsprints-${id}.json"`,
            },
          },
        );
      }
      return NextResponse.json(view(state), {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    // Filter archived rows in the query so they never use up list slots, and
    // read only summary fields instead of every full sprint snapshot.
    const { data, error } = await client
      .from("ls_sprints")
      .select(
        "id,revision,updated_at,stage:state->>stage,goalTitle:state->goals->0->>title,intention:state->>intention,startDate:state->>startDate,endDate:state->>endDate",
      )
      .is("state->>archivedAt", null)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error)
      throw new AppError(
        "database_unavailable",
        "Could not load your saved sprints.",
        503,
      );
    const rows = data as unknown as {
      id: string;
      revision: number;
      stage: Sprint["stage"];
      goalTitle: string | null;
      intention: string | null;
      startDate: string;
      endDate: string;
    }[];
    return NextResponse.json(
      {
        plan: planFor(user.id),
        sprints: rows.map((row) => ({
          id: row.id,
          revision: row.revision,
          stage: row.stage,
          title: row.goalTitle || row.intention || "Untitled sprint",
          startDate: row.startDate,
          endDate: row.endDate,
          days: sprintDays(row),
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  let userId: string | undefined;
  let sprintId: string | undefined;
  const runs: RunRecord[] = [];
  let settle = async () => {};
  try {
    sameOrigin(request);
    const { client, user } = await authenticated();
    userId = user.id;
    const command = commandSchema.parse(await jsonBody(request));
    sprintId = command.sprintId;
    const requestHash = hash(command);
    const prior = await replay(user.id, command.idempotencyKey, requestHash);
    if (prior) {
      const { data, error } = await client
        .from("ls_sprints")
        .select("state")
        .eq("id", command.sprintId)
        .maybeSingle();
      if (error)
        throw new AppError(
          "database_unavailable",
          "Could not check this sprint.",
          503,
        );
      if (!data || (data.state as { archivedAt?: string }).archivedAt)
        throw new AppError("not_found", "Sprint not found.", 404);
      return NextResponse.json(view(prior), {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    await rateLimit(user.id, "commands", 90, 300);
    let state: Sprint;
    if (command.action === "create") {
      if (command.expectedRevision !== -1)
        throw new AppError(
          "invalid_input",
          "New sprints start at revision zero.",
        );
      state = newSprint(command.sprintId, command.data, {
        maxDays: planFor(user.id).maxSprintDays,
        enforceStartWindow: true,
      });
    } else {
      const { data, error } = await client
        .from("ls_sprints")
        .select("state")
        .eq("id", command.sprintId)
        .maybeSingle();
      if (error)
        throw new AppError(
          "database_unavailable",
          "Could not load this sprint.",
          503,
        );
      const existing = data?.state as
        (Sprint & { archivedAt?: string }) | undefined;
      if (!existing || existing.archivedAt)
        throw new AppError("not_found", "Sprint not found.", 404);
      if (command.action === "activate") {
        const { data: active, error: activeError } = await client
          .from("ls_sprints")
          .select(
            "id,endDate:state->>endDate,timezone:state->>timezone,archivedAt:state->>archivedAt",
          )
          .eq("state->>stage", "active");
        if (activeError)
          throw new AppError(
            "database_unavailable",
            "Could not check your active sprints.",
            503,
          );
        assertCanActivate(
          planFor(user.id),
          command.sprintId,
          active as unknown as ActiveSprintSummary[],
        );
      }
      if (
        [
          "assess",
          "select_intents",
          "synthesize",
          "regenerate_goals",
          "generate_stories",
          "request_schedule_advice",
          "request_replan",
          "next_action",
          "reflect",
          "resume_clarification",
        ].includes(command.action)
      )
        await rateLimit(user.id, "ai", 30, 3600);
      const engine = createIntelligence({
        userId: user.id,
        sprintId: command.sprintId,
        onRun: (r) => runs.push(r),
      });
      settle = engine.settle;
      state = await coordinate(existing, command, engine.ai);
    }
    const saved = await commit(user.id, command, state, requestHash);
    return NextResponse.json(view(saved), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  } finally {
    if (userId && sprintId && runs.length) {
      const owner = userId,
        id = sprintId;
      const waitForComparisons = settle;
      after(async () => {
        try {
          // Shadow comparison runs finish here, after the user has the answer.
          await waitForComparisons();
          await reconcileUsage(runs);
          await recordRuns(owner, id, runs);
        } catch {
          console.error("Agent run telemetry unavailable");
        }
      });
    }
  }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const { client, user } = await authenticated();
    await rateLimit(user.id, "commands", 90, 300);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new AppError("invalid_input", "Provide a sprint id.");
    const { data, error } = await client
      .from("ls_sprints")
      .select("state")
      .eq("id", id)
      .maybeSingle();
    if (error)
      throw new AppError(
        "database_unavailable",
        "Could not load this sprint.",
        503,
      );
    const existing = data?.state as
      (Sprint & { archivedAt?: string }) | undefined;
    if (!existing || existing.archivedAt)
      throw new AppError("not_found", "Sprint not found.", 404);
    const at = new Date().toISOString();
    const archivedState = {
      ...existing,
      revision: existing.revision + 1,
      originalIntention: "[Archived]",
      intention: "[Archived]",
      intentionHistory: [],
      notes: [],
      archivedAt: at,
      updatedAt: at,
    };
    const key = randomUUID();
    const archiveCommand: Parameters<typeof commit>[1] = {
      sprintId: existing.id,
      expectedRevision: existing.revision,
      idempotencyKey: key,
      action: "capture",
      data: { archived: true },
    };
    await commit(
      user.id,
      archiveCommand,
      archivedState,
      hash({
        action: "archive",
        sprintId: existing.id,
        revision: existing.revision,
      }),
    );
    return NextResponse.json(
      { archivedId: existing.id },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
