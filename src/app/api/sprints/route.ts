import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticated } from "@/lib/session";
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
import type { RunRecord } from "@/features/lunarsprints/agents/intelligence";
import { selectIntelligence } from "@/features/lunarsprints/agents/gemini-agents";
import {
  activeSprints,
  commit,
  listSprints,
  loadSprint,
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
    const { user } = await authenticated();
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const state = await loadSprint(user.id, id);
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
    const rows = await listSprints(user.id);
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
  try {
    sameOrigin(request);
    const { user } = await authenticated();
    const command = commandSchema.parse(await jsonBody(request));
    const requestHash = hash(command);
    const prior = await replay(user.id, command.idempotencyKey, requestHash);
    if (prior) {
      const stored = await loadSprint(user.id, command.sprintId);
      if (!stored || stored.archivedAt)
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
      const existing = await loadSprint(user.id, command.sprintId);
      if (!existing || existing.archivedAt)
        throw new AppError("not_found", "Sprint not found.", 404);
      if (command.action === "activate") {
        const active = await activeSprints(user.id);
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
      // The agent service answers when AGENTS_SERVICE_URL is set; otherwise AI
      // actions fail with a plain message. Every other action works without AI.
      // Runs are recorded even when a call fails; nothing else is saved then.
      const runs: RunRecord[] = [];
      const ai = selectIntelligence({
        userId: user.id,
        sprintId: command.sprintId,
        onRun: (r) => runs.push(r),
      });
      try {
        state = await coordinate(existing, command, ai);
      } finally {
        await recordRuns(user.id, command.sprintId, runs);
      }
    }
    const saved = await commit(user.id, command, state, requestHash);
    return NextResponse.json(view(saved), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    sameOrigin(request);
    const { user } = await authenticated();
    await rateLimit(user.id, "commands", 90, 300);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new AppError("invalid_input", "Provide a sprint id.");
    const existing = await loadSprint(user.id, id);
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
