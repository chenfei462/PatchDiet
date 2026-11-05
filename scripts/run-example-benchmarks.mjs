import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const node = process.execPath;
const cli = join(process.cwd(), "dist", "packages", "cli", "src", "index.js");
const helper = join(process.cwd(), "dist", "tests", "e2e", "helpers", "create-example-repo.js");
const outputDir = join(process.cwd(), ".patchdiet", "example-benchmarks");
const examples = [
  { name: "ts-bloated-pr", test: "node --test" },
  { name: "agent-large-pr", test: "node --test" },
  { name: "python-agent-refactor", test: "python -m unittest discover -s tests -v" },
  { name: "monorepo-scope-creep", test: "node --test packages/app/test/math.test.js" }
];

mkdirSync(outputDir, { recursive: true });

for (const example of examples) {
  const repo = mkdtempSync(join(tmpdir(), `patchdiet-${example.name}-`));
  try {
    execFileSync(node, ["--input-type=module", "-e", `
      import { createExampleRepo } from ${JSON.stringify(pathToFileURL(helper).href)};
      await createExampleRepo(${JSON.stringify(example.name)}, ${JSON.stringify(repo.replaceAll("\\", "/"))});
    `], { cwd: process.cwd(), stdio: "inherit" });
    const diff = execFileSync("git", ["diff", "main...agent/bloated"], { cwd: repo, encoding: "utf8" });
    execFileSync(node, [
      cli,
      "shrink",
      "--base",
      "main",
      "--head",
      "agent/bloated",
      "--test",
      example.test
    ], {
      cwd: process.cwd(),
      env: { ...process.env, PATCHDIET_TARGET_CWD: repo },
      stdio: "inherit"
    });

    const target = join(outputDir, example.name);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "input.diff"), diff, "utf8");
    writeFileSync(join(target, "report.md"), readFileSync(join(repo, ".patchdiet", "report.md"), "utf8"));
    writeFileSync(join(target, "run.json"), readFileSync(join(repo, ".patchdiet", "run.json"), "utf8"));
    writeFileSync(join(target, "README.md"), [
      `# ${example.name}`,
      "",
      "- base: main",
      "- head: agent/bloated",
      `- command: \`patchdiet shrink --base main --head agent/bloated --test "${example.test}"\``,
      "- input: `input.diff`",
      "- output: `report.md` and `run.json`",
      "- limitation: local fixture, not a market-result claim",
      ""
    ].join("\n"));
  } finally {
    rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  }
}

console.log(`Example benchmark artifacts written to ${outputDir}`);
