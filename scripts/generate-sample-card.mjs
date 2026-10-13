import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const reportModulePath = join(process.cwd(), "dist", "packages", "report", "src", "index.js");
if (!existsSync(reportModulePath)) {
  runNpm(["run", "build"], process.cwd());
}

const {
  buildDietCardModel,
  renderDietCardHtml,
  renderDietCardPng,
  renderDietCardSvg
} = await import(pathToFileURL(reportModulePath).href);

const report = {
  baseRef: "origin/main",
  headRef: "HEAD",
  input: {
    fileCount: 5,
    hunkCount: 5,
    addedLineCount: 32,
    removedLineCount: 1,
    changedLineCount: 33
  },
  output: {
    fileCount: 2,
    hunkCount: 2,
    addedLineCount: 13,
    removedLineCount: 1,
    changedLineCount: 14
  },
  removals: [
    {
      filePath: "README.md",
      hunkHeader: "@@ -0,0 +1,6 @@",
      category: "docs-only",
      reason: "sample removal",
      confidence: "high-confidence removal"
    },
    {
      filePath: "docs/agent-plan.md",
      hunkHeader: "@@ -0,0 +1,5 @@",
      category: "docs-only",
      reason: "sample removal",
      confidence: "high-confidence removal"
    },
    {
      filePath: "dist/cart.generated.js",
      hunkHeader: "@@ -0,0 +1,8 @@",
      category: "generated-like",
      reason: "sample removal",
      confidence: "high-confidence removal"
    }
  ]
};

const outDir = join(process.cwd(), ".patchdiet");
mkdirSync(outDir, { recursive: true });
const model = buildDietCardModel(report, { projectName: "sample-cart-pr" });
writeFileSync(join(outDir, "diet-card.sample.html"), renderDietCardHtml(model), "utf8");
writeFileSync(join(outDir, "diet-card.sample.svg"), renderDietCardSvg(model), "utf8");
writeFileSync(join(outDir, "diet-card.sample.png"), renderDietCardPng(model));
console.log("Sample Diet Cards written to .patchdiet/diet-card.sample.html, .patchdiet/diet-card.sample.svg, and .patchdiet/diet-card.sample.png");

function runNpm(args, cwd, stdio = "inherit") {
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm", ...args], { cwd, stdio });
    return;
  }

  execFileSync("npm", args, { cwd, stdio });
}
