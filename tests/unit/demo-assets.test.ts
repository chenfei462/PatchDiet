import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "parse5";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

interface HtmlAttribute {
  name: string;
  value: string;
}

interface HtmlNode {
  attrs?: HtmlAttribute[];
  childNodes?: HtmlNode[];
  nodeName?: string;
  tagName?: string;
  value?: string;
}

function readProjectFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function parseDocument(path: string): HtmlNode {
  return parse(readProjectFile(path)) as HtmlNode;
}

function elements(root: HtmlNode, predicate: (node: HtmlNode) => boolean): HtmlNode[] {
  const matches: HtmlNode[] = [];

  function visit(node: HtmlNode): void {
    if (node.tagName && predicate(node)) matches.push(node);
    for (const child of node.childNodes ?? []) visit(child);
  }

  visit(root);
  return matches;
}

function attribute(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((candidate) => candidate.name === name)?.value;
}

function hasClass(node: HtmlNode, className: string): boolean {
  return (attribute(node, "class") ?? "").split(/\s+/).includes(className);
}

function documentText(root: HtmlNode): string {
  const values: string[] = [];

  function visit(node: HtmlNode): void {
    if (node.nodeName === "#text" && node.value) values.push(node.value);
    for (const child of node.childNodes ?? []) visit(child);
  }

  visit(root);
  return values.join(" ").replace(/\s+/g, " ").trim();
}

