# Compact Cinematic Homepage Design

## Goal

Shorten the PatchDiet homepage from roughly nine desktop viewports to four or five while preserving the verified-cleanup story, the real product proof, and an obvious path into the complete interactive demo.

The compact homepage must remain cinematic and memorable, but it should feel edited rather than exhaustive. A visitor should reach the final call to action without passing through repeated versions of the same proof.

## Root Cause

The current homepage renders all nine narrative sections and the complete interactive workspace in one continuous document. Several sections restate the same `128 -> 32`, configured-check, artifact, and human-review boundaries. The complete workspace is also the tallest single part of the page because it contains results, candidates, controls, raw diff input, and the Diet Card at once.

Reducing font size or vertical spacing alone would weaken readability without resolving the repeated information architecture.

## Target Length

- Desktop: four to five viewports at `1440x900` and `1024x768`.
- Mobile: seven to eight viewports at `390x844`.
- The first viewport must still reveal the beginning of the next proof band.
- No section should use a full viewport merely to restate a metric already visible above it.

## Architecture

Split the current experience into two pages:

1. `/demo/` remains the public cinematic homepage.
2. `/demo/workspace.html` becomes the complete interactive diff workspace.

The homepage uses the existing static HTML, CSS, product capture, and lightweight narrative motion. The workspace keeps the existing parser, public PR fetch, sample diff, candidate selection, copy commands, and Diet Card behavior.

The homepage does not duplicate parsing logic. Its demo band shows a faithful sample receipt and links to the complete workspace.

## Compact Homepage Structure

### 1. Hero and Proof Strip

Combine the current hero and proof strip into one first-viewport composition.

Keep:

- `128 changed lines became 32. Tests still passed.`
- `4 files -> 2 files`
- `75% changed-line reduction`
- `Verified fixture: agent-large-pr`
- Primary CTA to the complete demo workspace.
- Secondary CTA to the compact cleanup-proof band.
- The statement that configured checks are not semantic-equivalence proof.

Remove the separate post-hero proof section. Present its trust statement as the resting footer of the hero.

### 2. Cleanup Proof

Merge Before/After/Receipt and Verification Machine into one compact band.

Layout:

- A three-column Before/After/Receipt comparison on desktop and a stacked comparison on mobile.
- A compact five-step verification rail directly below the comparison:
  `Diff in -> Temporary worktrees -> Rerun tests -> Removal patch -> Cleanup receipt`.
- A short terminal receipt showing one passing removal and one failed candidate that is kept.

Keep all four trust points:

- Local-first and no source upload by default.
- No LLM required for verified cleanup.
- No branch rewrite by default.
- Candidate removal only counts when configured checks still pass.

The verification flow must not consume its own full-height scene.

### 3. 30-Second Demo Entry

Replace the embedded complete workspace with a compact demo entry.

Show:

- A faithful sample reduction receipt.
- `5 files / 33 lines -> 2 files / 14 lines`.
- `58% review noise removed`.
- The three entry paths: sample diff, pasted diff, and public GitHub PR URL.
- Preview/verification boundary copy.
- A primary `Open the full demo` link to `/demo/workspace.html`.

Do not render diff inputs, raw diff, full candidate lists, or all interactive workspace controls on the homepage.

### 4. Evidence and Adoption

Merge Reviewer Artifacts, Workflow Integrations, and Team Direction into one evidence band.

Show:

- The existing real product capture.
- The five `.patchdiet/*` artifact paths.
- Compact labels for CLI and GitHub Action availability.
- Explicit `Direction` labels for GitHub App, VS Code extension, and hosted/team capabilities.
- One concise team-direction statement instead of a separate team section.

Do not imply live customers, billing, revenue, Marketplace availability, or a hosted service.

### 5. Final CTA

Use a compact closing band rather than a full-height final scene.

Keep:

- `Try the 30-second diff demo` linking to `/demo/workspace.html`.
- `Run patchdiet shrink` copy action.
- The complete build and shrink command.
- The human-review and semantic-equivalence boundary.

Target approximately half a desktop viewport and a naturally sized mobile stack.

## Complete Workspace

Create `/demo/workspace.html` from the existing `#workspace` experience.

It must retain:

- Automatically loaded sample diff.
- Sample diff, pasted diff, and public PR URL flows.
- Public PR loading and error states.
- Reduction metrics and scan animation.
- Candidate strip and deletion candidate details.
- Diet Card preview.
- Raw diff disclosure.
- Verified CLI command copy action.
- Browser-preview versus CLI-verification boundary copy.

The workspace can reuse `demo/app.js` and the existing CSS. Homepage-only scripts must tolerate workspace elements being absent, and workspace scripts must tolerate homepage-only elements being absent.

## Motion

- Retain hero diff compression as the primary motion moment.
- Use one lightweight reveal for the compact cleanup proof.
- Do not give every remaining band a separate cinematic entrance.
- Keep all content visible without JavaScript.
- Preserve reduced-motion behavior.
- Do not move reading text during scroll.

## Responsive Behavior

### Desktop

- Hero and proof share the first viewport.
- Cleanup proof stays within one to one-and-a-half viewports.
- Evidence capture and artifact ledger remain side by side where space permits.
- Final CTA stays below one viewport.

### Mobile

- Hero keeps its compact background proof visual and reveals the next band.
- Before/After/Receipt stacks without large minimum heights.
- Verification steps become a compact vertical rail.
- Evidence capture remains full width.
- Integration and direction labels wrap without creating separate tall cards.

## Data and Navigation Flow

```text
Homepage hero
  -> Compact cleanup proof
  -> Sample demo receipt
  -> /demo/workspace.html
       -> sample / pasted diff / public PR URL
       -> browser preview
       -> CLI verification handoff

Homepage evidence
  -> artifact proof
  -> final CTA
  -> /demo/workspace.html or copied CLI command
```

## Error Handling

- The homepage must remain fully readable if JavaScript fails.
- Missing proof media must preserve its aspect ratio and alt text without collapsing the evidence band.
- The complete workspace retains its current empty diff, sample load, PR fetch, size-limit, and network error states.
- Clipboard failures show the command inline as the fallback.
- Direct navigation to `/demo/workspace.html` must work through the local demo server.

## Testing

Automated tests must verify:

- The homepage contains exactly five top-level narrative sections.
- The full interactive controls are absent from the homepage.
- The workspace route contains all existing control IDs expected by `demo/app.js`.
- Both routes load through the local demo server.
- Existing sample analysis and PR URL behavior still pass.
- Content boundaries remain visible on both routes.
- Reduced-motion styles remain present.
- Artifact media remains restricted to `docs/assets` in the server allowlist.

Visual verification must cover:

- `1440x900`
- `1024x768`
- `768x768`
- `390x844`

For each viewport, record total document height, horizontal overflow, first-viewport proof visibility, and any text or control overlap. The final homepage must meet the target-length range before completion.

## Success Criteria

- Desktop homepage length is four to five viewports.
- Mobile homepage length is seven to eight viewports.
- The full interactive demo remains available one click from the hero and demo-entry band.
- The `128 -> 32` verified proof remains visible in the first viewport.
- Engineers can still find configured-check mechanics, artifact outputs, and safety boundaries without reading a separate document.
- No parser, public PR, candidate, Diet Card, or copy-command capability is lost from the complete workspace.
