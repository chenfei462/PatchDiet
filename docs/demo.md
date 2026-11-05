# Web Demo

The Web demo is the first 30-second PatchDiet experience. It avoids GitHub credentials and test setup so a new user can understand the value before installing anything globally.

## Run

```bash
npm ci
npm run build
npm run demo
```

Open:

```text
http://127.0.0.1:4173/demo/
```

## What It Shows

- The sample result is already loaded when the page opens.
- Reset `examples/sample-pr.diff` after experimenting with another diff.
- Fetch a public GitHub PR diff with `/api/pr?url=https://github.com/owner/repo/pull/123`
- Before/after files, hunks, and changed lines
- Suggested deletion hunks
- Estimated review-time savings
- Judge Mode / Live PR Liposuction receipt
- Preview Receipt -> Verified Proof loop
- Diet Card preview

30-second preview sample receipt: `5 files / 33 lines -> 2 files / 14 lines`, `58% review noise removed`, `4m estimated attention saved`.

This browser sample is the fast preview path. The primary verified proof for judges is `agent-large-pr`: `4 files / 128 changed lines -> 2 files / 32 changed lines`, `75% changed-line reduction`, with `node --test` passing.

## 90-Second Pitch Demo

Opening line:

```text
AI wrote the first draft. PatchDiet helps humans review less of it.
```

1. **0:00-0:15 - Result first:** Lead with the verified `agent-large-pr` receipt: `4 files / 128 changed lines -> 2 files / 32 changed lines`, `75% changed-line reduction`, `node --test` passing.
2. **0:15-0:35 - Browser preview:** Run `npm run demo`; the sample is already loaded: `5 files / 33 lines -> 2 files / 14 lines`, `58% review noise removed`, `4m estimated attention saved`.
3. **0:35-0:55 - CLI verified proof:** Say: "Browser previews likely noise; CLI verifies removals by rerunning tests." Click **Copy verified CLI command** as the proof handoff, then show `patchdiet shrink --test "npm test"`.
4. **0:55-1:15 - Reviewer artifact:** Show the report, cleanup patch, Diet Card, and evidence report as the cleanup receipt a reviewer can inspect.
5. **1:15-1:30 - Commercial close:** PatchDiet is the local-first cleanup layer for oversized AI-generated PRs: less review noise, verified by the checks teams already run.

## One-Minute Hackathon Script

1. **0:00-0:10 - Hook:** "AI wrote the first draft. PatchDiet helps humans review less of it." Start on the verified `agent-large-pr` proof: `4 files / 128 changed lines -> 2 files / 32 changed lines`, `75% changed-line reduction`, `node --test` passing.
2. **0:10-0:25 - Browser demo:** Open the sample-loaded demo and point at Judge Mode: `5 files / 33 lines -> 2 files / 14 lines`, `58% review noise removed`, `4m estimated attention saved`.
3. **0:25-0:38 - Candidate receipt:** Open deletion candidates and read the boundary: "Verified path: run patchdiet shrink to keep only removals where tests still pass."
4. **0:38-0:50 - CLI proof:** Click **Copy verified CLI command** and say: "Browser previews likely noise; CLI verifies removals by rerunning tests."
5. **0:50-1:00 - Receipt close:** Show the report, Diet Card, and GitHub comment direction as the Verified Cleanup Receipt reviewers can inspect.

## 5-Minute Operator Script

Use the same five beats as the 90-second pitch, with more proof detail:

