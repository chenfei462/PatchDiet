import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createExampleRepo } from "./helpers/create-example-repo.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("PatchDiet action", () => {
  it("runs shrink and writes the GitHub step summary", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "patchdiet-action-workspace-"));
    const summaryPath = join(workspace, "summary.md");
    tempDirs.push(workspace);
    await createExampleRepo("ts-bloated-pr", workspace);

    await execFileAsync("node", ["packages/action/index.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GITHUB_WORKSPACE: workspace,
        GITHUB_STEP_SUMMARY: summaryPath,
        INPUT_BASE: "main",
        INPUT_HEAD: "agent/bloated",
        INPUT_TEST: "node --test"
      }
    });

    expect(readFileSync(summaryPath, "utf8")).toContain("PatchDiet found a smaller equivalent patch.");
    expect(readFileSync(join(workspace, ".patchdiet", "report.github.md"), "utf8")).toContain("Cleanup patch artifact:");
  });

  it("lets the action fall through to auto-detection when INPUT_TEST is omitted", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "patchdiet-action-autodetect-"));
    const summaryPath = join(workspace, "summary.md");
    tempDirs.push(workspace);
    await createExampleRepo("ts-bloated-pr", workspace);
    installStubPackageManager(workspace, "npm");

    writeFileSync(
      join(workspace, "package.json"),
      JSON.stringify({
        name: "ts-bloated-pr",
        private: true,
        type: "module",
        packageManager: "npm@10.0.0",
        scripts: {
          test: "node --test"
        }
      }, null, 2)
    );

    await execFileAsync("node", ["packages/action/index.mjs"], {
      cwd: process.cwd(),
      env: buildStubEnv(workspace, {
        ...process.env,
        GITHUB_WORKSPACE: workspace,
        GITHUB_STEP_SUMMARY: summaryPath,
        INPUT_BASE: "main",
        INPUT_HEAD: "agent/bloated"
      })
    });

    expect(readFileSync(summaryPath, "utf8")).toContain("PatchDiet found a smaller equivalent patch.");
    expect(readFileSync(join(workspace, ".stub-bin", "npm.log"), "utf8")).toContain("test");
  });

  it("posts a PR comment when token and event payload are provided", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "patchdiet-action-comment-"));
    const eventPath = join(workspace, "event.json");
    tempDirs.push(workspace);
    await createExampleRepo("ts-bloated-pr", workspace);

    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: { number: 42 },
        repository: { full_name: "patchdiet/example" }
      }),
      "utf8"
    );

    const requests: string[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        requests.push(body);
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind local server");
    }

    try {
      await execFileAsync("node", ["packages/action/index.mjs"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          GITHUB_WORKSPACE: workspace,
          INPUT_BASE: "main",
          INPUT_HEAD: "agent/bloated",
          INPUT_TEST: "node --test",
          INPUT_GITHUB_TOKEN: "test-token",
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_API_URL: `http://127.0.0.1:${address.port}`
        }
      });
    } finally {
      server.close();
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("PatchDiet found a smaller equivalent patch.");
  });
});

function installStubPackageManager(dir: string, commandName: "npm" | "pnpm" | "yarn"): void {
  const binDir = join(dir, ".stub-bin");
  mkdirSync(binDir, { recursive: true });
  const logPath = join(binDir, `${commandName}.log`).replaceAll("\\", "/");
  writeFileSync(
    join(binDir, `${commandName}.cmd`),
    [
      "@echo off",
      "setlocal",
      `echo %*>>\"${logPath}\"`,
      "exit /b 0"
    ].join("\r\n"),
    "utf8"
  );
}

function buildStubEnv(dir: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: `${join(dir, ".stub-bin")};${env.PATH ?? ""}`
  };
}
