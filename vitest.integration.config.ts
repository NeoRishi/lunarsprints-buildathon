import { defineConfig } from "vitest/config";

// Local runs read .env.local; CI sets the variables directly.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: rely on the environment.
}

export default defineConfig({
  test: {
    include: ["tests/rls.test.ts", "tests/auth-emulator.test.ts"],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
});
