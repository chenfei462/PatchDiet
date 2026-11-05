# PatchDiet Documentation Index

PatchDiet shrinks AI-generated pull requests into smaller reviewable patches, and only
removes what still passes your configured checks. Start with the quickstart, then jump to
the reference for whatever you are doing.

## Start here

- [Quickstart](quickstart.md) — install, run your first `patchdiet shrink`, read the outputs.
- [User guide](user-guide.md) — day-to-day usage, workflows, and common tasks.
- [Configuration](config.md) — every `patchdiet.yaml` key and its default.
- [Troubleshooting](troubleshooting.md) — what to do when a run fails or looks wrong.

## How it works

- [Algorithm](algorithm.md) — how candidates are classified and verified.
- [Safety](safety.md) — what PatchDiet guarantees, and what it does not.
- [Security model](security-model.md) — trust boundaries and data handling.
- [Threat model](threat-model.md) — the threats PatchDiet defends against.
- [Data retention](data-retention.md) — what is stored, where, and for how long.

## Integrations

- [GitHub Action](github-action.md) — run PatchDiet on pull requests in CI.
- [GitHub App](github-app.md) and [permissions](github-app-permissions.md) — the hosted webhook path.
- [VS Code extension](vscode-extension.md) — preview candidates inside your editor.
- [Agent hooks](agent-hooks.md) — wire PatchDiet into an agent workflow.

## Reference

- [API documentation](api-documentation.md) — programmatic entry points.
- [Developer guide](developer-guide.md) — repository layout and how to build, test, and extend.
- [Benchmark](benchmark.md) and [schema](benchmark-schema.json) — example benchmark harness.
- [Team metrics schema](team-metrics-schema.json) — dashboard/audit payload shape.
- [Local feedback data schema](feedback-data-schema.md) — bounded local JSON format for per-candidate review verdicts (no network collection).
- [CLI v0.2 field audit](cli-v02.md) — accepted `version: 2` config fields, coverage DATA JSON schema, and honest limitations.

## Product and delivery

- [Pro mode](pro-mode.md) and [pricing](pricing.md) — paid tier behavior.
- [LLM-assisted mode](llm-assisted-mode.md) — what the optional ranking mode does.
- [Performance and intelligence](performance-and-intelligence.md) — how runs scale.
- [Self-hosting](self-hosting.md) and [support status](support-status.md) — operating PatchDiet yourself.
- [Delivery readiness](delivery-readiness.md), [productization status](productization-status.md),
  and [remaining tasks](remaining-tasks.md) — current maturity and open work.
- [Public roadmap](public-roadmap.md) — where the project is going.

## Archive

Planning and go-to-market material is kept for reference and is not user documentation:
`roadmap.md`, `patchdiet-growth-roadmap.md`, `product-delivery-plan.md`,
`product-ux-optimization-research.md`, `optimization-plan.md`, `release.md`, `issues.md`,
`launch-materials.md`, `marketplace-listing.md`, `npm-publishing.md`, `case-studies/`,
`case-study-template.md`, `demo.md`, `judge-submission.md`, `investor-positioning-and-business.md`,
`trae-cn-investor-brief.md`, `trae-cn-submission-pack.md`, and `superpowers/`.
