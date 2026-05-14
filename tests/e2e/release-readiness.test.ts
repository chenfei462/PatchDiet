import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("release readiness", () => {
  it("documents npm publishing prerequisites for maintainers", () => {
    const contributing = readFileSync(join(process.cwd(), "CONTRIBUTING.md"), "utf8");

    expect(contributing).toContain("NPM_TOKEN");
    expect(contributing).toContain("npm publish --access public");
    expect(contributing).toContain("GitHub Actions");
  });

  it("pins a Node version that can run the TypeScript example tests", () => {
    for (const workflowFile of [
      ".github/workflows/ci.yml",
      ".github/workflows/patchdiet-pr.yml",
      ".github/workflows/publish-npm.yml"
    ]) {
      const workflow = readFileSync(join(process.cwd(), workflowFile), "utf8");

      expect(workflow).toContain("actions/setup-node@v4");
      expect(workflow).toContain("node-version: 22");
    }
  });

  it("ships a workflow for npm publishing from GitHub Actions", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github", "workflows", "publish-npm.yml"),
      "utf8"
    );

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("release:");
    expect(workflow).toContain("npm publish --access public");
    expect(workflow).toContain("NODE_AUTH_TOKEN");
  });
});
