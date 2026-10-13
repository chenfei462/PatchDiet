# Hackathon Receipt Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn PatchDiet into a hackathon-ready Judge Mode + Verified Cleanup Receipt loop that is striking, truthful, useful, and easy to demo.

**Architecture:** Keep preview and verified paths separate. `packages/core/src/insights.ts` owns shared review metrics plus preview/verified receipt summaries. `packages/report/src/index.ts` renders the verified receipt into reports. `packages/cli/src/index.ts` writes reports, a default Diet Card SVG, and clean ASCII summaries. The static demo mirrors preview fields through `demo/insights.mjs` and presents the sample result first.

**Tech Stack:** TypeScript, Vitest, Commander CLI, static HTML/CSS/JS demo, Markdown docs.

---

### Task 1: Verified Receipt Contract

**Files:**
- Modify: `tests/unit/insights.test.ts`
- Modify: `packages/core/src/insights.ts`

- [x] **Step 1: Write the failing test**

Add a test that imports `buildVerifiedReceiptSummary(report, { projectName: "sample-cart-pr" })` and asserts:

```ts
expect(receipt).toEqual({
  headline: "Verified Cleanup Receipt",
  hook: "Tests still pass. Review less diff.",
  verificationStatus: "verified",
  projectName: "sample-cart-pr",
  reviewNoiseRemovedPercent: 60,
  humanAttentionSavedMinutes: expect.any(Number),
  testCommand: "npm test",
  testStatus: "passed",
  removedCount: 1,
  keptCount: 0,
  needsReviewCount: 0,
  safetyNote:
    "PatchDiet only proves that the cleanup patch passes your configured checks. It is not a semantic-equivalence proof.",
  dietCardPath: ".patchdiet/diet-card.svg"
});
```

- [x] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/unit/insights.test.ts
```

Expected: FAIL because `buildVerifiedReceiptSummary` is not exported.

- [x] **Step 3: Implement minimal receipt summary**

Add `VerifiedReceiptSummary` and `buildVerifiedReceiptSummary()` in `packages/core/src/insights.ts`. Reuse `buildReviewMetrics()`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run tests/unit/insights.test.ts
```

Expected: PASS.

### Task 2: Report And CLI Receipt

**Files:**
- Modify: `tests/unit/report.test.ts`
- Modify: `tests/e2e/cli.test.ts`
- Modify: `packages/report/src/index.ts`
- Modify: `packages/cli/src/index.ts`

- [x] **Step 1: Write failing report assertions**

Assert Markdown, HTML, and GitHub comment include:

```text
Verified Cleanup Receipt
Tests still pass. Review less diff.
Diet Card: .patchdiet/diet-card.svg
not a semantic-equivalence proof
```

- [x] **Step 2: Write failing CLI assertions**

In the shrink e2e test, assert:

```ts
expect(result.stdout).toContain("Verified receipt:");
expect(result.stdout).toContain("Diet Card: .patchdiet/diet-card.svg");
expect(result.stdout).not.toMatch(/[鉁鈿]/);
expect(readFileSync(join(dir, ".patchdiet", "diet-card.svg"), "utf8")).toContain("Saved");
```

- [x] **Step 3: Verify RED**

Run:

```bash
npx vitest run tests/unit/report.test.ts tests/e2e/cli.test.ts --testNamePattern "renders a github comment body|runs shrink with detected base"
```

Expected: FAIL on missing receipt and Diet Card assertions.

- [x] **Step 4: Implement report receipt**

Use `buildVerifiedReceiptSummary()` in `packages/report/src/index.ts`. Add a compact receipt section to Markdown, HTML, and GitHub comment output.

- [x] **Step 5: Implement CLI receipt and Diet Card**

In non-dry-run `shrink`, write `.patchdiet/diet-card.svg` with `buildDietCardModel()` and `renderDietCardSvg()`. Add it to stdout and report artifacts. Replace corrupted `doctor` and `shrink` glyphs with ASCII labels such as `[ok]`, `[fail]`, and `[warn]`.

- [x] **Step 6: Verify GREEN**

Run:

```bash
npx vitest run tests/unit/report.test.ts tests/e2e/cli.test.ts --testNamePattern "renders a github comment body|runs shrink with detected base"
```

Expected: PASS.

### Task 3: Results-First Demo

**Files:**
- Modify: `tests/unit/demo-assets.test.ts`
- Modify: `demo/index.html`
- Modify: `demo/app.js`
- Modify: `demo/styles.css`

- [x] **Step 1: Write failing demo asset assertions**

Assert the static demo contains:

```text
AI wrote 33 changed lines. Review 14.
Copy CLI proof command
View raw diff
Fetch public PR
data-copy-command
data-proof-copy-status
```

Assert `demo/app.js` visibly renders candidate receipts and copies `preview.judgeMode.cliProofCommand`.

- [x] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/unit/demo-assets.test.ts
```

Expected: FAIL on missing markup/copy behavior.

- [x] **Step 3: Implement markup and behavior**

Make the first viewport results-first. Keep the sample auto-loaded. Rename the sample button to `Reset sample`. Add `Copy CLI proof command`; add `Fetch public PR` with loading/disabled state; wrap raw diff in `details`.

- [x] **Step 4: Implement CSS**

Use an industrial receipt/control-room aesthetic. Avoid text overlap at 1366x768 and 375px widths. Keep raw diff secondary, reduce mobile textarea height, and make candidate receipts visible without hover.

- [x] **Step 5: Verify GREEN**

Run:

```bash
npx vitest run tests/unit/demo-assets.test.ts tests/e2e/demo-server.test.ts
```

Expected: PASS.

### Task 4: Launch Docs And Case Study

**Files:**
- Modify: `README.md`
- Modify: `docs/demo.md`
- Modify: `docs/launch-materials.md`
- Modify: `docs/assets/launch-gif/storyboard.md`
- Create: `docs/case-studies/sample-cart-pr.md`

- [x] **Step 1: Update docs with one sample story**

Use consistent sample numbers: `5 files / 33 lines -> 2 files / 14 lines`, `58% review noise removed`, `4m estimated attention saved`.

- [x] **Step 2: Add PatchDiet is/is-not positioning**

Add a short README section explaining PatchDiet is a local-first cleanup receipt, not a semantic equivalence prover, AI reviewer, or auto-merge bot.

- [x] **Step 3: Add case study**

Document the sample diff, demo path, CLI proof command, artifacts, and safety boundary in `docs/case-studies/sample-cart-pr.md`.

- [x] **Step 4: Verify docs**

Run:

```bash
rg -n "<old-sample-metric>|<old-demo-headline>|<old-click-first-script>" README.md docs demo
```

Expected: no stale references.

### Task 5: Final Verification

**Files:**
- No direct source edits unless verification finds issues.

- [x] **Step 1: Run focused unit tests**

```bash
npx vitest run tests/unit/insights.test.ts tests/unit/report.test.ts tests/unit/diet-card.test.ts tests/unit/demo-assets.test.ts
```

- [x] **Step 2: Run focused e2e tests**

```bash
npx vitest run tests/e2e/cli.test.ts tests/e2e/demo-server.test.ts
```

- [x] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [x] **Step 4: Run full suite if focused checks pass**

```bash
npm test
```

Expected: PASS, or report any pre-existing unrelated failures with exact evidence.
