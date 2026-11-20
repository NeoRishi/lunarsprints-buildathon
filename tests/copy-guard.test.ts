import { describe, expect, it } from "vitest";
import baseline from "./copy-guard-baseline.json";
import { scan, uiStrings, UI_RULES } from "./copy-guard-scan";

/**
 * The baseline lists problems that existed when this guard was added. It may
 * only shrink: new problems fail, and fixed problems must be removed from it.
 */
const known = baseline as Record<string, number>;
const found = scan();

describe("copy guard", () => {
  it("adds no new em-dashes, internal jargon or hype words", () => {
    const added = Object.entries(found)
      .filter(([key, n]) => n > (known[key] ?? 0))
      .map(([key, n]) => `${key}: ${n} (baseline ${known[key] ?? 0})`);
    expect(added, "Fix these, see .agents/skills/copy-quality").toEqual([]);
  });

  it("keeps the baseline honest after fixes", () => {
    const stale = Object.entries(known)
      .filter(([key, n]) => (found[key] ?? 0) < n)
      .map(([key, n]) => `${key}: now ${found[key] ?? 0}, baseline ${n}`);
    expect(stale, "Lower these in tests/copy-guard-baseline.json").toEqual([]);
  });

  it("reads visible copy and ignores code", () => {
    const strings = uiStrings(
      [
        "// SMART in a comment is fine",
        'import { story } from "./story";',
        '<p className="story diff">Review the plan diff</p>',
        'const key = "stories";',
        "{items.map((story) => <li>{story.title}</li>)}",
        "<button>Done means this works</button>",
      ].join("\n"),
    );
    expect(strings).toEqual(["Review the plan diff", "Done means this works"]);
    expect(UI_RULES["jargon:diff"].test(strings[0])).toBe(true);
    expect(strings.some((s) => UI_RULES["jargon:SMART"].test(s))).toBe(false);
  });
});