describe("hackathon demo assets", () => {
  it("freezes an isolated Classic snapshot", () => {
    const classicFiles = [
      "demo/classic/index.html",
      "demo/classic/workspace.html",
      "demo/classic/styles.css",
      "demo/classic/homepage.js",
      "demo/classic/app.js",
      "demo/classic/insights.mjs",
      "demo/classic/README.md"
    ];
    const missingFiles = classicFiles.filter((path) => !existsSync(join(repoRoot, path)));

    expect(missingFiles).toEqual([]);

    const homepage = readProjectFile("demo/classic/index.html");
    const workspace = readProjectFile("demo/classic/workspace.html");
    const app = readProjectFile("demo/classic/app.js");
    const readme = readProjectFile("demo/classic/README.md");

    expect(homepage).toContain("128 changed lines became 32. Tests still passed.");
    expect(homepage).toContain('href="/demo/classic/workspace.html"');
    expect(homepage).toContain('href="./styles.css"');
    expect(homepage).toContain('src="./homepage.js"');
    expect(workspace).toContain('href="/demo/classic/"');
    expect(workspace).toContain('id="diff-input"');
    expect(workspace).toContain('id="fetch-pr"');
    expect(workspace).toContain('href="./styles.css"');
    expect(workspace).toContain('src="./app.js"');
    expect(app).toContain('from "./insights.mjs"');
    // Root-relative so it resolves from /demo/classic/workspace.html.
    expect(app).toContain('"/examples/sample-pr.diff"');
    expect(existsSync(join(repoRoot, "examples/sample-pr.diff"))).toBe(true);
    expect(readme).toContain("/demo/classic/");
    expect(readme).toContain("/demo/classic/workspace.html");
    expect(readme).toContain("security or runtime compatibility");
    expect(readme).toContain("default `/demo/` UI");
  });

  it("defines the five-scene homepage as semantic DOM content", () => {
    const homepage = parseDocument("demo/index.html");
    const body = elements(homepage, (node) => node.tagName === "body")[0];
    const sceneSections = elements(
      homepage,
      (node) => node.tagName === "section" && attribute(node, "data-scene") !== undefined
    );

    expect(body).toBeDefined();
    expect(hasClass(body, "homepage")).toBe(true);
    expect(attribute(body, "data-page")).toBe("homepage");
    expect(sceneSections.map((scene) => attribute(scene, "id"))).toEqual([
      "hero",
      "cleanup-proof",
      "demo-entry",
      "evidence-adoption",
      "final-cta"
    ]);
    expect(sceneSections.map((scene) => attribute(scene, "data-scene"))).toEqual([
      "intake",
      "gates",
      "receipt",
      "evidence",
      "handoff"
    ]);

    const videos = elements(homepage, (node) => node.tagName === "video");
    expect(videos).toHaveLength(1);
    expect(attribute(videos[0], "id")).toBe("hero-video");
    expect(attribute(videos[0], "src")).toBe("/demo/assets/hero-loop.mp4");
    expect(attribute(videos[0], "poster")).toBe("/demo/assets/hero-poster.jpg");
    for (const flag of ["autoplay", "muted", "loop", "playsinline"]) {
      expect(attribute(videos[0], flag), flag).toBe("");
    }
    for (const asset of ["demo/assets/hero-loop.mp4", "demo/assets/hero-poster.jpg", "demo/assets/hero-thumb.jpg"]) {
      expect(existsSync(join(repoRoot, asset)), asset).toBe(true);
    }

    expect(elements(homepage, (node) => attribute(node, "id") === "homepage-story")).toHaveLength(1);
    expect(elements(homepage, (node) => hasClass(node, "skip-link") && attribute(node, "href") === "#hero")).toHaveLength(1);
    expect(elements(homepage, (node) => hasClass(node, "next-scene") && attribute(node, "href") === "#cleanup-proof" && attribute(node, "data-first-viewport-cue") === "true")).toHaveLength(1);

    const scripts = elements(homepage, (node) => node.tagName === "script");
    expect(scripts.some((script) => attribute(script, "src") === "/demo/generated/homepage.js")).toBe(true);
    expect(elements(homepage, (node) => attribute(node, "id") === "diff-input")).toHaveLength(0);

    const links = elements(homepage, (node) => node.tagName === "a").map((link) => attribute(link, "href"));
    expect(links).toContain("/demo/workspace.html");
    expect(links).toContain("/demo/classic/");

    const text = documentText(homepage);
    expect(text).toContain("4 files / 128 changed lines -> 2 files / 32 changed lines");
    expect(text).toContain("75%");
    expect(text).toMatch(/configured checks/i);
    expect(text).toMatch(/preview/i);
    expect(text).toMatch(/human review/i);
  });

  it("preserves the Patch Forge 3D UI as an isolated snapshot", () => {
    const forgeFiles = [
      "demo/forge/index.html",
      "demo/forge/workspace.html",
      "demo/forge/styles.css",
      "demo/forge/app.js",
      "demo/forge/insights.mjs",
      "demo/forge/README.md",
      "demo/forge/src/homepage-entry.js",
      "demo/forge/src/workspace-entry.js",
      "demo/forge/src/forge/create-forge-scene.js",
      "demo/forge/generated/homepage.js",
      "demo/forge/generated/workspace.js",
      "demo/forge/generated/fonts.css"
    ];
    expect(forgeFiles.filter((path) => !existsSync(join(repoRoot, path)))).toEqual([]);

    const homepage = parseDocument("demo/forge/index.html");
    const workspace = parseDocument("demo/forge/workspace.html");
    expect(elements(homepage, (node) => attribute(node, "id") === "forge-canvas")).toHaveLength(1);
    expect(
      elements(homepage, (node) => node.tagName === "section" && attribute(node, "data-forge-scene") !== undefined)
    ).toHaveLength(5);

    // Every root-relative reference stays inside the snapshot, except links to the other UIs.
    const references = [homepage, workspace].flatMap((document) =>
      elements(document, (node) => Boolean(attribute(node, "href") ?? attribute(node, "src")))
        .map((node) => attribute(node, "href") ?? attribute(node, "src") ?? "")
        .filter((value) => value.startsWith("/demo/"))
    );
    for (const reference of references) {
      expect(reference, reference).toMatch(/^\/demo\/(?:forge\/|classic\/$|$)/);
    }
    expect(readProjectFile("demo/forge/styles.css")).not.toMatch(/url\("\/demo\/(?!forge\/)/);

    // The snapshot workspace runs its own copy of the initializer.
    expect(readProjectFile("demo/forge/src/workspace-entry.js")).toContain('from "../app.js"');
    expect(readProjectFile("demo/forge/generated/workspace.js")).toContain("initWorkspace");
    expect(readProjectFile("demo/index.html")).toContain('href="/demo/forge/"');
  });

  it("uses a local ordered stylesheet manifest and inspectable evidence capture", () => {
    const css = readProjectFile("demo/styles.css").trim();
    expect(css.split(/\r?\n/)).toEqual([
      '@import url("/demo/generated/fonts.css");',
      '@import url("/demo/styles/tokens.css");',
      '@import url("/demo/styles/base.css");',
      '@import url("/demo/styles/workspace.css");',
      '@import url("/demo/styles/homepage.css");',
      '@import url("/demo/styles/motion.css");'
    ]);

    const homepage = parseDocument("demo/index.html");
    const capture = elements(
      homepage,
      (node) => node.tagName === "img" && attribute(node, "src") === "/docs/assets/launch-gif/browser-frames/frame-03-candidates-card.png"
    );
    expect(capture).toHaveLength(1);
    expect(attribute(capture[0], "width")).toBe("1265");
    expect(attribute(capture[0], "height")).toBe("720");
    expect(attribute(capture[0], "alt")).toMatch(/PatchDiet/i);
    expect(attribute(capture[0], "loading")).toBe("lazy");

    const text = documentText(homepage);
    for (const path of [
      ".patchdiet/report.github.md",
      ".patchdiet/removal.patch",
      ".patchdiet/reduced.patch",
      ".patchdiet/candidates.json",
      ".patchdiet/diet-card.svg"
    ]) {
      expect(text).toContain(path);
    }
  });

  it("falls back to the still poster when motion is reduced", () => {
    const baseCss = readProjectFile("demo/styles/base.css");
    const motionCss = readProjectFile("demo/styles/motion.css");
    const reducedMotionCss = motionCss.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}\s*$/
    )?.[1];

    // The backdrop paints the poster frame itself, so hiding the video never leaves a blank page.
    expect(baseCss).toMatch(/\.backdrop\s*\{[^}]*url\("\/demo\/assets\/hero-poster\.jpg"\)/s);
    expect(motionCss).toMatch(/\[data-motion="static"\]\s+\.backdrop\s+video\s*\{[^}]*display:\s*none\s*;/s);
    expect(reducedMotionCss).toMatch(/\.backdrop\s+video\s*\{[^}]*display:\s*none\s*;/s);
    // Entrance and reveal animations only apply after JS opts in with .motion-ok.
    expect(motionCss).toMatch(/\.motion-ok\s+\[data-reveal\]\s*\{[^}]*opacity:\s*0\s*;/s);
    expect(baseCss).not.toMatch(/\[data-reveal\][^{]*\{[^}]*opacity:\s*0/s);
  });

  it("defines the liquid-glass component tiers with masked gradient borders", () => {
    const baseCss = readProjectFile("demo/styles/base.css");
    const tokens = readProjectFile("demo/styles/tokens.css");

    expect(baseCss).toMatch(/@layer components\s*\{/);
    expect(baseCss).toMatch(/\.liquid-glass\s*\{[^}]*backdrop-filter:\s*blur\(4px\)/s);
    expect(baseCss).toMatch(/\.liquid-glass-strong\s*\{[^}]*backdrop-filter:\s*blur\(50px\)/s);
    expect(baseCss).toMatch(/\.liquid-glass::before\s*\{[^}]*mask-composite:\s*exclude/s);
    expect(baseCss).toMatch(/\.liquid-glass-strong::before\s*\{[^}]*rgba\(255, 255, 255, 0\.5\)/s);
    expect(tokens).toContain("--radius: 1rem;");
    // Strict grayscale: every HSL token has 0% saturation.
    for (const match of tokens.matchAll(/hsl\(([^)]*)\)|:\s*(\d+ \d+% \d+%);/g)) {
      const value = (match[1] ?? match[2]).trim();
      if (value.startsWith("var(")) continue;
      expect(value, value).toMatch(/^0 0% /);
    }
  });

  it("defines the workspace as an accessible three-pane application", () => {
    const homepage = readProjectFile("demo/index.html");
    const workspaceSource = readProjectFile("demo/workspace.html");
    const workspace = parseDocument("demo/workspace.html");
    const body = elements(workspace, (node) => node.tagName === "body")[0];

    expect(homepage).not.toContain('id="diff-input"');
    expect(homepage).not.toContain('id="fetch-pr"');
    expect(homepage).toContain('href="/demo/workspace.html"');

    expect(body).toBeDefined();
    expect(hasClass(body, "workspace-page")).toBe(true);
    expect(attribute(body, "data-page")).toBe("workspace");

    const backdrop = elements(workspace, (node) => hasClass(node, "backdrop"));
    expect(backdrop).toHaveLength(1);
    expect(attribute(backdrop[0], "aria-hidden")).toBe("true");
    expect(elements(workspace, (node) => node.tagName === "canvas")).toHaveLength(0);

    const requiredIds = [
      "workspace",
      "diff-input",
      "project-name",
      "pr-url",
      "load-sample",
      "analyze",
      "fetch-pr",
      "candidate-queue",
      "verification-receipt",
      "workspace-status"
    ];
    for (const id of requiredIds) {
      expect(elements(workspace, (node) => attribute(node, "id") === id), id).toHaveLength(1);
    }

    const workspaceShell = elements(workspace, (node) => attribute(node, "id") === "workspace")[0];
    const panes = (workspaceShell.childNodes ?? []).filter((node) => node.tagName);
    expect(panes.map((pane) => attribute(pane, "class"))).toEqual([
      expect.stringContaining("input-pane"),
      expect.stringContaining("candidate-pane"),
      expect.stringContaining("receipt-pane")
    ]);
    expect(panes.map((pane) => attribute(pane, "aria-labelledby"))).toEqual([
      "input-heading",
      "candidate-heading",
      "receipt-heading"
    ]);

    const status = elements(workspace, (node) => attribute(node, "id") === "workspace-status")[0];
    expect(attribute(status, "role")).toBe("status");
    expect(attribute(status, "aria-live")).toBe("polite");

    const scripts = elements(workspace, (node) => node.tagName === "script");
    expect(scripts).toContainEqual(expect.objectContaining({
      attrs: expect.arrayContaining([
        { name: "type", value: "module" },
        { name: "src", value: "/demo/generated/workspace.js" }
      ])
    }));

    const links = elements(workspace, (node) => node.tagName === "a").map((link) => attribute(link, "href"));
    expect(links).toContain("/demo/");
    expect(links).toContain("/demo/classic/");

    const modeButtons = elements(
      workspace,
      (node) => node.tagName === "button" && attribute(node, "data-input-mode") !== undefined
    );
    expect(modeButtons.map((button) => attribute(button, "data-input-mode"))).toEqual([
      "sample",
      "paste",
      "pr"
    ]);
    expect(modeButtons.map((button) => attribute(button, "aria-selected"))).toEqual([
      "true",
      "false",
      "false"
    ]);
    expect(modeButtons.every((button) => Boolean(attribute(button, "aria-controls")))).toBe(true);

    const panels = elements(workspace, (node) => attribute(node, "data-input-panel") !== undefined);
    expect(panels.map((panel) => attribute(panel, "data-input-panel"))).toEqual(["sample", "paste", "pr"]);
    expect(attribute(panels[0], "hidden")).toBeUndefined();
    expect(attribute(panels[1], "hidden")).toBe("");
    expect(attribute(panels[2], "hidden")).toBe("");
    expect(workspaceSource).not.toContain('class="product-bar"');
    expect(workspaceSource).not.toContain('class="scan-stage"');
  });

  it("keeps raw diff secondary and exposes visible proof receipts", () => {
    const workspace = readProjectFile("demo/workspace.html");
    const app = readProjectFile("demo/app.js");

    expect(workspace).toContain("<details");
    expect(workspace).toContain("<summary>View raw diff</summary>");
    expect(app).toContain("data-candidate-receipt");
    expect(app).toContain("Browser previews likely noise; CLI verifies removals by rerunning tests.");
    expect(app).toContain("Verified path: run patchdiet shrink to keep only removals where tests still pass.");
    expect(app).toContain("Verified CLI command");
    expect(app).toContain("verificationReceipt");
    expect(app).not.toContain("receipt.title = verificationReceipt");
    expect(app).not.toMatch(/browser (?:runs|reruns|ran) tests/i);
  });

  it("copies the current Judge Mode CLI proof command", () => {
    const app = readProjectFile("demo/app.js");

    expect(app).toContain("navigator.clipboard.writeText");
    expect(app).toContain("preview.judgeMode.cliProofCommand");
    expect(app).toContain("data-proof-copy-status");
    expect(app).toContain("Copy verified CLI command");
  });

  it("uses an explicit loading state for public PR fetching", () => {
    const app = readProjectFile("demo/app.js");

    expect(app).toContain("fetchPrButton.disabled = true");
    expect(app).toContain('fetchPrButton.setAttribute("aria-busy", "true")');
    expect(app).toContain("Fetching public PR diff");
    expect(app).toContain('fetchPrButton.removeAttribute("aria-busy")');
  });

  it("keeps stable preview, metrics, and verification receipt hooks", () => {
    const workspace = readProjectFile("demo/workspace.html");

    expect(workspace).toContain("data-reduction-before");
    expect(workspace).toContain("data-reduction-after");
    expect(workspace).toContain('id="suggestions"');
    expect(workspace).toContain("data-judge-headline");
    expect(workspace).toContain("data-judge-command");
    expect(workspace).toContain("data-card-saved");
    expect(workspace).toContain("data-copy-command");
    expect(workspace).toContain("data-proof-copy-status");
    expect(workspace).toMatch(/browser preview/i);
    expect(workspace).toMatch(/configured checks/i);
    expect(workspace).toMatch(/human review/i);
  });

  it("animates meaningful workspace result changes", () => {
    const app = readProjectFile("demo/app.js");

    expect(app).toContain("runScanSequence");
    expect(app).toContain("animateMetric");
    expect(app).toContain("prefers-reduced-motion: reduce");
  });

  it("keeps launch docs aligned to the sample receipt numbers", () => {
    const readme = readProjectFile("README.md");
    const demo = readProjectFile("docs/demo.md");
    const launch = readProjectFile("docs/launch-materials.md");
    const storyboard = readProjectFile("docs/assets/launch-gif/storyboard.md");

    for (const content of [readme, demo, launch, storyboard]) {
      expect(content).toContain("5 files / 33 lines -> 2 files / 14 lines");
      expect(content).toContain("58% review noise removed");
      expect(content).toContain("4m estimated attention saved");
    }

    expect(demo).toContain("The sample result is already loaded when the page opens.");
    expect(demo).toContain("## One-Minute Hackathon Script");
    expect(demo).toContain("0:00-0:10 - Hook");
    expect(launch).toContain("One-minute hackathon script");
    expect(storyboard).toContain("Judge Mode");
    expect(storyboard).toContain("Verified path: run patchdiet shrink to keep only removals where tests still pass.");
    expect(storyboard).toContain("CLI proof");
    expect(storyboard).toContain("Verified Cleanup Receipt");
    expect(demo).not.toContain("Click **Load sample PR**");
    expect(launch).not.toContain("33 -> 12");
    expect(readme).toContain("## PatchDiet Is / Is Not");
    expect(readme).toContain("PatchDiet is not an AI reviewer");
  });

  it("documents the sample cart PR as a preview-to-verified case study", () => {
    const caseStudy = readProjectFile("docs/case-studies/sample-cart-pr.md");

    expect(caseStudy).toContain("# Sample Cart PR");
    expect(caseStudy).toContain("5 files / 33 lines -> 2 files / 14 lines");
    expect(caseStudy).toContain("58% review noise removed");
    expect(caseStudy).toContain("4m estimated attention saved");
    expect(caseStudy).toContain("http://127.0.0.1:4173/demo/");
    expect(caseStudy).toContain('patchdiet shrink --test "npm test"');
    expect(caseStudy).toContain("```diff");
    expect(caseStudy).toContain(".patchdiet/report.github.md");
    expect(caseStudy).toContain("Preview-only boundary");
    expect(caseStudy).toContain("Verified boundary");
  });
});
