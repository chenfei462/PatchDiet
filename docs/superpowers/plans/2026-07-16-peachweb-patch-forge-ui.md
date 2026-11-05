# Patch Forge 3D UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the current PatchDiet UI as a stable Classic route, then rebuild the default demo as a motion-rich, PeachWeb-inspired experience with a full-screen Three.js Patch Forge, an animated 3D workspace, and preserved local-first analysis behavior.

**Architecture:** The existing homepage and workspace are copied into a self-contained `/demo/classic/` snapshot before redesign work starts. The new `/demo/` uses one fixed full-bleed Three.js canvas behind five scroll-controlled DOM scenes, while `/demo/workspace.html` uses the same scene runtime in a lower-intensity operational mode behind a three-pane analysis cockpit. Existing diff parsing and public-PR behavior remain the source of truth, and pure motion-state functions sit between scroll/UI events and Three.js/GSAP so behavior is testable without WebGL.

**Tech Stack:** Existing static HTML/CSS/ES modules, Three.js, GSAP ScrollTrigger, esbuild, Vitest, Playwright, parse5, pngjs, and pixelmatch.

---

## Confirmed Product And Design Contract

- Keep all interface copy in English.
- Preserve the current UI at `/demo/classic/` and `/demo/classic/workspace.html` before changing default routes.
- Keep Classic HTML, CSS, and JavaScript self-contained so new styles, bundles, and motion code cannot alter it.
- Treat Classic as a frozen compatibility snapshot: only security or runtime-compatibility fixes may change it.
- Use the dark `Patch Forge` direction: forge black, bone white, verified lime, cut coral, evidence cyan, and caution amber.
- Give every current UI route visible motion. The homepage receives continuous cinematic motion; the workspace receives state-driven 3D and DOM motion.
- Keep exactly five homepage narrative scenes: reduction, test gates, proof receipt, evidence, and workspace handoff.
- Preserve the verified fixture claim: `4 files / 128 changed lines -> 2 files / 32 changed lines`, `75%` reduction, configured checks passing.
- Keep preview claims distinct from CLI verification and keep human review required.
- Preserve all workspace input paths: sample diff, pasted diff, and public GitHub PR URL.
- Keep content usable without WebGL and under `prefers-reduced-motion: reduce`.
- Do not add hosted-product, npm availability, customer, billing, or semantic-equivalence claims.

## File Map

**Create**

- `demo/classic/index.html`: frozen copy of the current compact cinematic homepage.
- `demo/classic/workspace.html`: frozen copy of the current interactive workspace.
- `demo/classic/styles.css`: frozen current stylesheet, isolated from the new UI.
- `demo/classic/homepage.js`: frozen current homepage behavior.
- `demo/classic/app.js`: frozen current workspace behavior.
- `demo/classic/insights.mjs`: frozen analysis-preview dependency used by Classic workspace.
- `demo/classic/README.md`: snapshot policy and route documentation.
- `demo/src/fonts.css`: self-hosted font entry bundled from Fontsource packages.
- `demo/src/motion/policy.js`: motion tier, pixel ratio, and reduced-motion policy.
- `demo/src/motion/homepage-timeline.js`: pure scroll-progress-to-scene-state mapping.
- `demo/src/motion/workspace-states.js`: pure workspace event-to-motion-state mapping.
- `demo/src/forge/objects.js`: patch slab, scan gates, rails, fragments, and data packets.
- `demo/src/forge/create-forge-scene.js`: shared renderer/camera/lifecycle runtime.
- `demo/src/forge/homepage-controller.js`: GSAP/scroll orchestration for the homepage.
- `demo/src/forge/workspace-controller.js`: state-driven 3D orchestration for the workspace.
- `demo/src/homepage-entry.js`: homepage bootstrap and copy/navigation behavior.
- `demo/src/workspace-entry.js`: workspace bootstrap and event bridge.
- `demo/styles/tokens.css`: colors, type, spacing, dimensions, and motion timings.
- `demo/styles/base.css`: reset, typography, navigation, focus, and shared surfaces.
- `demo/styles/homepage.css`: five-scene scroll layout and DOM overlays.
- `demo/styles/workspace.css`: three-pane cockpit and responsive layout.
- `demo/styles/motion.css`: entrances, page transitions, workspace feedback, and fallbacks.
- `scripts/build-demo-assets.mjs`: reproducible JS/font bundling.
- `scripts/capture-forge-poster.mjs`: deterministic local fallback-poster capture.
- `tests/unit/demo-motion.test.ts`: pure motion model coverage.
- `tests/unit/demo-build.test.ts`: generated asset contract.
- `tests/ui/demo-ui.spec.ts`: desktop/mobile/WebGL/interaction coverage.
- `playwright.config.ts`: local demo UI test configuration.

**Modify**

- `demo/index.html`: replace the current hero/proof layout with the five-scene canvas narrative.
- `demo/workspace.html`: rebuild the full workspace information architecture while preserving required control IDs.
- `demo/styles.css`: become the ordered import manifest for focused stylesheets.
- `demo/homepage.js`: reduce to a compatibility re-export for the bundled entry.
- `demo/app.js`: expose workspace initialization and emit analysis lifecycle events without changing analysis results.
- `scripts/serve-demo.mjs`: map the directory-style `/demo/classic/` route to its frozen index.
- `scripts/demo-server-lib.mjs`: add WOFF2 MIME support; retain static-root and traversal protections.
- `package.json`: add dependencies and build/UI-test scripts.
- `package-lock.json`: lock all new dependencies.
- `tests/unit/demo-assets.test.ts`: replace brittle indentation/text slicing with parsed structural contracts.
- `tests/e2e/demo-server.test.ts`: verify generated fonts/bundles remain servable.
- `docs/demo.md`: document 3D requirements, fallbacks, and commands.

## Task 0: Freeze The Current UI As Classic

