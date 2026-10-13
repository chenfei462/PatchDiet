# Cinematic Proof Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the standalone cinematic proof homepage so a reviewer can understand the `128 -> 32` verified-cleanup story, inspect how verification works, try the demo, inspect real artifacts, and reach a clear next action.

**Architecture:** Extend the existing static `demo/` experience with semantic HTML sections, CSS-driven cinematic scenes, and a small progressive-enhancement layer in `demo/app.js`. Keep the existing diff parser and demo workspace intact; new motion is driven by `IntersectionObserver` and CSS custom properties, with complete static and reduced-motion states. Existing proof assets under `docs/assets/` are served read-only by the local demo server.

**Tech Stack:** Semantic HTML, CSS transforms/animations, vanilla ESM JavaScript, Node HTTP server, Vitest asset and server tests.

---

### Task 1: Verification Machine

**Files:**
- Modify: `tests/unit/demo-assets.test.ts`
- Modify: `demo/index.html`
- Modify: `demo/styles.css`
- Modify: `demo/app.js`

- [x] **Step 1: Write the failing structure test**

Add a test that requires `#verification-machine` between the receipt triptych and workspace, five ordered workflow nodes, a visible kept/failed candidate, all five trust claims, `data-verification-machine`, and CSS/JS hooks for scene progress.

```ts
it("shows the configured-check verification machine before the demo", () => {
  const html = readProjectFile("demo/index.html");
  const css = readProjectFile("demo/styles.css");
  const app = readProjectFile("demo/app.js");

  expect(html).toContain('id="verification-machine"');
  for (const label of ["Diff in", "Temporary worktrees", "Rerun tests", "Removal patch", "Cleanup receipt"]) {
    expect(html).toContain(`>${label}<`);
  }
  expect(html).toContain("Candidate kept");
  expect(html).toContain("No source upload by default");
  expect(html).toContain("No LLM required for verified cleanup");
  expect(css).toContain(".verification-machine[data-scene-state=\"active\"]");
  expect(app).toContain("initVerificationMachine");
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --run tests/unit/demo-assets.test.ts`

Expected: FAIL because `#verification-machine` does not exist.

- [x] **Step 3: Implement the semantic scene**

Insert a section with this stable interface:

```html
<section id="verification-machine" class="verification-machine" data-verification-machine data-scene-state="idle">
  <ol class="machine-flow" aria-label="Verified cleanup workflow">
    <li data-machine-step="1">Diff in</li>
    <li data-machine-step="2">Temporary worktrees</li>
    <li data-machine-step="3">Rerun tests</li>
    <li data-machine-step="4">Removal patch</li>
    <li data-machine-step="5">Cleanup receipt</li>
  </ol>
</section>
```

The full section also contains short terminal bursts, one removed candidate, one kept candidate, and the five safety statements from the design spec. CSS uses `--machine-progress` and active step classes; `initVerificationMachine()` observes the section once and activates it without hiding resting content.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- --run tests/unit/demo-assets.test.ts`

Expected: PASS.

### Task 2: Demo Narrative Entry

**Files:**
- Modify: `tests/unit/demo-assets.test.ts`
- Modify: `demo/index.html`
- Modify: `demo/styles.css`

- [x] **Step 1: Write the failing demo-entry test**

Require a visible `30-Second Demo` heading, the three supported input paths (`Sample diff`, `Paste diff`, `Public GitHub PR URL`), preview/CLI boundary copy, and an `Open the demo` link targeting `#workspace-controls`.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --run tests/unit/demo-assets.test.ts`

Expected: FAIL because the workspace has no narrative demo entry.

- [x] **Step 3: Add the demo entry without duplicating parser controls**

Add a compact introduction at the start of `#workspace`, give the existing controls `id="workspace-controls"`, and link to them. Keep the existing sample/paste/public-PR controls and all current DOM IDs unchanged so `demo/app.js` continues to work.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- --run tests/unit/demo-assets.test.ts`

Expected: PASS.

### Task 3: Reviewer Artifacts With Real Proof Media

**Files:**
- Modify: `tests/unit/demo-assets.test.ts`
- Modify: `tests/e2e/demo-server.test.ts`
- Modify: `scripts/demo-server-lib.mjs`
- Modify: `demo/index.html`
- Modify: `demo/styles.css`

- [x] **Step 1: Write failing asset and server tests**

The unit test requires `#reviewer-artifacts`, all five `.patchdiet/*` artifact names, and an `<img>` sourced from `/docs/assets/launch-gif/browser-frames/frame-03-candidates-card.png`. The server test requests that path and expects HTTP 200 with `image/png`.