1. Run `npm run demo` and open `http://127.0.0.1:4173/demo/`.
2. Lead with `agent-large-pr`: `4 files / 128 changed lines -> 2 files / 32 changed lines`, `75% changed-line reduction`, `node --test` passing.
3. Show the browser sample: `5 files / 33 lines -> 2 files / 14 lines`, `58% review noise removed`, `4m estimated attention saved`.
4. Point to Judge Mode: review noise removed, human attention saved, and the verified CLI command.
5. Say: "Browser previews likely noise; CLI verifies removals by rerunning tests."
6. Open the deletion candidates and say: "PatchDiet is not judging taste. It is finding likely review noise: docs churn, generated files, abandoned helper code, and scope creep."
7. Click **Copy verified CLI command** and paste the command into the terminal handoff.
8. Transition to CLI: `patchdiet shrink --test "npm test"`.
9. Show `.patchdiet/report.github.md`, `.patchdiet/cleanup.diff`, `.patchdiet/report.md`, `.patchdiet/run.json`, and `.patchdiet/diet-card.svg`.
10. Close on the commercial frame: every AI coding tool can create bigger patches; PatchDiet gives teams a verified cleanup receipt before human review.

Offline fallback if the terminal path is risky during the recording: show the pre-generated `.patchdiet/report.github.md` and `.patchdiet/diet-card.svg` after copying the verified CLI command.

## What It Does Not Claim

The demo is preview-only. It uses local heuristics for docs/generated-like files so the product story is instant. Browser previews likely noise; CLI verifies removals by rerunning tests. Test-verified cleanup still requires:

```bash
patchdiet shrink --test "npm test"
```

That CLI path writes `.patchdiet/cleanup.diff`, `.patchdiet/report.md`, `.patchdiet/report.html`, `.patchdiet/run.json`, `.patchdiet/report.github.md`, and (when `report.evidence` is on) `.patchdiet/evidence.md`.

## Reproducible JS/TS/Python Demo Path

The three committed example scenarios cover the language triple and run end-to-end locally with no network access and no credentials. Each is a fixture, not a market-result claim.

```bash
npm ci
npm run build
npm run bench:examples
```

This runs the benchmark harness (`scripts/run-example-benchmarks.mjs`) over every scenario in `examples/` and writes per-scenario receipts under `.patchdiet/example-benchmarks/<name>/report.md`:

- `examples/agent-large-pr/` — JavaScript: a small cart-pricing change plus committed planning notes and generated output. Receipt: `4 files / 128 changed lines -> 2 files / 32 changed lines`, `node --test` passing.
- `examples/ts-bloated-pr/` — TypeScript: the canonical bloated-PR demo with unrelated agent files mixed into a focused change.
- `examples/python-agent-refactor/` — Python: a required feature change plus unrelated agent files, verified with pytest.

To inspect one scenario's receipt after the run:

```bash
cat .patchdiet/example-benchmarks/agent-large-pr/report.md
```

For a single-language manual walkthrough instead of the batch harness, run the CLI directly against a scenario checkout:

```bash
patchdiet shrink --base <base-ref> --head HEAD --test "node --test"   # JS scenarios
patchdiet shrink --base <base-ref> --head HEAD --test "pytest"        # Python scenarios
```

`npm run bench:cli-v02` runs the v0.2 labelled benchmark suite (`benchmarks/run-benchmark.mjs`). It owns an independent 16-case labelled corpus (synthetic adversarial and injected fixtures — not the `examples/` demo scenarios above) and writes per-case JSON reports plus a `summary.json` under `benchmarks/results/<stamp>/`; the corpus composition, gates, and output artifacts are described in [`benchmarks/README.md`](../benchmarks/README.md). The browser preview (`npm run demo`) and the CLI path share the same boundary: the browser previews likely noise, and only the CLI path verifies removals by rerunning tests.

## Public PR URL Fetch

The local demo server includes a lightweight backend:

```text
GET /api/pr?url=https://github.com/octocat/Hello-World/pull/6
```

It fetches the pull request diff using GitHub's public API and `application/vnd.github.diff`. Set `GITHUB_TOKEN` to raise API rate limits.

## Hosted Demo Backlog

1. Deploy the backend endpoint.
2. Add rate limits by IP and repository.
3. Return preview metrics immediately.
4. Offer a "run verified cleanup" path through the GitHub App.
