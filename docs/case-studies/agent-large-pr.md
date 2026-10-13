# Case Study: agent-large-pr

Status: primary verified proof for judges and investors

This case study is the larger hackathon proof case. It simulates an AI coding
agent that implemented cart discount and tax behavior, then also committed
bulky planning notes and generated output. It is not a public repository claim.

## Context

- Repository fixture: `examples/agent-large-pr`
- Base: `main`
- Head: `agent/bloated`
- Test command: `node --test`
- PatchDiet command: `patchdiet shrink --base main --head agent/bloated --test "node --test"`

## Why It Matters

The diff is intentionally large enough to feel like an agent PR rather than a
toy demo. Reviewers need the pricing code and tests; they do not need to read a
long plan dump or generated fixture output when tests still pass without them.

## Expected Reviewer Story

- Keeps `src/cart.js` and `test/cart.test.js`.
- Removes `docs/agent-plan.md` and `dist/cart.generated.js` when checks pass.
- Emits `report.md`, `run.json`, `reduced.patch`, `removal.patch`,
  `candidates.json`, and `diet-card.svg`.

## Latest Local Receipt

`npm run bench:examples` currently records this fixture as
`4 files / 128 changed lines -> 2 files / 32 changed lines`, a `75%`
changed-line reduction, with `node --test` passing.

This is the primary verified proof. The browser `sample-cart-pr` demo is the
30-second preview sample; this fixture is the evidence path for the real CLI
verification loop.

## Reproduce

```bash
npm run bench:examples
cat .patchdiet/example-benchmarks/agent-large-pr/README.md
cat .patchdiet/example-benchmarks/agent-large-pr/report.md
```
