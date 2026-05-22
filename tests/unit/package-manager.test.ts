import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { detectPackageManagerCommands } from "../../packages/core/src/package-manager.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("detectPackageManagerCommands", () => {
  it("prefers packageManager over lockfiles", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-pm-"));
    tempDirs.push(dir);
    writePackageJson(dir, {
      packageManager: "npm@10.0.0",
      scripts: {
        test: "vitest run",
        lint: "eslint .",
        typecheck: "tsc --noEmit"
      }
    });
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    expect(detectPackageManagerCommands(dir)).toEqual({
      packageManager: "npm",
      required: ["npm test"],
      optional: ["npm run lint", "npm run typecheck"]
    });
  });

  it("maps pnpm scripts to pnpm commands", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-pm-"));
    tempDirs.push(dir);
    writePackageJson(dir, {
      scripts: {
        test: "vitest run",
        lint: "eslint .",
        typecheck: "tsc --noEmit"
      }
    });
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    expect(detectPackageManagerCommands(dir)).toEqual({
      packageManager: "pnpm",
      required: ["pnpm test"],
      optional: ["pnpm lint", "pnpm typecheck"]
    });
  });

  it("maps yarn scripts to yarn commands", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-pm-"));
    tempDirs.push(dir);
    writePackageJson(dir, {
      scripts: {
        test: "vitest run",
        lint: "eslint .",
        typecheck: "tsc --noEmit"
      }
    });
    writeFileSync(join(dir, "yarn.lock"), "# yarn lockfile\n");

    expect(detectPackageManagerCommands(dir)).toEqual({
      packageManager: "yarn",
      required: ["yarn test"],
      optional: ["yarn lint", "yarn typecheck"]
    });
  });

  it("defaults to npm for a root package.json with scripts and no package manager metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-pm-"));
    tempDirs.push(dir);
    writePackageJson(dir, {
      scripts: {
        test: "ava"
      }
    });

    expect(detectPackageManagerCommands(dir)).toEqual({
      packageManager: "npm",
      required: ["npm test"],
      optional: []
    });
  });

  it("does not invent lint or typecheck commands when scripts are missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-pm-"));
    tempDirs.push(dir);
    writePackageJson(dir, {
      packageManager: "pnpm@9.0.0",
      scripts: {
        test: "vitest run"
      }
    });

    expect(detectPackageManagerCommands(dir)).toEqual({
      packageManager: "pnpm",
      required: ["pnpm test"],
      optional: []
    });
  });

  it("returns undefined when no supported package manager is detected", () => {
    const dir = mkdtempSync(join(tmpdir(), "patchdiet-pm-"));
    tempDirs.push(dir);

    expect(detectPackageManagerCommands(dir)).toBeUndefined();
  });
});

function writePackageJson(dir: string, value: Record<string, unknown>): void {
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(value, null, 2)}\n`);
}
