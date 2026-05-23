import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("release readiness", () => {
  it("documents npm publishing prerequisites for maintainers", () => {
    const contributing = readFileSync(join(process.cwd(), "CONTRIBUTING.md"), "utf8");

    expect(contributing).toContain("trusted publishing");
    expect(contributing).toContain("npm publish --access public");
    expect(contributing).toContain("id-token: write");
  });

  it("pins a Node version that can run the TypeScript example tests", () => {
    for (const workflowFile of [
      ".github/workflows/ci.yml",
      ".github/workflows/patchdiet-pr.yml",
    ]) {
      const workflow = readFileSync(join(process.cwd(), workflowFile), "utf8");

      expect(workflow).toContain("actions/setup-node@v4");
      expect(workflow).toContain("node-version: 22");
    }
  });

  it("checks that the bundled action is fresh in CI", () => {
    const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");

    expect(workflow).toContain("npm run build:action");
    expect(workflow).toContain("git diff --exit-code -- packages/action/dist/index.mjs");
  });

  it("uses current GitHub Actions runtimes in the release workflow", () => {
    const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "publish-npm.yml"), "utf8");

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("actions/checkout@v6");
    expect(workflow).toContain("actions/setup-node@v6");
    expect(workflow).toContain("node-version: 24.x");
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain("npm publish --access public");
  });

  it("ships a workflow for npm publishing from GitHub Actions", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github", "workflows", "publish-npm.yml"),
      "utf8"
    );

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("release:");
    expect(workflow).toContain("npm publish --access public");
  });

  it("ships a bundled GitHub Action entrypoint", () => {
    const action = readFileSync(join(process.cwd(), "action.yml"), "utf8");
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const gitignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");

    expect(action).toContain("main: packages/action/dist/index.mjs");
    expect(packageJson).toContain("\"build:action\"");
    expect(packageJson).toContain("\"esbuild\"");
    expect(packageJson).toContain("\"packages/action/dist\"");
    expect(gitignore).toContain("!packages/action/dist/index.mjs");
  });

  it("documents a benchmark schema for future datasets", () => {
    const schema = readFileSync(join(process.cwd(), "docs", "benchmark-schema.json"), "utf8");
    const parsed = JSON.parse(schema) as {
      required?: string[];
      properties?: Record<string, unknown>;
    };

    expect(parsed.required).toContain("scenarioId");
    expect(parsed.required).toContain("agent");
    expect(parsed.required).toContain("baseRef");
    expect(parsed.required).toContain("headRef");
    expect(parsed.required).toContain("testCommand");
    expect(parsed.required).toContain("expectedKeptPaths");
    expect(parsed.properties).toHaveProperty("expectedRemovedPaths");
  });
});
