# Cinematic Proof Homepage Design

## Goal

Create a high-impact PatchDiet homepage that feels like a cinematic motion website while staying grounded in developer proof. The page should make a Tech Lead or reviewer believe, within 30 seconds, that oversized AI-generated PRs need a cleanup gate before human review.

The target impression is not a normal SaaS landing page. It is a product proof sequence: a noisy AI PR enters, PatchDiet compresses the review surface, tests pass, and a cleanup receipt appears.

## Primary Audience

The primary audience is Tech Leads and human reviewers who already feel the review cost of AI-generated PRs.

Secondary audiences are:

- DevEx, platform engineering, and engineering managers who care about AI coding governance.
- Hackathon judges, investors, and developer community visitors who need the product story quickly.
- Individual AI coding users who can enter through the 30-second demo.

## Core Belief

Visitors should leave believing:

PatchDiet can shrink bloated AI-generated PRs, and its credible result is not based on vague AI judgment. It only treats cleanup as verified when configured checks still pass, then generates artifacts reviewers can inspect.

Supporting beliefs:

- Reviewer time is wasted by noisy AI PR surface area.
- PatchDiet reduces review surface before human judgment starts.
- Local-first verification and cleanup receipts make the workflow auditable.
- PatchDiet does not prove semantic equivalence or replace human review.

## Recommended Direction

The recommended direction is **Cinematic DevEx Proof**.

The page borrows the visual language of cinematic scroll sites: full-screen scenes, layered depth, parallax movement, dramatic typography, strong lighting, and reveal moments. It should translate that language into engineering materials: diffs, file cards, test gates, terminal output, patches, reports, and Diet Cards.

The design should not copy fantasy, lifestyle, or abstract AI imagery from the reference video. PatchDiet should feel like an engineering verification machine, not a generic AI spectacle.

## Narrative Arc

The homepage should play like a four-act product proof:

1. **Noisy AI PR**
   A dense cloud of diff rows, file cards, generated artifacts, docs churn, and abandoned helper code fills the first viewport.

2. **PatchDiet Compression**
   The diff separates into layers. Review noise is highlighted, folded, and removed from the visible review surface.

3. **Verification Gate**
   Temporary worktrees, command execution, and test results animate as a credible pipeline. The key moment is `node --test passed` or `npm test passed`.

4. **Cleanup Receipt**
   The final state reveals a smaller PR surface and a Diet Card style receipt with verified metrics and artifacts.

## Hero

The hero should be full-viewport and motion-led.

Headline:

```text
128 changed lines became 32. Tests still passed.
```

Supporting copy:

```text
PatchDiet shrinks oversized AI-generated PRs before human review by testing what can be safely removed, then generating a cleanup receipt reviewers can inspect.
```

Primary CTA:

```text
Try the 30-second diff demo
```

Secondary CTA:

```text
See verified cleanup proof
```

Hero visual behavior:

- Diff rows stream or float in layered depth.
- Red removed-line fragments and generated-file cards appear as noisy surface area.
- The center proof metric transitions from `128` to `32`.
- A green test-pass state appears after the compression motion.
- The final frame shows `75% changed-line reduction` and a compact receipt preview.

## Page Structure

### 1. Hero: Diff Compression Show

Purpose: create instant understanding and memory.

Content:

- `128 changed lines became 32. Tests still passed.`
- `4 files -> 2 files`
- `75% changed-line reduction`
- `Verified fixture: agent-large-pr`

Motion:

- Layered parallax diff field.
- Noise rows fold, fade, or collapse.
- Metric count-up or count-down.
- Test-pass glow only after the removal motion completes.

### 2. Proof Strip

Purpose: separate claim from evidence.

Content:

- `4 files -> 2 files`
- `128 changed lines -> 32`
- `75% reduction`
- `node --test passing`

Trust copy:

```text
Verified with the configured checks. This is not a semantic-equivalence proof.
```

### 3. Before, After, Receipt

Purpose: explain the product in one glance.

Panels:

- Before: noisy AI PR with mixed source, docs, generated files, and scope creep.
- After: reduced review surface with fewer files and hunks.
- Receipt: report, removal patch, candidates JSON, and Diet Card.

The panels can animate into place as the user scrolls, but the text and metrics must remain readable at rest.

### 4. Verification Machine

Purpose: make the motion credible for engineers.

Flow:

```text
Diff in -> Temporary worktrees -> Rerun tests -> Removal patch -> Cleanup receipt
```

Required trust points:

- Local-first.
- No source upload by default.
- No LLM required for verified cleanup.
- No branch rewrite by default.
- Candidate removal only counts when configured checks still pass.

Motion:

- Workflow nodes light up step by step.
- Terminal lines appear in short, readable bursts.
- Failed or kept candidates should be visible as part of the process, so the page does not imply reckless deletion.

### 5. 30-Second Demo

Purpose: turn interest into action.

Content:

- Link or embedded entry to the existing demo.
- Three entry paths: sample diff, paste diff, public GitHub PR URL.
- Preview language must stay clear: browser preview highlights likely noise, while CLI verifies cleanup by rerunning tests.

CTA:

```text
Open the demo
```

### 6. Reviewer Artifacts

Purpose: prove that PatchDiet outputs inspectable work products.