**Files:**
- Create: `demo/classic/index.html`
- Create: `demo/classic/workspace.html`
- Create: `demo/classic/styles.css`
- Create: `demo/classic/homepage.js`
- Create: `demo/classic/app.js`
- Create: `demo/classic/insights.mjs`
- Create: `demo/classic/README.md`
- Modify: `scripts/serve-demo.mjs`
- Modify: `scripts/demo-server-lib.mjs`
- Modify: `tests/unit/demo-assets.test.ts`
- Modify: `tests/e2e/demo-server.test.ts`

- [ ] **Step 1: Write failing Classic snapshot and route tests**

Append this contract to `tests/unit/demo-assets.test.ts`:

```ts
import { existsSync } from "node:fs";

it("preserves the pre-3D homepage and workspace as Classic", () => {
  for (const file of [
    "index.html", "workspace.html", "styles.css", "homepage.js", "app.js", "insights.mjs", "README.md",
  ]) {
    expect(existsSync(join(process.cwd(), "demo", "classic", file))).toBe(true);
  }

  const classicHome = readFileSync(join(process.cwd(), "demo", "classic", "index.html"), "utf8");
  const classicWorkspace = readFileSync(join(process.cwd(), "demo", "classic", "workspace.html"), "utf8");
  expect(classicHome).toContain("128 changed lines became 32. Tests still passed.");
  expect(classicHome).toContain('href="/demo/classic/workspace.html"');
  expect(classicWorkspace).toContain('href="/demo/classic/"');
  expect(classicWorkspace).toContain('id="diff-input"');
  expect(classicWorkspace).toContain('id="fetch-pr"');
});
```

Extend `tests/e2e/demo-server.test.ts` with the pure route contract:

```ts
import { resolveDemoRequestPath } from "../../scripts/demo-server-lib.mjs";

it("maps directory-style Classic URLs without changing asset URLs", () => {
  expect(resolveDemoRequestPath("/demo/classic/")).toBe("/demo/classic/index.html");
  expect(resolveDemoRequestPath("/demo/classic/workspace.html")).toBe("/demo/classic/workspace.html");
  expect(resolveDemoRequestPath("/demo/classic/styles.css")).toBe("/demo/classic/styles.css");
});
```

- [ ] **Step 2: Run the tests and verify the snapshot is absent**

Run:

```bash
npx vitest run tests/unit/demo-assets.test.ts tests/e2e/demo-server.test.ts
```

Expected: FAIL because `demo/classic/` and `resolveDemoRequestPath()` do not exist.

- [ ] **Step 3: Copy the current UI into the isolated Classic directory**

Run these copy operations before editing any default demo file:

```powershell
New-Item -ItemType Directory -Force demo\classic | Out-Null
Copy-Item demo\index.html demo\classic\index.html
Copy-Item demo\workspace.html demo\classic\workspace.html
Copy-Item demo\styles.css demo\classic\styles.css
Copy-Item demo\homepage.js demo\classic\homepage.js
Copy-Item demo\app.js demo\classic\app.js
Copy-Item demo\insights.mjs demo\classic\insights.mjs
```

Change only route references in the copied HTML:

```text
demo/classic/index.html:
  /demo/workspace.html -> /demo/classic/workspace.html

demo/classic/workspace.html:
  /demo/ -> /demo/classic/
```

Keep relative `./styles.css`, `./homepage.js`, `./app.js`, and `./insights.mjs` references unchanged so they resolve inside `demo/classic/`.

- [ ] **Step 4: Document and enforce the frozen-snapshot policy**

```markdown
<!-- demo/classic/README.md -->
# PatchDiet Classic Demo

This directory preserves the pre-Three.js PatchDiet homepage and workspace.

- Homepage: `/demo/classic/`
- Workspace: `/demo/classic/workspace.html`
- Policy: keep behavior and appearance frozen except for security or runtime-compatibility fixes.
- Isolation: do not import styles or scripts from the default `/demo/` UI.
```

- [ ] **Step 5: Add directory-route resolution and use it in the server**

Add to `scripts/demo-server-lib.mjs`:

```js
export function resolveDemoRequestPath(pathname) {
  if (pathname === "/" || pathname === "/demo/") return "/demo/index.html";
  if (pathname === "/demo/classic/") return "/demo/classic/index.html";
  return pathname;
}
```

Update the import and request mapping in `scripts/serve-demo.mjs`:

```js
import {
  fetchPublicPullRequestDiff,
  resolveDemoRequestPath,
  resolveDemoStaticFile,
} from "./demo-server-lib.mjs";

const requestedPath = resolveDemoRequestPath(url.pathname);
```

Remove the previous inline ternary that mapped only `/` and `/demo/`.

- [ ] **Step 6: Run Classic structural and server tests**

Run:

```bash
npx vitest run tests/unit/demo-assets.test.ts tests/e2e/demo-server.test.ts
```

Expected: PASS; both default and Classic route contracts resolve inside allowed static roots.

- [ ] **Step 7: Commit the frozen version before redesign commits**

```bash
git add demo/classic scripts/serve-demo.mjs scripts/demo-server-lib.mjs tests/unit/demo-assets.test.ts tests/e2e/demo-server.test.ts
git commit -m "feat: preserve the Classic demo UI"
```

## Task 1: Add A Reproducible Demo Asset Pipeline

**Files:**
- Create: `scripts/build-demo-assets.mjs`
- Create: `demo/src/fonts.css`
- Create: `tests/unit/demo-build.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/demo-server-lib.mjs`

- [ ] **Step 1: Write the failing generated-asset test**

```ts
// tests/unit/demo-build.test.ts
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("demo asset build", () => {
  it("emits stable browser entries and self-hosted fonts", () => {
    expect(existsSync("demo/generated/homepage.js")).toBe(true);
    expect(existsSync("demo/generated/workspace.js")).toBe(true);
    expect(existsSync("demo/generated/fonts.css")).toBe(true);

    const homepage = readFileSync("demo/generated/homepage.js", "utf8");
    expect(statSync("demo/generated/homepage.js").size).toBeGreaterThan(50_000);
    expect(homepage).not.toContain("https://");
  });
});
```

- [ ] **Step 2: Run the test and verify the contract is absent**

