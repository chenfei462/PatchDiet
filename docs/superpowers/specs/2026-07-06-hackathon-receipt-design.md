# Hackathon Receipt Loop Design

## Goal

Make PatchDiet feel hackathon-ready by turning the current product surface into a tight, practical loop: a judge understands the value in 30 seconds, a developer can verify it with one command, and a reviewer gets a shareable receipt.

## Recommended Direction

The winning story is **the trustworthy cleanup receipt for AI-generated PRs**.

PatchDiet should not compete as another AI reviewer. Its sharper position is: AI agents create broad PRs, PatchDiet shrinks the review surface locally, and every verified removal is backed by the user's own checks.

## Experience

The demo should open on the sample result, not on a blank form. The first viewport should communicate:

- `AI wrote 33 changed lines. Review 14.`
- `5 files -> 2 files`
- `4m estimated human attention saved`
- three visible candidates: `README.md`, `docs/agent-plan.md`, and `dist/cart.generated.js`
- a visible CLI proof command: `patchdiet shrink --test "npm test"`
- a Diet Card receipt that is easy to screenshot

Raw diff input, pasted diffs, and public PR URL fetching remain available, but they are supporting controls rather than the center of the first impression.

## Trust Boundary

The browser demo is preview-only. It parses a diff and flags likely review noise with local heuristics. It must not imply tests have run.

The verified path is the CLI or Action path. `patchdiet shrink` runs in temporary git worktrees and keeps removals only when configured checks still pass. PatchDiet still does not prove semantic equivalence, and reports must say so clearly.

## Implementation Scope

1. Add a reusable verified receipt summary for shrink reports.
2. Show that receipt in CLI, Markdown, HTML, and GitHub comment output.
3. Generate `.patchdiet/diet-card.svg` by default after non-dry-run shrink.
4. Polish demo layout into a results-first, screenshot-friendly Judge Mode screen.
5. Replace corrupted CLI status glyphs with ASCII status labels.
6. Align docs, launch script, storyboard, and sample case study around one consistent sample story.

## Out Of Scope

- Cloud runners, queues, billing, SSO, team dashboards, or Pro workflows.
- LLM-assisted ranking as a required demo path.
- Automatic PR branch mutation by default.
- Productionizing the GitHub App or VS Code extension beyond existing scaffolds.

## Verification

The implementation is complete when:

- Unit tests cover preview and verified receipt summaries.
- Report tests verify receipt content and safety language.
- CLI e2e tests verify default Diet Card generation and clean ASCII output.
- Demo asset tests verify results-first markup, visible copy command, and visible candidate receipts.
- `npm run typecheck` passes.
- Focused tests for insights, reports, Diet Card, CLI, and demo pass.