Artifacts to show:

- `.patchdiet/report.github.md`
- `.patchdiet/removal.patch`
- `.patchdiet/reduced.patch`
- `.patchdiet/candidates.json`
- `.patchdiet/diet-card.svg`

This section should use real product screenshots, generated assets, or faithful UI captures where possible. Do not rely only on abstract mock cards.

### 7. Workflow Integrations

Purpose: show that the product can fit real developer workflows.

Surfaces:

- CLI
- GitHub Action
- GitHub App direction
- VS Code extension direction

This section should be quieter than the hero. It supports adoption rather than competing with the main story.

### 8. Team Direction

Purpose: hint at commercial value without overclaiming.

Messages:

- Review intake gate for AI-generated PRs.
- Team cleanup policy.
- Audit-ready receipt history.
- Review surface trends.
- Hosted or enterprise Pro direction.

Boundary:

Do not claim live billing, customer traction, Marketplace distribution, or revenue unless externally verified.

### 9. Final CTA

Purpose: end with a clear next step.

Primary CTA:

```text
Try the 30-second diff demo
```

Secondary CTA:

```text
Run patchdiet shrink
```

Supporting command:

```bash
npm ci && npm run build
node dist/packages/cli/src/index.js shrink --test "npm test"
```

## Motion System

Use motion to explain the product, not decorate it.

Priority effects:

1. Scroll-linked scene progression.
2. Layered parallax for diff rows and file cards.
3. Diff row compression and removal.
4. Metric count transitions.
5. Verification node lighting.
6. Diet Card reveal.

Motion rules:

- Every animation should have a readable resting state.
- The page must respect reduced-motion preferences.
- Text should not move while the user needs to read it.
- Hero motion should loop gently after the main reveal.
- Avoid long animations that delay access to CTAs.
- Avoid effects that imply PatchDiet deletes code without verification.

## Visual System

The visual style should be high contrast, cinematic, and technical.

Recommended palette:

- Near-black background.
- Cool neutral panels.
- Electric green for verified tests and reduction success.
- Blue-cyan for workflow connections.
- Controlled red for removed diff noise.
- White or light gray text for readability.

Avoid:

- Fantasy artwork.
- Stock AI imagery.
- Crypto-style glow overload.
- One-note purple or blue gradients.
- Overextended diet jokes.
- Pure terminal aesthetic across the whole page.

Typography:

- Large editorial hero type for the first viewport.
- Compact developer UI type for diff, terminal, and artifact surfaces.
- No negative letter spacing.
- No viewport-width font scaling.

## Interaction Requirements

Must-have:

- CTA to the current 30-second demo.
- CTA or anchor to the verified proof section.
- Scroll-driven explanation of the verification flow.
- Product artifact previews.

Nice-to-have:

- Before/after diff toggle.
- Copyable CLI command.
- Diet Card reveal interaction.
- Public PR URL input embedded from the demo.

Out of first-version scope:

- Full in-page implementation of all demo parsing logic.
- Hosted authenticated GitHub App flow.
- Real team dashboard.
- Live billing or account system.

## Content Boundaries

The page must consistently say:

- PatchDiet is a cleanup layer after AI coding.
- Browser preview identifies likely noise.
- CLI verified cleanup reruns configured checks.
- Test-passing cleanup is not semantic equivalence.
- Humans still review the remaining patch.

The page must not say:

- PatchDiet proves the PR is correct.
- PatchDiet replaces human reviewers.
- PatchDiet is an AI reviewer.
- PatchDiet safely removes all unnecessary code.
- PatchDiet has live customers, revenue, billing, or Marketplace availability unless verified.

## Technical Shape

The design can be implemented as a static or app-like homepage using the existing demo assets and generated proof artifacts.

Recommended implementation approach:

- Use CSS transforms, opacity, and lightweight JavaScript for scroll progress.
- Prefer DOM and CSS animations for diff rows, cards, metrics, and workflow nodes.
- Use real images or generated screenshots for artifacts where visual proof matters.
- Keep 3D or canvas effects optional. If used, they must remain full-bleed, performant, and verified across desktop and mobile.
- Reuse existing demo and launch GIF assets when they strengthen trust.

Performance constraints:

- First meaningful content should not depend on heavy animation bundles.
- The hero should degrade to a strong static proof layout.
- Mobile should keep the same story with fewer simultaneous layers.
- Reduced-motion mode should show staged static proof panels.

## Success Criteria

The homepage succeeds when:

- A new visitor can explain PatchDiet in one sentence after 30 seconds.
- The first viewport communicates the verified `128 -> 32` proof.
- Engineers can find how verification works without hunting through docs.
- The page feels visually memorable without weakening trust.
- The CTA path to the demo and CLI is obvious.
- Safety boundaries are visible before any strong automation claim.

## First-Version Defaults

Use these defaults for the first implementation plan unless the user changes direction:

- Build a new standalone homepage experience rather than replacing the current demo first screen.
- Use DOM and CSS animation for the hero, diff compression, metrics, and verification flow.
- Link to the existing 30-second demo route for the first version instead of embedding the full parser inline.
- Use the current Diet Card SVG output as the base visual for the receipt reveal.
- Reuse existing launch GIF or screenshot assets only where they support proof, not as the main hero.