Run: `npx vitest run tests/unit/demo-build.test.ts`

Expected: FAIL because `demo/generated/homepage.js` does not exist.

- [ ] **Step 3: Install local demo build and test dependencies**

Run:

```bash
npm install --save-dev three gsap @fontsource/barlow-condensed @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono esbuild parse5 @playwright/test pngjs pixelmatch
```

Expected: `package.json` and `package-lock.json` change; npm reports no unresolved dependency tree.

- [ ] **Step 4: Add the font entry**

```css
/* demo/src/fonts.css */
@import "@fontsource/barlow-condensed/latin-400.css";
@import "@fontsource/barlow-condensed/latin-600.css";
@import "@fontsource/barlow-condensed/latin-700.css";
@import "@fontsource/ibm-plex-sans/latin-400.css";
@import "@fontsource/ibm-plex-sans/latin-500.css";
@import "@fontsource/ibm-plex-sans/latin-600.css";
@import "@fontsource/ibm-plex-mono/latin-400.css";
@import "@fontsource/ibm-plex-mono/latin-600.css";
```

- [ ] **Step 5: Add the esbuild script**

```js
// scripts/build-demo-assets.mjs
import { build } from "esbuild";

const shared = {
  bundle: true,
  sourcemap: true,
  target: ["es2022"],
  logLevel: "info",
};

await build({
  ...shared,
  entryPoints: {
    homepage: resolve("demo/src/homepage-entry.js"),
    workspace: resolve("demo/src/workspace-entry.js"),
  },
  outdir: "demo/generated",
  format: "esm",
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  entryNames: "[name]",
});

await build({
  ...shared,
  entryPoints: ["demo/src/fonts.css"],
  outfile: "demo/generated/fonts.css",
  assetNames: "fonts/[name]-[hash]",
  loader: { ".woff": "file", ".woff2": "file" },
});
```

- [ ] **Step 6: Add package scripts and WOFF2 MIME support**

Add these scripts to `package.json`:

```json
{
  "demo:build": "node scripts/build-demo-assets.mjs",
  "demo": "npm run demo:build && node scripts/serve-demo.mjs",
  "test:ui": "playwright test tests/ui"
}
```

Add this extension mapping beside the existing MIME mappings in `scripts/demo-server-lib.mjs`:

```js
".woff2": "font/woff2",
```

- [ ] **Step 7: Create temporary entry stubs, build, and verify the test passes**

Use these exact stubs until Tasks 4 and 6 replace them:

```js
// demo/src/homepage-entry.js
import * as THREE from "three";
globalThis.__patchDietThreeRevision = THREE.REVISION;
```

```js
// demo/src/workspace-entry.js
import * as THREE from "three";
globalThis.__patchDietWorkspaceThreeRevision = THREE.REVISION;
```

Run:

```bash
npm run demo:build
npx vitest run tests/unit/demo-build.test.ts tests/e2e/demo-server.test.ts
```

Expected: PASS and no external asset URLs in generated code or CSS.

- [ ] **Step 8: Commit the pipeline**

```bash
git add package.json package-lock.json scripts/build-demo-assets.mjs scripts/demo-server-lib.mjs demo/src/fonts.css demo/src/homepage-entry.js demo/src/workspace-entry.js tests/unit/demo-build.test.ts
git commit -m "build: add local demo asset pipeline"
```

## Task 2: Define Testable Motion State Models

**Files:**
- Create: `demo/src/motion/policy.js`
- Create: `demo/src/motion/homepage-timeline.js`
- Create: `demo/src/motion/workspace-states.js`
- Create: `tests/unit/demo-motion.test.ts`

- [ ] **Step 1: Write failing policy and timeline tests**

```ts
// tests/unit/demo-motion.test.ts
import { describe, expect, it } from "vitest";
import { resolveMotionPolicy } from "../../demo/src/motion/policy.js";
import { getHomepageFrame } from "../../demo/src/motion/homepage-timeline.js";
import { getWorkspaceMotion } from "../../demo/src/motion/workspace-states.js";

describe("demo motion models", () => {
  it("selects static, mobile, and full rendering tiers", () => {
    expect(resolveMotionPolicy({ reducedMotion: true, width: 1440, dpr: 2 })).toEqual({ tier: "static", pixelRatio: 1 });
    expect(resolveMotionPolicy({ reducedMotion: false, width: 390, dpr: 3 })).toEqual({ tier: "mobile", pixelRatio: 1 });
    expect(resolveMotionPolicy({ reducedMotion: false, width: 1440, dpr: 2 })).toEqual({ tier: "full", pixelRatio: 1.5 });
  });

  it("maps scroll progress across all five scenes", () => {
    expect(getHomepageFrame(0).scene).toBe(0);
    expect(getHomepageFrame(0.25).scene).toBe(1);
    expect(getHomepageFrame(0.5).scene).toBe(2);
    expect(getHomepageFrame(0.75).scene).toBe(3);
    expect(getHomepageFrame(1).scene).toBe(4);
    expect(getHomepageFrame(0.55).fragmentEjection).toBeGreaterThan(0);
  });

  it("maps workspace events to visible motion states", () => {
    expect(getWorkspaceMotion("idle").scan).toBe(0);
    expect(getWorkspaceMotion("analyzing").scan).toBe(1);
    expect(getWorkspaceMotion("verified").receiptStamp).toBe(1);
    expect(getWorkspaceMotion("error").gateTone).toBe("caution");
  });
});
```

- [ ] **Step 2: Run the tests and confirm missing modules fail**

Run: `npx vitest run tests/unit/demo-motion.test.ts`

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement the complete motion policy**

```js
// demo/src/motion/policy.js
export function resolveMotionPolicy({ reducedMotion, width, dpr }) {
  if (reducedMotion) return { tier: "static", pixelRatio: 1 };
  if (width <= 700) return { tier: "mobile", pixelRatio: 1 };
  return { tier: "full", pixelRatio: Math.min(dpr, 1.5) };
}
```

- [ ] **Step 4: Implement the homepage frame mapping**

