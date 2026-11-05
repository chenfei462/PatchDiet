# Hackathon Judge Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing PatchDiet demo and launch docs into a hackathon-ready "Live PR Liposuction + Verified Cleanup Receipt" experience.

**Architecture:** Keep the browser demo preview honest: the web layer may dramatize the Judge Mode story, but it must label heuristic suggestions as a preview and point to `patchdiet shrink` for test-verified decisions. Shared insight fields live in `packages/core/src/insights.ts` and are mirrored in `demo/insights.mjs` for the static demo.

**Tech Stack:** TypeScript core insight helpers, Vitest unit tests, static HTML/CSS/JS demo, Markdown launch docs.

---

### Task 1: Judge Mode Data Contract

**Files:**
- Modify: `tests/unit/insights.test.ts`
- Modify: `packages/core/src/insights.ts`
- Modify: `demo/insights.mjs`

- [x] **Step 1: Write the failing test**

Add assertions that `analyzeDiffPreview()` exposes a `judgeMode` object with `headline`, `hook`, `verificationReceipt`, `reviewNoiseRemovedPercent`, `humanAttentionSavedMinutes`, and `cliProofCommand`.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run tests/unit/insights.test.ts`
Expected: FAIL because `preview.judgeMode` is undefined.

- [x] **Step 3: Implement the minimal insight fields**

Add the `JudgeModeSummary` interface, compute it from existing preview metrics, and mirror the same fields in `demo/insights.mjs`.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `npx vitest run tests/unit/insights.test.ts`
Expected: PASS.

### Task 2: Surgery Mode Demo UI

**Files:**
- Modify: `demo/index.html`
- Modify: `demo/app.js`
- Modify: `demo/styles.css`

- [x] **Step 1: Add markup for the hero receipt**

Add a `section` near the top of the results panel with the headline "Live PR Liposuction", before/after line count, review-noise percent, human attention saved, and CLI proof command.

- [x] **Step 2: Render Judge Mode data**

Update `render()` to fill the new receipt fields from `preview.judgeMode`.

- [x] **Step 3: Add per-candidate receipts**

Update `renderSuggestion()` so every suggested deletion includes "Verified path: run patchdiet shrink to keep only removals where tests still pass" and a short command-style receipt.

- [x] **Step 4: Style the experience**

Add CSS that makes the receipt feel like a surgical control surface without hiding inputs or breaking mobile layout.

### Task 3: Hackathon Script Documentation

**Files:**
- Modify: `docs/demo.md`
- Modify: `docs/launch-materials.md`
- Modify: `docs/assets/launch-gif/storyboard.md`

- [x] **Step 1: Add the one-minute hackathon script**

Document the sequence: hook, browser demo, CLI proof, Diet Card/GitHub comment close.

- [x] **Step 2: Add honest claim boundaries**

Document that the browser demo is preview-only while the CLI path is test-verified.

- [x] **Step 3: Update the GIF storyboard**

Make Judge Mode and Verified Cleanup Receipt the central recorded beats.

### Task 4: Verification

**Files:**
- No direct source edits unless verification finds an issue.

- [x] **Step 1: Run unit insight tests**

Run: `npx vitest run tests/unit/insights.test.ts`
Expected: PASS.

- [x] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [x] **Step 3: Run demo server test**

Run: `npx vitest run tests/e2e/demo-server.test.ts`
Expected: PASS.

- [x] **Step 4: Run full test suite if targeted checks pass**

Run: `npm test`
Expected: PASS, or report any pre-existing unrelated failures with evidence.
