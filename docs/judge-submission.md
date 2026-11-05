# Judge Submission Pack

Lead with proof, then explain the workflow boundary.

1. **Result first:** `agent-large-pr` shrinks `4 files / 128 changed lines -> 2 files / 32 changed lines`, a `75% changed-line reduction`, with `node --test` passing.
2. **Browser preview:** the 30-second demo sample shows `5 files / 33 lines -> 2 files / 14 lines`, `58% review noise removed`, `4m estimated attention saved`.
3. **CLI verified proof:** Browser previews likely noise; CLI verifies removals by rerunning tests.
4. **Reviewer artifact:** PatchDiet emits `.patchdiet/report.github.md`, `.patchdiet/report.html`, `.patchdiet/removal.patch`, `.patchdiet/candidates.json`, and `.patchdiet/diet-card.svg`.
5. **Commercial close:** PatchDiet is the local-first cleanup layer for oversized AI-generated PRs; it is not an AI reviewer, semantic equivalence proof, code-quality judge, or replacement for human review.

## 60-Second Intro

AI coding agents are good at getting tests green, but they often leave humans with a noisy pull request: docs scraps, generated files, unused helpers, and scope creep mixed with the real change.

PatchDiet runs after AI coding and before human review. It reads the diff, tries conservative cleanup in temporary git worktrees, reruns the user's test command, and emits a cleanup patch plus a Diet Card receipt. The pitch is simple: do not ask reviewers to inspect code that tests say can be removed.

## 90-Second Pitch Script

0:00-0:15 - Result first. Lead with the verified `agent-large-pr` receipt: `4 files / 128 changed lines -> 2 files / 32 changed lines`, `75% changed-line reduction`, `node --test` passing.

0:15-0:35 - Browser preview. Run `npm run demo`, open `http://127.0.0.1:4173/demo/`, and show the sample: `5 files / 33 lines -> 2 files / 14 lines`, `58% review noise removed`, `4m estimated attention saved`.

0:35-0:55 - CLI verified proof. Say: "Browser previews likely noise; CLI verifies removals by rerunning tests." Copy the verified CLI command as the proof handoff, then show the local CLI path.

0:55-1:15 - Reviewer artifact. Show `.patchdiet/report.github.md`, `.patchdiet/removal.patch`, `.patchdiet/candidates.json`, and `.patchdiet/diet-card.svg` as the cleanup receipt a reviewer can inspect.

1:15-1:30 - Commercial close. PatchDiet is the local-first cleanup layer for oversized AI-generated PRs: less review noise, verified by the checks teams already run.

## 5-Minute Pitch Script

0:00-0:30 - Result first. Lead with the verified `agent-large-pr` receipt: `4 files / 128 changed lines -> 2 files / 32 changed lines`, `75% changed-line reduction`, `node --test` passing.

0:30-1:15 - Browser preview. Run `npm run demo`, open `http://127.0.0.1:4173/demo/`, and show the 30-second sample: `5 files / 33 lines -> 2 files / 14 lines`, `58% review noise removed`, `4m estimated attention saved`.

1:15-2:30 - CLI verified proof. Say: "Browser previews likely noise; CLI verifies removals by rerunning tests." Run the local CLI against a real git diff. PatchDiet creates temporary worktrees, reverses candidate noise, reruns the configured checks, and writes `.patchdiet/` artifacts only after verification.

2:30-3:30 - Reviewer artifact. Show `.patchdiet/report.github.md`, `.patchdiet/report.html`, `.patchdiet/removal.patch`, `.patchdiet/candidates.json`, and `.patchdiet/diet-card.svg`. The reviewer sees what was removed, what stayed, and what still needs human review.

3:30-5:00 - Commercial close. PatchDiet is a test-verified cleanup receipt for teams adopting AI coding agents: local-first, no source upload by default, no LLM required by default, and compatible with CLI, CI, and future GitHub App distribution. It is not a semantic equivalence proof, code-quality judge, or replacement for human review.

## Demo Commands

Local web demo:

```bash
npm ci
npm run build
npm run demo
```

Open `http://127.0.0.1:4173/demo/`.

Local CLI proof from this repository:

```bash
npm ci
npm run build
node dist/packages/cli/src/index.js doctor
node dist/packages/cli/src/index.js shrink --test "npm test"
```

