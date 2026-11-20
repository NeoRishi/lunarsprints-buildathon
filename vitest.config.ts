import { defineConfig } from "vitest/config";
// Fast unit tests only. Database and emulator tests run through
// vitest.integration.config.ts (npm run test:rls, npm run test:auth).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [
      "tests/rls.test.ts",
      "tests/auth-emulator.test.ts",
      "**/node_modules/**",
    ],
    testTimeout: 30000,
  },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
});
