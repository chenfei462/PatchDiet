# Compact Cinematic Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the public PatchDiet homepage to five compact narrative bands while preserving the complete interactive demo at `/demo/workspace.html`.

**Architecture:** Move the existing `#workspace` markup into a dedicated static workspace page that continues to load `demo/app.js`. Keep homepage-only motion and final-command copying in a new `demo/homepage.js`, then merge the nine public sections into five bands without duplicating parser logic.

**Tech Stack:** Semantic HTML, CSS, vanilla ESM JavaScript, Node HTTP server, Vitest, in-app browser visual verification.

---

### Task 1: Separate the Complete Workspace

**Files:**
- Create: `demo/workspace.html`
- Modify: `tests/unit/demo-assets.test.ts`
- Modify: `tests/e2e/demo-server.test.ts`

- [x] **Step 1: Write the failing route and ownership tests**

Add tests that establish the page boundary:

```ts
it("keeps the full interactive workspace on its own page", () => {
  const homepage = readProjectFile("demo/index.html");
  const workspace = readProjectFile("demo/workspace.html");

  expect(homepage).not.toContain('id="diff-input"');
  expect(homepage).not.toContain('id="fetch-pr"');
  expect(homepage).toContain('href="/demo/workspace.html"');
  for (const id of ["workspace", "diff-input", "project-name", "pr-url", "load-sample", "analyze", "fetch-pr"]) {
    expect(workspace).toContain(`id="${id}"`);
  }
  expect(workspace).toContain('src="./app.js"');
});
```

Extend the server resolver test:

```ts
const workspace = resolveDemoStaticFile(process.cwd(), "/demo/workspace.html");
expect(workspace?.contentType).toBe("text/html; charset=utf-8");
```

- [x] **Step 2: Run the focused tests and verify they fail**

Run: `npx vitest run tests/unit/demo-assets.test.ts tests/e2e/demo-server.test.ts`

Expected: FAIL because `demo/workspace.html` does not exist and the homepage still owns the controls.

- [x] **Step 3: Create the complete workspace page**

Create `demo/workspace.html` with the existing product bar and the complete current `#workspace` section. Preserve every existing ID and `data-*` hook used by `demo/app.js`. Use these navigation links:

```html
<a class="brand" href="/demo/" aria-label="PatchDiet homepage">PatchDiet</a>
<a class="button button--ghost" href="/demo/">Back to proof</a>
```

Keep `<script type="module" src="./app.js"></script>` at the end of the page.

- [x] **Step 4: Remove the full workspace markup from the homepage**

Replace it temporarily with a compact link owned by the later demo-entry band:

```html
<a class="button button--primary" href="/demo/workspace.html">Open the full demo</a>
```

- [x] **Step 5: Run the focused tests and verify they pass**

Run: `npx vitest run tests/unit/demo-assets.test.ts tests/e2e/demo-server.test.ts`

Expected: PASS.

### Task 2: Split Homepage and Workspace JavaScript

**Files:**
- Create: `demo/homepage.js`
- Modify: `demo/app.js`
- Modify: `demo/index.html`
- Modify: `tests/unit/demo-assets.test.ts`

- [x] **Step 1: Write the failing script-ownership test**

```ts
it("loads page-specific scripts without duplicating diff analysis", () => {
  const homepage = readProjectFile("demo/index.html");
  const homepageApp = readProjectFile("demo/homepage.js");
  const workspace = readProjectFile("demo/workspace.html");

  expect(homepage).toContain('src="./homepage.js"');
  expect(homepage).not.toContain('src="./app.js"');
  expect(workspace).toContain('src="./app.js"');
  expect(homepageApp).not.toContain("analyzeDiffPreview");
  expect(homepageApp).toContain("initNarrativeScenes");
  expect(homepageApp).toContain("copyInstallCommand");
});
```

- [x] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/unit/demo-assets.test.ts`

Expected: FAIL because `demo/homepage.js` does not exist.

- [x] **Step 3: Extract homepage-only behavior**

Move these functions and their required constants from `demo/app.js` into `demo/homepage.js`:

```js
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const installCommand = 'npm ci && npm run build\nnode dist/packages/cli/src/index.js shrink --test "npm test"';

