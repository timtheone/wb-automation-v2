import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@wb-automation-v2/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url)
      ),
      "@wb-automation-v2/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
      "@wb-automation-v2/wb-clients": fileURLToPath(
        new URL("./packages/wb-clients/src/index.ts", import.meta.url)
      )
    }
  },
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "text-summary", "html", "lcov"],
      include: ["apps/**/src/**/*.ts", "packages/**/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts", "**/generated/**"],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 55,
        lines: 60
      }
    }
  }
});
