/**
 * Writes the agent service JSON Schema files from the zod contract.
 *   npm run contracts:build          rewrite contracts/schemas/
 *   npm run contracts:build -- --check   fail if the committed files are stale
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { serviceJsonSchemaFiles } from "../src/features/lunarsprints/agents/contract";

const dir = path.join(process.cwd(), "contracts", "schemas");
const check = process.argv.includes("--check");
const files = serviceJsonSchemaFiles();
const stale: string[] = [];
for (const [name, schema] of Object.entries(files)) {
  const file = path.join(dir, name);
  const text = JSON.stringify(schema, null, 2) + "\n";
  if (check) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== text)
      stale.push(name);
  } else writeFileSync(file, text);
}
const extra = readdirSync(dir).filter(
  (f) => f.endsWith(".json") && !(f in files),
);
if (check && (stale.length || extra.length)) {
  console.error(
    `Agent service schemas are out of date: ${[...stale, ...extra].join(", ")}. Run npm run contracts:build.`,
  );
  process.exit(1);
}
console.log(
  check
    ? "Agent service schemas are up to date."
    : `Wrote ${Object.keys(files).length} schema files.`,
);
