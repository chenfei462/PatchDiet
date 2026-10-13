import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/testing/src/compatibility.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Bounded worker count: an unconstrained pool caused Action/AST test
    // timeouts in full local runs (single-worker isolation and a
    // --maxWorkers=2 retry both passed). Keeping the default `npm test` at
    // two workers makes it reproducible without touching any test deadline
    // or assertion.
    maxWorkers: 2
  },
  coverage: {
    provider: "v8",
    reporter: ["text", "json", "html"],
    all: true,
    include: ["packages/**/*.ts"],
    exclude: ["**/*.d.ts", "**/node_modules/**"],
    thresholds: {
      lines: 70,
      functions: 70,
      branches: 70,
      statements: 70
    }
  }
});
