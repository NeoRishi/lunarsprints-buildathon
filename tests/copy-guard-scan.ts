/**
 * Deterministic copy checks for LunarSprints. See .agents/skills/copy-quality.
 *
 * Two scans:
 * 1. Em-dashes anywhere in source, docs and project guidance.
 * 2. Plain-language rules for visible UI text in .tsx files: no internal
 *    jargon (SMART, Definition of Done, agent names, diff, story) and no hype.
 *
 * The scan is heuristic: it reads JSX text and string literals that contain a
 * space, after removing comments and className values. It never runs code.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

export const ROOT = new URL("..", import.meta.url).pathname;

const EM_DASH = "\u2014";

/** Folders and root files checked for em-dashes. */
const DASH_DIRS = ["src", "docs", ".agents", "tests"];
const DASH_ROOT_FILES = [
  "GEMINI.md",
  "README.md",
  "IMPLEMENTATION_STATUS.md",
  "project-context.json",
];
const DASH_EXTENSIONS = new Set([".ts", ".tsx", ".css", ".md", ".json"]);

/**
 * Exempt paths. The prompt files are reference summaries of each agent role's
 * instructions, kept unchanged for the new agent service, so they are never
 * rewritten here.
 */
const EXEMPT = [
  `src${sep}features${sep}lunarsprints${sep}agents${sep}prompts${sep}`,
  `docs${sep}evidence${sep}`,
];

export const UI_RULES: Record<string, RegExp> = {
  "jargon:SMART": /\bSMART\b/,
  "jargon:definition-of-done": /definition of done/i,
  "jargon:semantic-replan": /semantic replan/i,
  "jargon:agent-names": /\b(orchestrator|specialist|agents?)\b/i,
  "jargon:diff": /\bdiff\b/i,
  "jargon:story": /\bstor(y|ies)\b/i,
  "hype-words":
    /\b(seamless(ly)?|effortless(ly)?|unlock|supercharge|empower|revolutionary|game[- ]chang\w*|cutting[- ]edge|ai[- ]powered|elevate|delve|leverage|next[- ]level|world[- ]class|magic(al)?)\b/i,
};

function walk(dir: string, out: string[]) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
}

function rel(file: string) {
  return relative(ROOT, file);
}

function exempt(path: string) {
  return EXEMPT.some((prefix) => path.startsWith(prefix));
}

function count(haystack: string, needle: string) {
  return haystack.split(needle).length - 1;
}

/** Removes // and block comments so code notes are not treated as UI copy. */
function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

/** Visible-text candidates: JSX text nodes and string literals with a space. */
export function uiStrings(source: string): string[] {
  const code = stripComments(source)
    .replace(/^\s*import[^\n]*$/gm, " ")
    .replace(/className=(\{[^}]*\}|"[^"]*"|'[^']*')/g, " ")
    .replace(/=>/g, " ");
  const found: string[] = [];
  for (const m of code.matchAll(/>([^<>{}]+)</g)) found.push(m[1]);
  for (const m of code.matchAll(/"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`\\\n]*)`/g))
    found.push((m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{[^}]*\}/g, " "));
  // Keep only prose: a space, a letter, and no code punctuation.
  return found
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(
      (t) => / /.test(t) && /[A-Za-z]/.test(t) && !/[;(){}=|[\]]/.test(t),
    );
}

/** Returns counts keyed by "path::rule". */
export function scan(): Record<string, number> {
  const result: Record<string, number> = {};
  const add = (path: string, rule: string, n: number) => {
    if (n > 0)
      result[`${path}::${rule}`] = (result[`${path}::${rule}`] ?? 0) + n;
  };

  const dashFiles: string[] = [];
  for (const dir of DASH_DIRS) walk(join(ROOT, dir), dashFiles);
  for (const file of DASH_ROOT_FILES) dashFiles.push(join(ROOT, file));
  for (const file of dashFiles) {
    const path = rel(file);
    if (exempt(path) || !DASH_EXTENSIONS.has(extname(file))) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    add(path, "em-dash", count(text, EM_DASH));
  }

  const uiFiles: string[] = [];
  walk(join(ROOT, "src"), uiFiles);
  for (const file of uiFiles) {
    if (extname(file) !== ".tsx") continue;
    const path = rel(file);
    const strings = uiStrings(readFileSync(file, "utf8"));
    for (const [rule, pattern] of Object.entries(UI_RULES))
      add(path, rule, strings.filter((s) => pattern.test(s)).length);
  }
  return result;
}
