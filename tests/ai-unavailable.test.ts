import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AI_NOT_CONNECTED_MESSAGE,
  UnavailableIntelligence,
  type Intelligence,
} from "../src/features/lunarsprints/agents/intelligence";
import { coordinate, hashes } from "../src/features/lunarsprints/coordinator";
import { AppError, planSchedule } from "../src/features/lunarsprints/domain";
import type { Command } from "../src/features/lunarsprints/contracts";
import { sprint, story } from "./fixtures";

const ai: Intelligence = new UnavailableIntelligence();
const cmd = (
  s: ReturnType<typeof sprint>,
  action: Command["action"],
  data: unknown = {},
  kind?: string,
): Command => ({
  sprintId: s.id,
  expectedRevision: s.revision,
  idempotencyKey: crypto.randomUUID(),
  action,
  data,
  ...(kind ? { hash: hashes(s)[kind] } : {}),
});

describe("while no AI engine is connected", () => {
  it("fails every AI call with an honest 503 message", async () => {
    const error = await ai
      .invoke("reflection", z.object({}), {})
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "ai_not_connected",
      status: 503,
      message: AI_NOT_CONNECTED_MESSAGE,
    });
    expect(AI_NOT_CONNECTED_MESSAGE).toBe(
      "AI suggestions are being upgraded. Your saved plan is safe.",
    );
  });

  it("rejects an AI action without changing the saved sprint", async () => {
    const s = sprint();
    const before = structuredClone(s);
    await expect(
      coordinate(s, cmd(s, "regenerate_goals", {}), ai),
    ).rejects.toMatchObject({ code: "ai_not_connected", status: 503 });
    expect(s).toEqual(before);
  });

  it("still approves, schedules and activates a plan without AI", async () => {
    let s = sprint();
    s = await coordinate(s, cmd(s, "approve_goals", {}, "goals"), ai);
    s.stories = [structuredClone(story)];
    s = await coordinate(s, cmd(s, "approve_stories", {}, "stories"), ai);
    s = await coordinate(s, cmd(s, "schedule", {}), ai);
    expect(s.allocations).toEqual(planSchedule(s));
    s = await coordinate(
      s,
      cmd(s, "approve_schedule", { acknowledgeRisk: false }, "schedule"),
      ai,
    );
    s = await coordinate(s, cmd(s, "activate", {}, "activation"), ai);
    expect(s.stage).toBe("active");
  });

  it("explains that the optional schedule note is unavailable instead of failing", async () => {
    let s = sprint();
    s = await coordinate(s, cmd(s, "approve_goals", {}, "goals"), ai);
    s.stories = [structuredClone(story)];
    s = await coordinate(s, cmd(s, "approve_stories", {}, "stories"), ai);
    s = await coordinate(s, cmd(s, "schedule", {}), ai);
    s = await coordinate(s, cmd(s, "request_schedule_advice", {}), ai);
    expect(s.scheduleAdvice?.status).toBe("unavailable");
    expect(s.allocations.length).toBeGreaterThan(0);
  });
});