Local tarball proof from another repository:

```bash
git clone https://github.com/chenfei462/PatchDiet.git
cd PatchDiet
npm ci
npm run build
npm pack
npm install -g ./patchdiet-*.tgz
```

Then, in the target repository:

```bash
patchdiet doctor
patchdiet check
patchdiet shrink --base origin/main --head HEAD --test "npm test"
```

## CLI Proof Commands

Use these when a judge asks whether the browser demo is backed by real cleanup mechanics:

```bash
node dist/packages/cli/src/index.js shrink --base origin/main --head HEAD --test "npm test"
node dist/packages/cli/src/index.js report --format github
node dist/packages/cli/src/index.js card --project "PatchDiet demo" --format svg --output .patchdiet/diet-card.svg
```

For the included reproducible fixtures:

```bash
npm run bench:examples
```

That writes local fixture artifacts under `.patchdiet/example-benchmarks/`.
The primary verified judge proof case is `agent-large-pr`: `4 files / 128 changed lines -> 2 files / 32 changed lines`, `75% changed-line reduction`, with `node --test` passing.

## Assets To Show

- Web demo: `http://127.0.0.1:4173/demo/`
- Sample diff: `examples/sample-pr.diff`
- Case study: `docs/case-studies/sample-cart-pr.md`
- Larger case study: `docs/case-studies/agent-large-pr.md`
- GIF storyboard: `docs/assets/launch-gif/patchdiet-launch.gif`
- Demo-flow GIF: `docs/assets/launch-gif/patchdiet-demo-flow.gif`
- Diet Card output: `.patchdiet/diet-card.svg`
- Reviewer report: `.patchdiet/report.github.md` and `.patchdiet/report.html`
- Candidate proof: `.patchdiet/candidates.json`
- Larger fixture proof: `.patchdiet/example-benchmarks/agent-large-pr/report.md`

## Judge FAQ

**Is this an AI reviewer?** No. PatchDiet does not approve code or judge quality. It removes candidate noise only when configured checks still pass, then gives humans the receipt.

**What if tests are weak?** Then the guarantee is weak. PatchDiet proves only that the cleanup preserved the user's configured checks, not semantic equivalence.

**Does source code leave my machine?** Not by default. The local CLI uses git diffs, temporary worktrees, and local commands. The browser demo parses a pasted diff locally.

**Can it delete important code?** It can propose or verify removals within the limits of the test suite. Changed tests and risky paths are kept for human review by default.

**Is npm install live today?** Treat npm as a release checklist item until `npm view patchdiet version` returns the intended version and `npm exec -- patchdiet --help` works. Use local dist CLI or tarball proof for judging.

**Is the GitHub Marketplace app live today?** Treat Marketplace as a release checklist item until the external listing is submitted and install-tested. The repository contains the app skeleton and listing package.

## Risk Boundaries

- PatchDiet is not a semantic equivalence proof.
- PatchDiet is not a security reviewer.
- PatchDiet is not a replacement for human review.
- Browser demo mode is preview-only and does not run tests; it highlights likely review noise for the 30-second sample.
- CLI verified mode depends on the chosen test command; removals only count when checks still pass in temporary git worktrees.
- `--create-branch` and `--apply` are the opt-in branch-writing actions. Both are off by default.

## Offline Fallback

If networking, npm publishing, GitHub auth, or Marketplace access fails during judging:

1. Run `npm run demo` and use the bundled `examples/sample-pr.diff`.
2. Run `node dist/packages/cli/src/index.js doctor` after `npm run build`.
3. Use `npm pack` plus `npm install -g ./patchdiet-*.tgz` to prove the package installs locally.
4. Show `.patchdiet/report.github.md`, `.patchdiet/report.html`, `.patchdiet/candidates.json`, and `.patchdiet/diet-card.svg` from the local CLI run.

## Release Checklist

- Publish the npm package and verify `npm view patchdiet version`.
- Verify `npm exec -- patchdiet --help` in a clean project.
- Submit the GitHub Marketplace listing with logo, screenshots, GIF, permissions, privacy, support, and terms links.
- Install-test the GitHub App in a test organization.
- Update README install commands only after external publishing is confirmed.
