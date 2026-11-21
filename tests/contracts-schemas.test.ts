import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  SERVICE_ROLES,
  SERVICE_TASKS,
  serviceJsonSchemaFiles,
  serviceTaskFor,
  scheduleNotesSchema,
} from "../src/features/lunarsprints/agents/contract";
import {
  clarificationSchema,
  goalPlanningSchema,
  scopeReadinessSchema,
  storiesSchema,
  intentSchema,
} from "../src/features/lunarsprints/contracts";

const dir = path.join(__dirname, "..", "contracts", "schemas");

describe("agent service schema files", () => {
  it("match contract.ts exactly (run npm run contracts:build if this fails)", () => {
    const files = serviceJsonSchemaFiles();
    const committed = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(committed.sort()).toEqual(Object.keys(files).sort());
    for (const [name, schema] of Object.entries(files))
      expect(readFileSync(path.join(dir, name), "utf8"), name).toBe(
        JSON.stringify(schema, null, 2) + "\n",
      );
  });

  it("covers request and response for every connected role", () => {
    const files = serviceJsonSchemaFiles();
    for (const role of SERVICE_ROLES) {
      expect(files).toHaveProperty(`${role}.request.json`);
      expect(files).toHaveProperty(`${role}.response.json`);
    }
  });
});

describe("serviceTaskFor", () => {
  it("maps each stage schema the coordinator uses to one task", () => {
    expect(serviceTaskFor("intent_alignment", intentSchema)?.task).toBe(
      "assess",
    );
    expect(serviceTaskFor("smart_goal", clarificationSchema)?.task).toBe(
      "clarify",
    );
    expect(serviceTaskFor("smart_goal", goalPlanningSchema)?.task).toBe(
      "goals",
    );
    expect(serviceTaskFor("smart_goal", scopeReadinessSchema)?.task).toBe(
      "readiness",
    );
    expect(serviceTaskFor("story_decomposer", storiesSchema)?.task).toBe(
      "stories",
    );
    expect(serviceTaskFor("scheduling", scheduleNotesSchema)?.task).toBe(
      "schedule_notes",
    );
  });

  it("returns null for roles and schemas the service does not answer", () => {
    expect(serviceTaskFor("reflection", z.object({}))).toBeNull();
    expect(serviceTaskFor("smart_goal", storiesSchema)).toBeNull();
  });

  it("never sends account identity to the service", () => {
    for (const role of SERVICE_ROLES)
      for (const t of Object.values(SERVICE_TASKS[role])) {
        const keys = JSON.stringify(z.toJSONSchema(t.input));
        expect(keys).not.toMatch(/"(email|userId|user_id|idToken|uid)"/);
      }
  });
});