copyInstallButton?.addEventListener("click", copyInstallCommand);
initVerificationMachine();
initNarrativeScenes();
```

Keep the diff parser, sample load, public PR fetch, candidate selection, scan animation, metrics, and verified CLI copy in `demo/app.js`.

- [x] **Step 4: Load the correct script on each page**

Use `homepage.js` on `demo/index.html` and `app.js` on `demo/workspace.html`.

- [x] **Step 5: Run the focused test and verify it passes**

Run: `npx vitest run tests/unit/demo-assets.test.ts`

Expected: PASS.

### Task 3: Recompose the Homepage Into Five Bands

**Files:**
- Modify: `demo/index.html`
- Modify: `tests/unit/demo-assets.test.ts`

- [x] **Step 1: Write the failing five-band content test**

```ts
it("edits the public homepage down to five narrative bands", () => {
  const html = readProjectFile("demo/index.html");
  const topLevelSections = html.match(/^    <section /gm) ?? [];

  expect(topLevelSections).toHaveLength(5);
  for (const id of ["hero", "cleanup-proof", "demo-entry", "evidence-adoption", "final-cta"]) {
    expect(html).toContain(`id="${id}"`);
  }
  for (const removedId of ["verified-proof", "before-after-receipt", "verification-machine", "workspace", "reviewer-artifacts", "workflow-integrations", "team-direction"]) {
    expect(html).not.toContain(`id="${removedId}"`);
  }
});
```

Add assertions for all required metrics, five workflow steps, five artifact paths, availability/direction labels, workspace links, and safety boundaries.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run tests/unit/demo-assets.test.ts`

Expected: FAIL because the homepage still contains the old top-level section IDs.

- [x] **Step 3: Build the five semantic bands**

Use this top-level structure:

```html
<section id="hero" class="intro hero">...</section>
<section id="cleanup-proof" class="cleanup-proof" data-verification-machine data-narrative-scene>...</section>
<section id="demo-entry" class="compact-demo">...</section>
<section id="evidence-adoption" class="evidence-adoption" data-narrative-scene>...</section>
<section id="final-cta" class="final-cta">...</section>
```

Nest the existing Before/After/Receipt panels, compact machine flow, terminal pass/kept lines, sample receipt, real product capture, artifact ledger, and compact integration/direction labels inside those five bands. Do not include full diff controls or candidate lists.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npx vitest run tests/unit/demo-assets.test.ts`

Expected: PASS.

### Task 4: Compact the Visual System

**Files:**
- Modify: `demo/styles.css`
- Modify: `tests/unit/demo-assets.test.ts`

- [x] **Step 1: Write the failing compact-layout contract test**

Require the new selectors and prohibit the old full-height constraints:

```ts
expect(css).toContain(".cleanup-proof");
expect(css).toContain(".compact-demo");
expect(css).toContain(".evidence-adoption");
expect(css).toContain(".workspace-page");
expect(css).not.toContain("min-height: min(760px, calc(100vh - 40px))");
expect(css).not.toContain("min-height: 660px");
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run tests/unit/demo-assets.test.ts`

Expected: FAIL because the old full-height sections remain.

- [x] **Step 3: Implement compact band styles**

Use bounded spacing rather than viewport scenes:

```css
.cleanup-proof,
.compact-demo,
.evidence-adoption {
  margin: 0;
  padding: clamp(44px, 6vw, 76px) 0;
}

.final-cta {
  min-height: 0;
  padding-block: clamp(48px, 7vw, 84px);
}
```

Keep the hero first-viewport behavior, compress receipt panels to content height, keep the verification rail horizontal on desktop and vertical on mobile, and style `.workspace-page` so the extracted demo retains the existing dense operational layout.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npx vitest run tests/unit/demo-assets.test.ts`

Expected: PASS.

### Task 5: Full Verification and Length Budget

**Files:**
- Modify: `demo/index.html`
- Modify: `demo/workspace.html`
- Modify: `demo/styles.css`
- Modify: `demo/homepage.js`

- [x] **Step 1: Run automated verification**

Run: `npm run typecheck`

Expected: PASS.

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: PASS.

- [x] **Step 2: Verify both routes through the local server**

Open:

- `http://127.0.0.1:4173/demo/`
- `http://127.0.0.1:4173/demo/workspace.html`

Confirm the homepage CTA reaches the workspace, the sample loads automatically, public PR controls remain present, and proof media returns HTTP 200.

- [x] **Step 3: Measure the homepage at all required viewports**

Verify:

- `1440x900`: total height `4261px` (`4.73` screens); the next proof band is visible by `40px`.
- `1024x768`: total height `3688px` (`4.80` screens); the next proof band is visible by `36px`.
- `768x768`: total height `5042px`, no horizontal overflow, and the next proof band is visible by `17px`.
- `390x844`: total height `5677px` (`6.73` screens), intentionally below the original seven-screen floor after the homepage-length feedback.

At every viewport, confirm no text/control overlap and no browser console errors.

- [x] **Step 4: Verify reduced motion and static fallback**

Confirm narrative content remains visible when JavaScript is unavailable and CSS disables transforms/animations under `prefers-reduced-motion: reduce`.
