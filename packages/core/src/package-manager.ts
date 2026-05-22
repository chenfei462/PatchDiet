import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type SupportedPackageManager = "npm" | "pnpm" | "yarn";

export interface DetectedPackageManagerCommands {
  packageManager: SupportedPackageManager;
  required: string[];
  optional: string[];
}

interface PackageJsonShape {
  packageManager?: unknown;
  scripts?: unknown;
}

export function detectPackageManagerCommands(cwd: string): DetectedPackageManagerCommands | undefined {
  const packageJson = readPackageJson(cwd);
  const scripts = asStringRecord(packageJson?.scripts);
  const packageManager = detectSupportedPackageManager(cwd, packageJson?.packageManager)
    ?? (scripts ? "npm" : undefined);
  if (!packageManager) {
    return undefined;
  }

  return {
    packageManager,
    required: hasScript(scripts, "test") ? [testCommandFor(packageManager)] : [],
    optional: [
      ...(hasScript(scripts, "lint") ? [lintCommandFor(packageManager)] : []),
      ...(hasScript(scripts, "typecheck") ? [typecheckCommandFor(packageManager)] : [])
    ]
  };
}

function detectSupportedPackageManager(
  cwd: string,
  packageManagerField: unknown
): SupportedPackageManager | undefined {
  const fromPackageManagerField = parseSupportedPackageManager(packageManagerField);
  if (fromPackageManagerField) {
    return fromPackageManagerField;
  }

  if (existsSync(join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (existsSync(join(cwd, "yarn.lock"))) {
    return "yarn";
  }

  if (existsSync(join(cwd, "package-lock.json"))) {
    return "npm";
  }

  return undefined;
}

function parseSupportedPackageManager(value: unknown): SupportedPackageManager | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  const name = normalized.includes("@") ? normalized.split("@")[0] ?? "" : normalized;
  if (name === "npm" || name === "pnpm" || name === "yarn") {
    return name;
  }

  return undefined;
}

function readPackageJson(cwd: string): PackageJsonShape | undefined {
  const packageJsonPath = join(cwd, "package.json");
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageJsonShape;
  } catch {
    return undefined;
  }
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const entries = Object.entries(value);
  if (!entries.every((entry) => typeof entry[1] === "string")) {
    return undefined;
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

function hasScript(scripts: Record<string, string> | undefined, name: string): boolean {
  return typeof scripts?.[name] === "string" && scripts[name].trim().length > 0;
}

function testCommandFor(packageManager: SupportedPackageManager): string {
  switch (packageManager) {
    case "npm":
      return "npm test";
    case "pnpm":
      return "pnpm test";
    case "yarn":
      return "yarn test";
  }
}

function lintCommandFor(packageManager: SupportedPackageManager): string {
  switch (packageManager) {
    case "npm":
      return "npm run lint";
    case "pnpm":
      return "pnpm lint";
    case "yarn":
      return "yarn lint";
  }
}

function typecheckCommandFor(packageManager: SupportedPackageManager): string {
  switch (packageManager) {
    case "npm":
      return "npm run typecheck";
    case "pnpm":
      return "pnpm typecheck";
    case "yarn":
      return "yarn typecheck";
  }
}
