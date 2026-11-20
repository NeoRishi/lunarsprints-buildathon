// Playwright request exceptions can include Cookie headers in their default
// stack. Live checks must never print those headers or credential-bearing logs.
function fail(error: unknown) {
  const e = error instanceof Error ? error : null;
  console.error("Live acceptance check failed", {
    type: e?.name ?? "unknown",
    summary: e?.message.split("\n")[0].slice(0, 300) ?? "Unknown failure",
    location: e?.stack
      ?.split("\n")
      .find(
        (line) => line.trim().startsWith("at ") && line.includes("/scripts/"),
      )
      ?.trim(),
  });
  process.exit(1);
}
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
