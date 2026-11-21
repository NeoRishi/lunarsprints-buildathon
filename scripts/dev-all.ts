/**
 * Runs the agent service and the Next.js dev server together. Started by
 * npm run dev:all inside the Firebase Auth emulator. Ctrl+C stops all three.
 */
import { spawn, type ChildProcess } from "node:child_process";

const children: ChildProcess[] = [];

function start(name: string, command: string, args: string[], cwd?: string) {
  const child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  const prefix = (chunk: Buffer) =>
    chunk
      .toString()
      .split("\n")
      .filter(Boolean)
      .map((line) => `[${name}] ${line}`)
      .join("\n") + "\n";
  child.stdout?.on("data", (c: Buffer) => process.stdout.write(prefix(c)));
  child.stderr?.on("data", (c: Buffer) => process.stderr.write(prefix(c)));
  child.on("exit", (code) => {
    console.log(`[${name}] stopped (${code ?? "signal"})`);
    // If only the agent service stops, keep the app running: AI actions then
    // show the honest "didn't come through" message. Restart it with
    // npm run agents:dev. If the app stops, stop everything.
    if (name === "agents" && !stopping) return;
    stop();
    process.exit(code ?? 0);
  });
  children.push(child);
}

let stopping = false;
function stop() {
  stopping = true;
  for (const child of children) if (!child.killed) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

start(
  "agents",
  "uv",
  ["run", "--env-file", "../.env.local", "python", "-m", "lunarsprints_agents"],
  "agents-service",
);
start("web", "npm", ["run", "dev"]);