- [x] **Step 2: Run both tests and verify the server assertion fails**

Run: `npx vitest run tests/unit/demo-assets.test.ts tests/e2e/demo-server.test.ts`

Expected: FAIL because the server currently allows only `demo/` and `examples/`.

- [x] **Step 3: Expose only the existing proof-assets directory**

Add `join(root, "docs", "assets")` to the server's allowlist. Do not expose all docs or arbitrary repository files. Add the artifacts section with the real screenshot, a faithful receipt panel, and exact artifact paths:

```text
.patchdiet/report.github.md
.patchdiet/removal.patch
.patchdiet/reduced.patch
.patchdiet/candidates.json
.patchdiet/diet-card.svg
```

- [x] **Step 4: Run both tests and verify they pass**

Run: `npx vitest run tests/unit/demo-assets.test.ts tests/e2e/demo-server.test.ts`

Expected: PASS.

### Task 4: Integrations, Team Direction, and Final CTA

**Files:**
- Modify: `tests/unit/demo-assets.test.ts`
- Modify: `demo/index.html`
- Modify: `demo/styles.css`
- Modify: `demo/app.js`

- [x] **Step 1: Write the failing closing-sections test**

Require `#workflow-integrations`, `#team-direction`, and `#final-cta` in order after artifacts; require CLI, GitHub Action, GitHub App direction, VS Code extension direction, all four allowed team-direction messages, both final CTAs, and the exact install/build/shrink command.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --run tests/unit/demo-assets.test.ts`

Expected: FAIL because the closing sections are absent.

- [x] **Step 3: Implement the quiet adoption close**

Use an unframed integrations band, a restrained team-direction grid with explicit `Direction` labels, and a full-width final CTA. Add a copy button wired through the existing clipboard helper pattern, with a dedicated live status element. Do not claim billing, customers, revenue, Marketplace availability, or semantic equivalence.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- --run tests/unit/demo-assets.test.ts`

Expected: PASS.

### Task 5: Scroll Progress and Reduced Motion

**Files:**
- Modify: `tests/unit/demo-assets.test.ts`
- Modify: `demo/styles.css`
- Modify: `demo/app.js`

- [x] **Step 1: Write the failing behavior contract test**

Require `IntersectionObserver`, a passive scroll listener that updates `--scene-progress`, static fallbacks when observers are unavailable, and a reduced-motion branch that marks all narrative scenes active immediately.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --run tests/unit/demo-assets.test.ts`

Expected: FAIL because the cinematic sections currently rely only on looping CSS animation.

- [x] **Step 3: Implement progressive scene motion**

Create `initNarrativeScenes()` and `updateSceneProgress()` using existing DOM nodes. Transform only decorative layers; never move reading text. CSS must provide visible idle/resting layouts and disable transitions, transforms, ambient sweeps, and looping animations under `prefers-reduced-motion: reduce`.

- [x] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- --run tests/unit/demo-assets.test.ts`

Expected: PASS.

### Task 6: Full Verification and Visual QA

**Files:**
- Modify if needed: `demo/index.html`
- Modify if needed: `demo/styles.css`
- Modify if needed: `demo/app.js`

- [x] **Step 1: Run automated verification**

Run: `npm run typecheck`

Expected: PASS with zero TypeScript errors.

Run: `npm test`

Expected: PASS with zero failed tests.

Run: `npm run build`

Expected: PASS and produce the CLI/action outputs.

- [x] **Step 2: Start the local demo server**

Run: `npm run demo`

Expected: server listens on `http://127.0.0.1:4173/demo/` or the next available port.

- [x] **Step 3: Inspect desktop and mobile views**

Capture and inspect at least `1440x900`, `1024x768`, and `390x844`. Verify: first viewport contains proof and CTA; every section is readable at rest; no horizontal overflow; controls and headings do not overlap; the proof image loads; the demo still analyzes the bundled sample; final CTA is visible; reduced-motion mode has no hidden content.

- [x] **Step 4: Re-read the design spec and check every required section**

Map each of the nine page sections and all five content boundaries to visible page content. Fix any gap, rerun the focused test, and repeat the affected viewport capture.
