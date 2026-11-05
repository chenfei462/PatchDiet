# Launch Materials

These drafts are written around contrast, reviewer time, and PR noise. Use the verified case-study numbers below when posting to judges or investors.

Primary verified proof: `agent-large-pr` records `4 files / 128 changed lines -> 2 files / 32 changed lines`, `75% changed-line reduction`, with `node --test` passing.

30-second preview sample: the browser demo records `5 files / 33 lines -> 2 files / 14 lines`, `58% review noise removed`, `4m estimated attention saved`.

Browser preview highlights likely noise. CLI verified proof reruns checks in temporary git worktrees and only counts removals when checks still pass.

## Landing Hero

Headline:

```text
128 changed lines became 32. Tests still passed.
```

Subcopy:

```text
PatchDiet is the PR cleanup layer after AI coding. In the verified `agent-large-pr` fixture, it shrank `4 files / 128 changed lines -> 2 files / 32 changed lines`, a `75% changed-line reduction`, with `node --test` passing.
```

Primary CTA:

```text
Try the 30-second diff demo
```

Secondary CTA:

```text
Review the release checklist
```

## Hacker News

```text
Show HN: PatchDiet - verified cleanup for AI-generated PRs

I built PatchDiet because coding agents are getting good at making tests pass, but they still leave reviewers with huge PRs full of docs noise, generated artifacts, abandoned helper code, and scope creep.

PatchDiet takes a diff, tries conservative removals in temporary git worktrees, reruns your checks, and emits a smaller cleanup patch plus a report. The 30-second demo lets you paste a diff and see before/after files, lines, suggested deletion hunks, and estimated review-time savings without configuring GitHub.

Default mode is local-only and no-upload. The product pitch is simpler: fewer lines to review.
```

## Reddit

```text
I made a PR cleanup tool for the "agent passed tests but the PR is huge" problem

PatchDiet runs after AI-generated code is written. It looks at a PR diff, finds likely review noise, and in CLI mode only removes hunks when your test command still passes. The new demo is intentionally low-friction: paste a diff, see before/after, then decide if you want the CLI/GitHub App path.

Preview sample: 5 files / 33 lines -> 2 files / 14 lines, 58% review noise removed, 4m estimated attention saved, docs/generated noise called out before review. The verified proof is the CLI `agent-large-pr` fixture: 4 files / 128 changed lines -> 2 files / 32 changed lines, 75% changed-line reduction, node --test passing.

I would love feedback on false-positive risk, GitHub App permissions, and what review metrics would actually be useful to teams.
```

## X Thread

```text
1/ Verified proof: 128 changed lines became 32, with node --test still passing.

2/ PatchDiet is the cleanup layer after AI coding: it finds review noise after tests pass and turns a bloated agent PR into a smaller cleanup patch.

3/ Default mode is local-only: no source upload, no LLM required, no branch rewrite. It uses git worktrees + your checks.

4/ New 30-sec preview: paste a diff, see 5 files / 33 lines -> 2 files / 14 lines, 58% review noise removed, and 4m estimated attention saved.

5/ Browser preview highlights likely noise. CLI verified proof reruns checks in temporary git worktrees and only counts removals when checks still pass.

6/ Next: GitHub App comments, VS Code extension, Diet Cards, and larger public case studies.
```

## Hackathon Talk Track

One-minute hackathon script: hook on the verified `agent-large-pr` shrink, open Judge Mode, show the preview candidate receipts, copy the CLI proof command, then close on the Verified Cleanup Receipt artifacts.

```text
AI agents are great at making tests pass, but they often leave humans with too much PR to review.

PatchDiet starts with the primary verified proof: `agent-large-pr` shrank `4 files / 128 changed lines -> 2 files / 32 changed lines`, a `75% changed-line reduction`, with `node --test` passing.

First, Judge Mode shows the idea in 30 seconds. The sample result opens already loaded: 5 files / 33 lines -> 2 files / 14 lines, 58% review noise removed, 4m estimated attention saved, deletion candidates, and a Diet Card preview.

Then the CLI proves the serious path. The local command `node dist/packages/cli/src/index.js shrink --test "npm test"` evaluates removals in temporary git worktrees and only treats cleanup as verified when the same checks still pass.

The close is the workflow: PatchDiet emits a report, a shareable Diet Card, and a GitHub-ready comment so reviewers see the smaller patch and the evidence behind it.
```

## 60-Second GIF Script

1. Open README hero: "128 changed lines became 32. Tests still passed."
2. Run `npm run demo`.
3. Browser opens local demo.
4. The sample receipt is already loaded.
5. Judge Mode animates visually: 58% review noise removed, 4m estimated attention saved, and CLI proof command.
6. Metrics show the reviewer path: `5 files / 33 lines -> 2 files / 14 lines`.
7. Scroll deletion candidates: `README.md`, `docs/agent-plan.md`, `dist/cart.generated.js`; each shows the preview-only receipt.
8. Show Diet Card preview.
9. Cut to CLI: `node dist/packages/cli/src/index.js shrink --test "npm test"` or the locally installed tarball command `patchdiet shrink --test "npm test"`.
10. Show `.patchdiet/report.html` and end on the GitHub App comment direction.

Generated local assets:

- `docs/assets/launch-gif/patchdiet-launch.gif`: generated storyboard animation
- `docs/assets/launch-gif/patchdiet-demo-flow.gif`: 60-second GIF built from real local demo screenshots
- `npm run gif:storyboard`: regenerates storyboard frames and `patchdiet-launch.gif`
- `npm run gif:demo-flow`: rebuilds `patchdiet-demo-flow.gif` from captured browser frames

## Screenshot List

- README first viewport
- demo after loading sample diff
- deletion candidates panel
- Diet Card SVG
- CLI shrink summary
- GitHub PR comment
- VS Code webview panel

## Release Checklist Copy

Use this when judges ask about distribution status:

```text
The hackathon proof path is local demo plus local CLI/tarball. npm publishing and GitHub Marketplace submission are release checklist items, not assumed live installs.
```
