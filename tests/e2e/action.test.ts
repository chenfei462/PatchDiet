import { createServer } from "node:http";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createExampleRepo } from "./helpers/create-example-repo.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const actionEntry = "packages/action/dist/index.mjs";

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("PatchDiet action", () => {
  it("runs shrink and writes the GitHub step summary", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "patchdiet-action-workspace-"));
    const summaryPath = join(workspace, "summary.md");
    const outputPath = join(workspace, "outputs.txt");
    tempDirs.push(workspace);
    await createExampleRepo("ts-bloated-pr", workspace);

    await execFileAsync(process.execPath, [actionEntry], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GITHUB_WORKSPACE: workspace,
        GITHUB_STEP_SUMMARY: summaryPath,
        GITHUB_OUTPUT: outputPath,
        INPUT_BASE: "main",
        INPUT_HEAD: "agent/bloated",
        INPUT_TEST: "node --test"
      }
    });

    expect(readFileSync(summaryPath, "utf8")).toContain("## PatchDiet");
    expect(readFileSync(join(workspace, ".patchdiet", "report.github.md"), "utf8")).toContain("cleanup.diff");
    expect(readFileSync(join(workspace, ".patchdiet", "report.html"), "utf8")).toContain("PatchDiet Report");
    expect(readFileSync(join(workspace, ".patchdiet", "cleanup.diff"), "utf8")).toContain("multiply");
    const outputs = readFileSync(outputPath, "utf8");
    expect(outputs).toContain("report-md=");
    expect(outputs).toContain("cleanup-diff=");
  });

  it("updates an existing PR comment when token and event payload are provided", async () => {
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

    const requests: Array<{ method: string; url: string | undefined; body: string }> = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        requests.push({ method: req.method ?? "", url: req.url, body });
        if (req.method === "GET") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify([
            {
              id: 99,
              body: "<!-- patchdiet-comment -->\nold",
              user: { type: "Bot" }
            }
          ]));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind local server");
    }

    try {
      await execFileAsync(process.execPath, [actionEntry], {
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

    expect(requests.map((request) => request.method)).toEqual(["GET", "PATCH"]);
    expect(requests[1]?.url).toContain("/issues/comments/99");
    expect(requests[1]?.body).toContain("<!-- patchdiet-comment -->");
    expect(requests[1]?.body).toContain("## PatchDiet");
  });

  it("falls back safely when PR comment publishing is not permitted", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "patchdiet-action-comment-denied-"));
    const summaryPath = join(workspace, "summary.md");
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

    const server = createServer((req, res) => {
      req.resume();
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "Resource not accessible by integration" }));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind local server");
    }

    try {
      const result = await execFileAsync(process.execPath, [actionEntry], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          GITHUB_WORKSPACE: workspace,
          GITHUB_STEP_SUMMARY: summaryPath,
          INPUT_BASE: "main",
          INPUT_HEAD: "agent/bloated",
          INPUT_TEST: "node --test",
          INPUT_GITHUB_TOKEN: "test-token",
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_API_URL: `http://127.0.0.1:${address.port}`
        }
      });
      expect(`${result.stdout}${result.stderr}`).toContain("Could not publish PatchDiet PR comment");
    } finally {
      server.close();
    }

    expect(readFileSync(summaryPath, "utf8")).toContain("## PatchDiet");
  });

  it("runs from the bundled action without dist, node_modules, npm install, or build", async () => {
    const checkout = mkdtempSync(join(tmpdir(), "patchdiet-action-checkout-"));
    const workspace = mkdtempSync(join(tmpdir(), "patchdiet-action-bootstrap-workspace-"));
    const fakeBin = mkdtempSync(join(tmpdir(), "patchdiet-no-npm-"));
    tempDirs.push(checkout, workspace, fakeBin);
    cpSync(process.cwd(), checkout, {
      recursive: true,
      filter: (source) => {
        const relative = source
          .replace(process.cwd(), "")
          .replaceAll("\\", "/")
          .replace(/^\/+/, "");
        return relative !== "node_modules"
          && relative !== "dist"
          && !relative.includes("/.git/")
          && !relative.endsWith(".tgz")
          && relative !== ".git";
      }
    });
    await createExampleRepo("ts-bloated-pr", workspace);

    expect(existsSync(join(checkout, "dist"))).toBe(false);
    expect(existsSync(join(checkout, "node_modules"))).toBe(false);
    expect(existsSync(join(checkout, "packages", "action", "dist", "index.mjs"))).toBe(true);
    writeFailingNpm(fakeBin);

    await execFileAsync(process.execPath, [actionEntry], {
      cwd: checkout,
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
        GITHUB_WORKSPACE: workspace,
        INPUT_BASE: "main",
        INPUT_HEAD: "agent/bloated",
        INPUT_TEST: "node --test"
      },
      timeout: 120000
    });

    expect(readFileSync(join(workspace, ".patchdiet", "report.github.md"), "utf8")).toContain("## PatchDiet");
  }, 180000);
});

function writeFailingNpm(dir: string): void {
  mkdirSync(dir, { recursive: true });
  if (process.platform === "win32") {
    writeFileSync(join(dir, "npm.cmd"), "@echo off\r\necho npm must not be called by PatchDiet action\r\nexit /b 99\r\n", "utf8");
    return;
  }

  const scriptPath = join(dir, "npm");
  writeFileSync(scriptPath, "#!/bin/sh\necho 'npm must not be called by PatchDiet action'\nexit 99\n", "utf8");
  chmodSync(scriptPath, 0o755);
}
