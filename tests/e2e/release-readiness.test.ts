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

  it("runs release smoke verification as an explicit CI gate", () => {
    const ciWorkflow = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");

    expect(readFileSync(join(process.cwd(), "package.json"), "utf8")).toContain("\"smoke:release\"");
    expect(readFileSync(join(process.cwd(), "package.json"), "utf8")).toContain("\"test:release\"");
    expect(ciWorkflow).toContain("name: release-smoke");
    expect(ciWorkflow).toContain("npm run smoke:release");
    expect(ciWorkflow).toContain("npm run build");
    expect(ciWorkflow).toContain("npm run typecheck");
    expect(ciWorkflow).toContain("npx vitest run");
  });

  it("documents the Action zero-config path and uploads report artifacts", () => {
    const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "patchdiet-pr.yml"), "utf8");

    expect(workflow).toContain("uses: ./");
    expect(workflow).not.toContain("test: node --test");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain(".patchdiet/cleanup.diff");
    expect(workflow).toContain(".patchdiet/report.html");
    expect(workflow).toContain(".patchdiet/run.json");
  });

  it("documents the v1 onboarding path in the README and release checklist", () => {
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const releaseDocs = readFileSync(join(process.cwd(), "docs", "release.md"), "utf8");
    const configDocs = readFileSync(join(process.cwd(), "docs", "config.md"), "utf8");

    expect(readme).toContain("Supported JS repo, zero config");
    expect(readme).toContain("npx patchdiet shrink --base origin/main --head HEAD");
    expect(readme).toContain("What happens on the first run");
    expect(readme).toContain("patchdiet init");
    expect(readme).toContain("If zero-config detection fails");
    expect(readme).toContain("When PatchDiet will not guess for you");
    expect(readme).not.toContain("generic fallback");
    expect(readme).toContain("Real repo case study");
    expect(releaseDocs).toContain("npm run smoke:release");
    expect(releaseDocs).toContain("npm publish --access public");
    expect(releaseDocs).toContain("post-publish verification");
    expect(releaseDocs).toContain("GitHub release notes");
    expect(configDocs).toContain("Command resolution priority");
    expect(configDocs).toContain("When PatchDiet will not guess for you");
    expect(configDocs).not.toContain("generic fallback");
  });

  it("ships a reproducible real-repo validation script and evidence document", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const script = readFileSync(join(process.cwd(), "scripts", "real-repo-validation.mjs"), "utf8");
    const evidence = readFileSync(join(process.cwd(), "docs", "evidence", "real-repo-validation.md"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

    expect(packageJson).toContain("\"validate:real-repos\"");
    expect(script).toContain("https://github.com/sindresorhus/query-string.git");
    expect(script).toContain("5ec53f9bc336de87e69427b95b1d389f406418e5");
    expect(script).toContain("https://github.com/pytest-dev/pytest.git");
    expect(script).toContain("543b11f2534bb0edc85b86767ed239da9c5bd140");
    expect(script).toContain("https://github.com/Shelf-nu/shelf.nu.git");
    expect(script).toContain("c1a741542148dac702aba652e019edbaa495b3a1");
    expect(script).toContain("monorepo samples always use explicit commands");

    expect(evidence).toContain("# Real Repo Validation");
    expect(evidence).toContain("query-string");
    expect(evidence).toContain("pytest");
    expect(evidence).toContain("shelf.nu");
    expect(evidence).toContain("does not depend on upstream PR lifecycle");
    expect(evidence).toContain("monorepo sample uses an explicit package-targeted command");
    expect(evidence).toContain("Base commit");
    expect(evidence).toContain("Command");
    expect(evidence).toContain("Removed");
    expect(evidence).toContain("Kept");

    expect(readme).toContain("Real repo case study");
    expect(readme).toContain("query-string");
    expect(readme).toContain("zero-config JS");
    expect(readme).toContain("Synthetic demos");
    expect(readme).not.toContain("The same pattern held in the Python and monorepo demos");
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
});
