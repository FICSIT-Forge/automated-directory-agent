import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/data/**/*.ts", "src/eval/**/*.ts"],
      exclude: ["**/*.test.ts"],
      thresholds: {
        "src/data/enricher.ts": {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
        "src/data/rawParser.ts": {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
        "src/eval/metrics.ts": {
          lines: 80,
          branches: 80,
          functions: 80,
          statements: 80,
        },
      },
    },
  },
});