```js
// demo/src/motion/homepage-timeline.js
const clamp = (value) => Math.max(0, Math.min(1, value));
const local = (value, start, end) => clamp((value - start) / (end - start));

export function getHomepageFrame(progress) {
  const p = clamp(progress);
  return {
    progress: p,
    scene: Math.min(4, Math.floor(p * 5)),
    intake: local(p, 0, 0.18),
    gateScan: local(p, 0.18, 0.4),
    fragmentEjection: local(p, 0.4, 0.58),
    receiptAssembly: local(p, 0.58, 0.78),
    handoff: local(p, 0.78, 1),
    pointerWeight: 1 - local(p, 0.18, 0.3),
  };
}
```

- [ ] **Step 5: Implement the workspace state map**

```js
// demo/src/motion/workspace-states.js
const states = {
  idle: { scan: 0, queue: 0, receiptStamp: 0, gateTone: "ready" },
  loading: { scan: 0.45, queue: 0, receiptStamp: 0, gateTone: "evidence" },
  analyzing: { scan: 1, queue: 0.35, receiptStamp: 0, gateTone: "evidence" },
  verified: { scan: 0, queue: 1, receiptStamp: 1, gateTone: "verified" },
  error: { scan: 0, queue: 0, receiptStamp: 0, gateTone: "caution" },
};

export function getWorkspaceMotion(state) {
  if (!(state in states)) throw new Error(`Unknown workspace motion state: ${state}`);
  return states[state];
}
```

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run tests/unit/demo-motion.test.ts`

Expected: PASS.

```bash
git add demo/src/motion tests/unit/demo-motion.test.ts
git commit -m "feat: define demo motion state models"
```

## Task 3: Build The Shared Three.js Patch Forge Runtime

**Files:**
- Create: `demo/src/forge/objects.js`
- Create: `demo/src/forge/create-forge-scene.js`
- Test: `tests/unit/demo-motion.test.ts`

- [ ] **Step 1: Add a failing lifecycle test using injected renderer factories**

Append to `tests/unit/demo-motion.test.ts`:

```ts
import { createForgeScene } from "../../demo/src/forge/create-forge-scene.js";

