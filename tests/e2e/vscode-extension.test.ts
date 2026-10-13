import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("VS Code extension scaffold", () => {
  it("contributes sidebar, open/copy/dry-run commands, and bundle script", () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "extensions", "vscode-patchdiet", "package.json"), "utf8")
    ) as {
      main: string;
      scripts?: Record<string, string>;
      contributes?: {
        commands?: Array<{ command: string }>;
        viewsContainers?: Record<string, Array<{ id: string }>>;
        views?: Record<string, Array<{ id: string }>>;
      };
    };
    const extension = readFileSync(join(process.cwd(), "extensions", "vscode-patchdiet", "extension.mjs"), "utf8");

    expect(manifest.main).toBe("./dist/extension.mjs");
    expect(manifest.scripts?.bundle).toContain("esbuild");
    expect(manifest.scripts?.package).toContain("scripts/package-vscode-extension.mjs");
    expect(manifest.contributes?.viewsContainers?.activitybar?.[0]?.id).toBe("patchdiet");
    expect(manifest.contributes?.views?.patchdiet?.[0]?.id).toBe("patchdiet.candidates");
    expect(manifest.contributes?.commands?.map((item) => item.command)).toEqual(
      expect.arrayContaining([
        "patchdiet.analyzeDiff",
        "patchdiet.openCandidate",
        "patchdiet.copySuggestion",
        "patchdiet.runDryRunJson"
      ])
    );
    expect(extension).toContain("createTreeView");
    expect(extension).toContain("patchdiet.openCandidate");
    expect(extension).toContain("patchdiet.runDryRunJson");
  });

  it("packages and smoke-checks a VSIX artifact", async () => {
    const result = await execFileAsync("node", ["scripts/vscode-smoke.mjs"], {
      cwd: process.cwd(),
      timeout: 120000
    });
    const output = `${result.stdout}${result.stderr}`;
    const match = /VS Code VSIX smoke passed: (.+\.vsix)/.exec(output);

    expect(match?.[1]).toBeTruthy();
    expect(existsSync(match![1]!)).toBe(true);
  });
});
