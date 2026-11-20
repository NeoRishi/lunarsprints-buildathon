import type { Role } from "../contracts";

/** A successful analysis that needs user input, rather than a transport failure. */
export class NeedsClarification extends Error {
  constructor(
    public role: Role,
    public request: {
      question: string;
      options: string[];
      missingFields: string[];
      reason: string;
    },
  ) {
    super("A planning detail needs your input.");
    this.name = "NeedsClarification";
  }
}

export function clarificationOutcome(
  role: Role,
  output: {
    status: string;
    missingFields: string[];
    clarification: { question: string; options: string[] } | null;
    warnings: { severity: string; message: string }[];
  },
  analysisPayload = false,
): NeedsClarification | null {
  if (output.status !== "needs_clarification" || analysisPayload) return null;
  const fields = output.missingFields.map((f) =>
    f.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " "),
  );
  return new NeedsClarification(role, {
    question:
      output.clarification?.question?.trim() ||
      `What can you tell me about ${fields.join(" and ") || "the remaining scope"}?`,
    options: output.clarification?.options ?? [],
    missingFields: output.missingFields,
    reason:
      output.warnings.find((w) => w.severity !== "info")?.message ||
      "This detail is needed to continue without inventing your plan.",
  });
}