it("starts, stops, and destroys the forge renderer exactly once", () => {
  const calls: string[] = [];
  const scene = createForgeScene({
    canvas: {} as HTMLCanvasElement,
    policy: { tier: "static", pixelRatio: 1 },
    rendererFactory: () => ({
      setPixelRatio: () => calls.push("pixelRatio"),
      setSize: () => calls.push("size"),
      render: () => calls.push("render"),
      dispose: () => calls.push("dispose"),
    }),
    frameScheduler: { request: () => 1, cancel: () => calls.push("cancel") },
  });

  scene.renderOnce();
  scene.destroy();
  expect(calls).toContain("render");
  expect(calls.filter((call) => call === "dispose")).toHaveLength(1);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npx vitest run tests/unit/demo-motion.test.ts`

Expected: FAIL because `create-forge-scene.js` is missing.

- [ ] **Step 3: Implement forge object construction**

`demo/src/forge/objects.js` must export this stable shape:

```js
export function createForgeObjects(THREE, { tier }) {
  const root = new THREE.Group();
  const slab = new THREE.Group();
  const gates = new THREE.Group();
  const fragments = new THREE.Group();
  const evidence = new THREE.Group();
  const rails = new THREE.Group();

  root.add(rails, gates, slab, fragments, evidence);

  return {
    root,
    slab,
    gates,
    fragments,
    evidence,
    rails,
    counts: {
      fragments: tier === "mobile" ? 12 : 32,
      dataPackets: tier === "mobile" ? 28 : 72,
    },
  };
}
```

Build the returned groups with these concrete objects:

- One `BoxGeometry(4.8, 2.7, 0.16)` diff slab with dark standard material and lime `EdgesGeometry`.
- Twelve intent/code bars attached to the slab face; kept bars use bone/lime and removal bars use coral.
- Two rectangular scan gates built from four box rails each; do not use torus/orb decoration.
- `InstancedMesh` fragments and data packets using the exact counts returned above.
- Three thin evidence plates behind the slab, colored cyan, lime, and bone.
- Four long floor rails plus `GridHelper` for perspective and speed cues.

- [ ] **Step 4: Implement the renderer lifecycle and public interface**

`demo/src/forge/create-forge-scene.js` must export:

```js
export function createForgeScene({
  canvas,
  policy,
  rendererFactory,
  frameScheduler = {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (id) => cancelAnimationFrame(id),
  },
}) {
  // Return exactly:
  return {
    setHomepageFrame,
    setWorkspaceState,
    setPointer,
    resize,
    start,
    stop,
    renderOnce,
    destroy,
    getStats,
  };
}
```

Implementation rules:

- Default `rendererFactory` creates `WebGLRenderer({ canvas, antialias: policy.tier === "full", alpha: false, powerPreference: "high-performance" })`.
- Cap pixel ratio with `policy.pixelRatio` and resize only when CSS dimensions change.
- Use `Scene.fog`, ambient light, and two directional/point lights; do not add postprocessing.
- `setHomepageFrame()` applies the Task 2 frame values to camera, slab, gates, fragments, and evidence.
- `setWorkspaceState()` keeps the camera nearly fixed and drives gate tone, scan position, queue packets, and receipt pulse.
- Use delta-time motion for ambient packets; never advance ambient motion in the static tier.
- Stop animation on `document.visibilitychange`, resume only when visible, and dispose every geometry/material/listener in `destroy()`.

- [ ] **Step 5: Run unit tests and build**

Run:

```bash
npx vitest run tests/unit/demo-motion.test.ts
npm run demo:build
```

Expected: PASS; generated browser entries compile without unresolved Three.js imports.

- [ ] **Step 6: Commit the shared runtime**

```bash
git add demo/src/forge demo/src/motion tests/unit/demo-motion.test.ts demo/generated
git commit -m "feat: add shared Patch Forge 3D runtime"
```

## Task 4: Rebuild The Five-Scene Immersive Homepage

**Files:**
- Modify: `demo/index.html`
- Modify: `demo/homepage.js`
- Create: `demo/src/forge/homepage-controller.js`
- Modify: `demo/src/homepage-entry.js`
- Create: `demo/styles/tokens.css`
- Create: `demo/styles/base.css`
- Create: `demo/styles/homepage.css`
- Create: `demo/styles/motion.css`
- Modify: `demo/styles.css`
- Modify: `tests/unit/demo-assets.test.ts`

- [ ] **Step 1: Replace brittle homepage assertions with a parsed failing contract**

Use `parse5` to assert semantic structure instead of indentation and CSS substrings:

```ts
import { readFileSync } from "node:fs";
import { parse } from "parse5";

const homepageSource = readFileSync("demo/index.html", "utf8");
const homepageAst = parse(homepageSource);
const serialized = JSON.stringify(homepageAst);

it("defines the five-scene forge homepage", () => {
  for (const id of ["hero", "cleanup-proof", "demo-entry", "evidence-adoption", "final-cta"]) {
    expect(serialized).toContain(`\"value\":\"${id}\"`);
  }
  expect(homepageSource).toContain('id="forge-canvas"');
  expect(homepageSource).toContain('src="/demo/generated/homepage.js"');
  expect(homepageSource).not.toContain('id="diff-input"');
});
```

Keep exact product-claim checks for `128`, `32`, `75%`, `configured checks`, `preview`, and `human review` because those are product contracts, not layout details.

- [ ] **Step 2: Run the structural test and verify it fails**

Run: `npx vitest run tests/unit/demo-assets.test.ts`

Expected: FAIL because the canvas and generated entry are absent.

- [ ] **Step 3: Rewrite `demo/index.html` with this stable hierarchy**

```html
<body class="homepage" data-page="homepage">
  <a class="skip-link" href="#hero">Skip to content</a>
  <canvas id="forge-canvas" aria-hidden="true"></canvas>
  <div class="forge-fallback" aria-hidden="true"></div>
  <header class="site-header">...</header>
  <main id="homepage-story">
    <section id="hero" data-forge-scene="intake">...</section>
    <section id="cleanup-proof" data-forge-scene="gates">...</section>
    <section id="demo-entry" data-forge-scene="receipt">...</section>
    <section id="evidence-adoption" data-forge-scene="evidence">...</section>
    <section id="final-cta" data-forge-scene="handoff">...</section>
  </main>
  <script type="module" src="/demo/generated/homepage.js"></script>
</body>
```

Required content placement:

- Hero: brand/product name, verified `128 -> 32` claim, one primary `Open demo` link, one proof link, and a visible hint of scene two.
- Gates: configured-check pipeline and the weak-tests boundary.
- Receipt: before/after/receipt evidence without workspace inputs.
- Evidence: real browser capture and `.patchdiet/*` artifact paths.
- Handoff: install/CLI command and transition link to `/demo/workspace.html`.

- [ ] **Step 4: Split and rebuild the CSS**

Use `demo/styles.css` only as an import manifest:

```css
@import url("/demo/generated/fonts.css");
@import url("/demo/styles/tokens.css");
@import url("/demo/styles/base.css");
@import url("/demo/styles/homepage.css");
@import url("/demo/styles/motion.css");
```

Token requirements in `tokens.css`:

```css
:root {
  --forge-black: #080c09;
  --forge-surface: #111712;
  --bone: #f1f4e9;
  --verified: #b9ff66;
  --cut: #ff765f;
  --evidence: #8cdef0;
  --caution: #f7c76c;
  --display: "Barlow Condensed Variable", sans-serif;
  --body: "IBM Plex Sans Variable", sans-serif;
  --mono: "IBM Plex Mono", monospace;
  --header-height: 72px;
  --content-max: 1440px;
  --radius: 4px;
}
```

Homepage layout requirements:

- Fixed, unframed canvas fills `100svh`; DOM scenes scroll over it.
- Five sections total roughly 650-750svh so the camera has room to move.
- Hero text remains readable and stable; do not attach text to WebGL meshes.
- Desktop headline uses a fixed size per breakpoint, not viewport-width scaling.
- Avoid decorative nested cards; proof surfaces and evidence captures are full-width bands.
- Navigation uses a compact segmented section control and a clear `Open demo` command.
- Navigation or the final handoff includes a quiet `Classic UI` link to `/demo/classic/`.

- [ ] **Step 5: Commit the static homepage before adding motion**

Run: `npx vitest run tests/unit/demo-assets.test.ts`

Expected: PASS with JavaScript disabled because all content is present in HTML.

```bash
git add demo/index.html demo/styles.css demo/styles tests/unit/demo-assets.test.ts
git commit -m "feat: rebuild immersive homepage structure"
```

## Task 5: Add Homepage 3D, Scroll, Pointer, And Page-Transition Motion

**Files:**
- Create: `demo/src/forge/homepage-controller.js`
- Modify: `demo/src/homepage-entry.js`
- Modify: `demo/homepage.js`
- Modify: `demo/styles/motion.css`
- Test: `tests/unit/demo-motion.test.ts`

- [ ] **Step 1: Add a failing controller cleanup test**

Test an injected scene and ScrollTrigger adapter; assert `destroy()` kills the trigger, removes pointer listeners, and destroys the scene once.

```ts
import { createHomepageController } from "../../demo/src/forge/homepage-controller.js";

it("cleans up homepage scene and scroll bindings", () => {
  const calls: string[] = [];
  const controller = createHomepageController({
    scene: { destroy: () => calls.push("scene") },
    scroll: { create: () => ({ kill: () => calls.push("scroll") }) },
    pointerTarget: new EventTarget(),
  });
  controller.destroy();
  expect(calls).toEqual(["scroll", "scene"]);
});
```

- [ ] **Step 2: Run the test and confirm the controller is missing**

Run: `npx vitest run tests/unit/demo-motion.test.ts`

Expected: FAIL on the missing export.

- [ ] **Step 3: Implement homepage orchestration**

The controller must:

- Register GSAP `ScrollTrigger` once with `start: "top top"`, `end: "bottom bottom"`, and `scrub: 0.45`.
- Convert trigger progress through `getHomepageFrame()` and call `scene.setHomepageFrame(frame)`.
- Apply pointer parallax only in the first 30% of the page and clamp it to six CSS pixels of visual shift.
- Update `data-active-scene` on `<body>` so DOM copy transitions are CSS-driven.
- Animate load order: grid/forge, navigation, eyebrow, headline, supporting copy, then CTAs within 1.6 seconds.
- Use same-origin cross-document CSS View Transitions (`@view-transition { navigation: auto; }`) when supported so the verified slab becomes the workspace receipt; navigation must remain instant when unsupported.
- Expose one `destroy()` path for ScrollTrigger, pointer, resize, visibility, and WebGL cleanup.

- [ ] **Step 4: Implement entry bootstrap and compatibility export**

```js
// demo/src/homepage-entry.js
import { resolveMotionPolicy } from "./motion/policy.js";
import { createForgeScene } from "./forge/create-forge-scene.js";
import { createHomepageController } from "./forge/homepage-controller.js";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const policy = resolveMotionPolicy({ reducedMotion, width: innerWidth, dpr: devicePixelRatio });
const canvas = document.querySelector("#forge-canvas");

const scene = createForgeScene({ canvas, policy });
const controller = createHomepageController({ scene, policy });
controller.start();

addEventListener("pagehide", () => controller.destroy(), { once: true });
```

```js
// demo/homepage.js
export * from "/demo/generated/homepage.js";
```

- [ ] **Step 5: Add the exact reduced-motion and failure behavior**

```css
@media (prefers-reduced-motion: reduce) {
  #forge-canvas { display: none; }
  .forge-fallback { display: block; background-image: url("/demo/assets/forge-poster.png"); }
  [data-forge-scene] { opacity: 1; transform: none; }
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; }
}

.no-webgl #forge-canvas { display: none; }
.no-webgl .forge-fallback { display: block; }
```

- [ ] **Step 6: Build, test, and commit**

Run:

```bash
npm run demo:build
npx vitest run tests/unit/demo-motion.test.ts tests/unit/demo-assets.test.ts
```

Expected: PASS.

```bash
git add demo/src demo/homepage.js demo/styles/motion.css demo/generated tests/unit
git commit -m "feat: animate the Patch Forge homepage"
```

## Task 6: Rebuild The Workspace Without Losing Existing Behavior

**Files:**
- Modify: `demo/workspace.html`
- Modify: `demo/app.js`
- Create: `demo/styles/workspace.css`
- Modify: `demo/styles.css`
- Modify: `tests/unit/demo-assets.test.ts`
- Modify: `tests/unit/insights.test.ts`

- [ ] **Step 1: Write the failing parsed workspace contract**

Require these IDs and regions in `tests/unit/demo-assets.test.ts`:

```ts
for (const id of [
  "workspace-canvas", "workspace", "diff-input", "project-name", "pr-url",
  "load-sample", "analyze", "fetch-pr", "candidate-queue", "verification-receipt",
]) {
  expect(workspaceSerialized).toContain(`\"value\":\"${id}\"`);
}

expect(workspaceSource).toContain('role="status"');
expect(workspaceSource).toContain('aria-live="polite"');
expect(workspaceSource).toContain('src="/demo/generated/workspace.js"');
```

- [ ] **Step 2: Run the test and confirm new regions are absent**

Run: `npx vitest run tests/unit/demo-assets.test.ts tests/unit/insights.test.ts`

Expected: FAIL only on new structural requirements; analysis tests remain green.

- [ ] **Step 3: Rewrite the workspace hierarchy**

```html
<body class="workspace-page" data-page="workspace">
  <canvas id="workspace-canvas" aria-hidden="true"></canvas>
  <header class="workspace-header">...</header>
  <main id="workspace" class="workspace-shell">
    <section class="input-pane" aria-labelledby="input-heading">...</section>
    <section id="candidate-queue" class="candidate-pane" aria-labelledby="candidate-heading">...</section>
    <aside id="verification-receipt" class="receipt-pane" aria-labelledby="receipt-heading">...</aside>
  </main>
  <div id="workspace-status" role="status" aria-live="polite"></div>
  <script type="module" src="/demo/generated/workspace.js"></script>
</body>
```

Input pane rules:

- Use a segmented control for Sample / Paste / PR URL.
- Keep IDs `diff-input`, `project-name`, `pr-url`, `load-sample`, `analyze`, and `fetch-pr` unchanged.
- Disable only the command currently in flight; do not block other reading/navigation.
- Preserve the preview-only wording beside the result and CLI-verification wording in the receipt.

- [ ] **Step 4: Refactor `demo/app.js` behind one initializer and lifecycle events**

Export `initWorkspace({ root = document, onStateChange = () => {} } = {})` and keep the existing parser/fetch logic. Emit only these states:

```js
onStateChange({ type: "loading-sample" });
onStateChange({ type: "fetching-pr" });
onStateChange({ type: "analyzing" });
onStateChange({ type: "verified", result });
onStateChange({ type: "error", message });
```

The initializer must return `{ destroy, analyzeCurrentDiff, selectInputMode }`; `destroy()` removes every listener and pending animation timer. Do not change `analyzeDiffPreview()` output or GitHub API request shape.

- [ ] **Step 5: Implement the responsive three-pane workspace CSS**

- Desktop `>= 1181px`: 24% input / 48% candidates / 28% sticky receipt.
- Tablet `701-1180px`: input spans top; candidates and receipt form a two-column lower region.
- Mobile `<= 700px`: input, receipt, candidates in that order; all text and buttons fit at 390px width.
- Canvas remains full-bleed and unframed; panes use opaque-enough bands for diff readability.
- Use 4px maximum radii, stable control heights, visible focus, and no nested decorative cards.

Append the workspace import to `demo/styles.css` after the base import and before the motion import:

```css
@import url("/demo/styles/workspace.css");
```

- [ ] **Step 6: Run behavior tests and commit**

Run:

```bash
npx vitest run tests/unit/demo-assets.test.ts tests/unit/insights.test.ts tests/e2e/demo-server.test.ts
```

Expected: PASS.

```bash
git add demo/workspace.html demo/app.js demo/styles/workspace.css tests/unit/demo-assets.test.ts
git commit -m "feat: rebuild the PatchDiet workspace cockpit"
```

## Task 7: Animate Every Workspace State In 3D And DOM

**Files:**
- Create: `demo/src/forge/workspace-controller.js`
- Modify: `demo/src/workspace-entry.js`
- Modify: `demo/styles/motion.css`
- Test: `tests/unit/demo-motion.test.ts`

- [ ] **Step 1: Write a failing state-bridge test**

```ts
import { createWorkspaceStateBridge } from "../../demo/src/forge/workspace-controller.js";

it("routes workspace lifecycle events to the forge controller", () => {
  const received: string[] = [];
  const bridge = createWorkspaceStateBridge({ setState: (state) => received.push(state) });
  bridge({ type: "fetching-pr" });
  bridge({ type: "analyzing" });
  bridge({ type: "verified", result: {} });
  expect(received).toEqual(["loading", "analyzing", "verified"]);
});
```

- [ ] **Step 2: Run the test and verify the bridge is absent**

Run: `npx vitest run tests/unit/demo-motion.test.ts`

Expected: FAIL on the missing bridge/controller export.

- [ ] **Step 3: Implement state-driven 3D behavior**

`workspace-controller.js` must map states as follows:

- `idle`: slow data packets on rails; neutral lime gate; slab stable behind the receipt.
- `loading`: cyan packets accelerate toward the intake gate; no result values change.
- `analyzing`: one scan plane traverses the slab; candidate fragments begin separating.
- `verified`: slab width compresses from 128-scale to 32-scale, coral fragments exit, lime receipt plane lands once.
- `error`: scan stops, gate becomes amber, fragments return to their pre-analysis positions.

DOM choreography must cover every workspace state:

- Page entry assembles the three panes from the shared receipt anchor in 420ms.
- Input-mode segment slides in 180ms; forms crossfade without changing shell height.
- Candidate rows enter with 60ms stagger.
- Reduction metric interpolates for 700ms.
- PASS stamp lands in 320ms.
- Error recovery reveals in 220ms without shake or layout jump.
- Copy icon changes to a check for 1200ms without resizing the button.

- [ ] **Step 4: Wire workspace bootstrap**

```js
// demo/src/workspace-entry.js
import { resolveMotionPolicy } from "./motion/policy.js";
import { createForgeScene } from "./forge/create-forge-scene.js";
import { createWorkspaceController, createWorkspaceStateBridge } from "./forge/workspace-controller.js";
import { initWorkspace } from "../app.js";

const policy = resolveMotionPolicy({
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  width: innerWidth,
  dpr: devicePixelRatio,
});

const scene = createForgeScene({ canvas: document.querySelector("#workspace-canvas"), policy });
const controller = createWorkspaceController({ scene, policy });
const workspace = initWorkspace({ onStateChange: createWorkspaceStateBridge(controller) });

controller.start();
addEventListener("pagehide", () => {
  workspace.destroy();
  controller.destroy();
}, { once: true });
```

- [ ] **Step 5: Test, build, and commit**

Run:

```bash
npx vitest run tests/unit/demo-motion.test.ts tests/unit/insights.test.ts
npm run demo:build
```

Expected: PASS.

```bash
git add demo/src/forge/workspace-controller.js demo/src/workspace-entry.js demo/styles/motion.css demo/generated tests/unit/demo-motion.test.ts
git commit -m "feat: animate every workspace state"
```

## Task 8: Add WebGL Failure, Reduced Motion, Accessibility, And Poster Fallbacks

**Files:**
- Create: `scripts/capture-forge-poster.mjs`
- Create: `demo/assets/forge-poster.png`
- Modify: `demo/src/forge/create-forge-scene.js`
- Modify: `demo/styles/motion.css`
- Modify: `demo/index.html`
- Modify: `demo/workspace.html`
- Modify: `package.json`

- [ ] **Step 1: Add a failing WebGL-loss UI test fixture**

In `tests/ui/demo-ui.spec.ts`, initialize the page with WebGL disabled and assert `.no-webgl`, visible poster, readable H1, and usable `Open demo` link.

- [ ] **Step 2: Implement context loss and fallback activation**

The scene runtime must listen for both events:

```js
canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  stop();
  document.documentElement.classList.add("no-webgl");
});

canvas.addEventListener("webglcontextrestored", () => {
  document.documentElement.classList.remove("no-webgl");
  resize();
  start();
});
```

If renderer construction throws, add `.no-webgl` immediately and return a no-op scene with the same public methods.

- [ ] **Step 3: Add deterministic poster capture**

`scripts/capture-forge-poster.mjs` must:

- Start the existing demo server on an available local port.
- Launch Chromium at `1440x900` with reduced motion disabled.
- Wait for `[data-forge-ready="true"]`.
- Capture only `#forge-canvas` to `demo/assets/forge-poster.png`.
- Close browser and server in `finally`.

Add package script:

```json
"demo:capture-poster": "node scripts/capture-forge-poster.mjs"
```

- [ ] **Step 4: Enforce accessibility behavior**

- Canvas remains `aria-hidden="true"`; all meaning stays in DOM text.
- Every icon-only control has an accessible name and visible tooltip.
- Status/error regions use `aria-live="polite"` and do not repeatedly announce decorative progress.
- Focus is never moved during animation.
- Reduced motion performs instant state changes; it does not hide content or disable analysis.
- Keyboard users can operate input modes, analyze, candidate selection, artifact tabs, copy, and navigation.

- [ ] **Step 5: Capture the poster and run focused tests**

Run:

```bash
npm run demo:build
npm run demo:capture-poster
npx vitest run tests/unit/demo-assets.test.ts tests/unit/demo-motion.test.ts
```

Expected: poster is nonblank, unit tests PASS.

- [ ] **Step 6: Commit fallbacks**

```bash
git add scripts/capture-forge-poster.mjs demo/assets/forge-poster.png demo/src/forge/create-forge-scene.js demo/styles/motion.css demo/index.html demo/workspace.html package.json
git commit -m "feat: add accessible forge fallbacks"
```

## Task 9: Add Desktop, Mobile, Canvas-Pixel, And Workflow UI Tests

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/ui/demo-ui.spec.ts`
- Modify: `package.json`

- [ ] **Step 1: Configure Playwright against the real demo server**

```ts
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/ui",
  webServer: {
    command: "npm run demo",
    url: "http://127.0.0.1:4173/demo/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
});
```

- [ ] **Step 2: Add a reusable nonblank-canvas assertion**

```ts
import { PNG } from "pngjs";

function canvasVariance(buffer: Buffer) {
  const png = PNG.sync.read(buffer);
  let bright = 0;
  let colored = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
    if (r + g + b > 54) bright += 1;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 18) colored += 1;
  }
  const pixels = png.width * png.height;
  return { brightRatio: bright / pixels, colorRatio: colored / pixels };
}
```

Require both ratios above `0.04` for homepage and workspace canvases.

- [ ] **Step 3: Test homepage rendering and movement**

The desktop test must:

- Load `/demo/` and wait for `[data-forge-ready="true"]`.
- Assert the canvas variance thresholds.
- Screenshot the canvas before and after scrolling to scene three.
- Use `pixelmatch` to require at least 2% of pixels change.
- Assert active scene changes from `intake` to `receipt`.
- Assert fixed header, H1, CTAs, and next-section hint do not overlap at `1440x900` and `1280x720`.
- Open `/demo/classic/`, follow its workspace link, load the sample, and confirm the preserved analysis workflow still renders a receipt.

- [ ] **Step 4: Test the complete workspace workflow**

The test must:

- Navigate using the real homepage CTA.
- Assert the workspace canvas is nonblank.
- Switch Sample -> Paste -> PR URL and verify each form is keyboard operable.
- Load the local sample, run analysis, and assert candidate rows, `128 -> 32`, `75%`, PASS, artifact links, and preview boundary.
- Verify the canvas changes between idle, analyzing, and verified states.
- Trigger a mocked public-PR failure and assert amber error/recovery UI without losing the pasted diff.

- [ ] **Step 5: Test mobile and reduced-motion behavior**

The mobile test must assert:

- No horizontal overflow at `390x844`.
- Logo, menu, H1, CTA, workspace controls, candidates, and receipt never overlap.
- Homepage and workspace canvases remain nonblank with the mobile geometry tier.
- Under reduced motion, canvases are replaced by the poster, DOM copy remains visible, and the complete workspace analysis flow still succeeds.

- [ ] **Step 6: Run UI tests and commit**

Run:

```bash
npm run demo:build
npm run test:ui
```

Expected: desktop and mobile projects PASS with canvas-pixel and workflow assertions.

```bash
git add playwright.config.ts tests/ui package.json package-lock.json
git commit -m "test: verify animated demo UI"
```

## Task 10: Final Regression, Documentation, And Delivery

**Files:**
- Modify: `docs/demo.md`

- [ ] **Step 1: Document the final operating contract**

Add these sections to `docs/demo.md`:

- `Build and run`: `npm run demo:build`, `npm run demo`, and the local URL.
- `Motion tiers`: full, mobile, reduced motion, and WebGL fallback.
- `Page coverage`: five homepage scenes and all workspace lifecycle states.
- `Performance`: DPR caps, instancing, pause-on-hidden, and no postprocessing.
- `Trust boundaries`: preview versus configured-check verification and human review.

- [ ] **Step 2: Run the full proportional verification suite**

Run:

```bash
npm run demo:build
npm test
npm run test:ui
```

Expected: all unit, existing e2e, demo server, desktop UI, and mobile UI tests PASS.

- [ ] **Step 3: Run production build checks**

Run:

```bash
npm run build
npm pack --dry-run
```

Expected: packages build successfully; demo-generated assets do not accidentally enter published package payloads unless explicitly listed.

- [ ] **Step 4: Perform browser visual QA**

Verify and retain screenshots for:

- Homepage at `1440x900`, `1280x720`, and `390x844` in scenes 1, 3, and 5.
- Workspace at the same viewports in idle, analyzing, verified, and error states.
- Reduced-motion homepage and workspace.
- Canvas pixel variance and frame-difference checks at desktop and mobile sizes.

Reject delivery if any canvas is blank, text overlaps, controls resize during feedback, content depends on WebGL, or mobile uses the full desktop geometry tier.

- [ ] **Step 5: Review the diff for scope and user changes**

Run:

```bash
git status --short
git diff -- demo scripts/build-demo-assets.mjs scripts/capture-forge-poster.mjs tests docs/demo.md package.json package-lock.json playwright.config.ts
```

Expected: only the planned UI/build/test/documentation files changed; unrelated dirty-worktree files remain untouched.

- [ ] **Step 6: Commit documentation and final verification fixes**

```bash
git add docs/demo.md
git commit -m "docs: document the Patch Forge demo"
```

## Completion Criteria

- Both `/demo/` and `/demo/workspace.html` visibly use real Three.js scenes.
- `/demo/classic/` and `/demo/classic/workspace.html` preserve the current pre-3D UI and remain fully functional.
- New default styles and bundles are not imported by any file under `demo/classic/`.
- All five homepage scenes have distinct camera/object choreography.
- Every workspace lifecycle state has purposeful 3D and DOM feedback.
- Existing sample, paste, and public-PR workflows produce the same analysis results as before.
- Canvas-pixel tests prove desktop and mobile scenes are nonblank and move between states.
- No text, navigation, button, pane, receipt, or candidate content overlaps at required viewports.
- Reduced-motion and WebGL-failure paths preserve all content and workflows.
- All assets are local; runtime pages make no CDN requests.
- Full tests, builds, and dry-run packaging pass.
