# Post-MVP evidence, feedback and App implementation plan

> For agentic workers: execute this plan task by task with review checkpoints. The earlier Paseo/ZCode implementer instruction was superseded by the user on 2026-10-08; complete local work directly with independent verification. Reuse the approved isolated workspace. Do not commit, reset, stash, publish, message customers, install through the node_modules junction, or alter external dependencies.

**Goal:** Continue the approved eight-week product plan beyond the accepted local CLI MVP, implementing missing local evidence and feedback before integrating the GitHub App.

**Architecture:** Preserve the accepted reducer and mandatory exact-artifact verification. History and human feedback are bounded, repository-local, explicitly attributed facts; absence never proves removability. External adapters must be explicit and default off. Keep the previously delivered 0.2.0 tarball immutable and distinguish new development from that acceptance.

**Tech stack:** Existing TypeScript, SQLite12.9.0, Node20+, Git and Vitest. No new dependency is required for the first batches.

## Task 1: pinned history and caller-supplied merged-PR evidence

**Checkpoint:** Accepted in the isolated candidate after independent typecheck, build, focused and full tests, real-Git holdouts and benchmark. Historical failure and superseding acceptance details remain in `deliverables/post-mvp-review-2026-10-07.md`. This does not integrate or release the candidate.

Files: add `packages/knowledge/src/history.ts` and meaningful real-Git tests; extend `packages/knowledge/src/index.ts`, CLI index/Scope Map plumbing and focused documentation. Extend existing fact types only when needed for real provenance. Do not refactor the reducer, AST atomizer, coverage or oracle pipeline.

- [x] Write and observe failing tests for pinned history, dirty/ref-moved isolation, co-change facts, configured-off behavior, bounded/shallow history and original-schema read-only compatibility.
- [x] Implement bounded Git history at an exact commit, capped to 100 commits and bounded per-command time/output and path counts. Preserve NUL-delimited path framing, root/merge handling and explicit truncation/shallow diagnostics. Co-change is a file-level heuristic, not a symbol dependency or task similarity score.
- [x] Persist history in repository-owned SQLite extension tables with pinned-commit identity. Old indexes remain readable without writes or fabricated facts. Updating or replacing history is transactional and idempotent. Refuse cross-repository, future/unknown databases and redirected/hardlinked destinations using existing ownership checks.
- [x] Wire `knowledge.history.git` into `index`; make JSON/text output truthful. `verify` and `explain` may read only current pinned history and must not create a database, migrate it, write artifacts or execute an oracle.
- [x] Support an explicit `index --merged-prs <repo-local-json>` input only when merged-PR evidence is enabled. Strict bounded input records must cite PR identity, merge commit and local snapshot provenance; every claimed merge commit must be reachable from the indexed commit. Validate all input before committing related rows. No network requests, hidden conventional-file reads or inferred merged status from a commit subject. If the feature is configured but no snapshot exists, report unavailable. Treat supplied labels as unverified caller assertions, not GitHub authentication.
- [x] Attach weak neutral history evidence with real commit/source identities to affected atoms in public reports. Never change scope state, eligibility, protections, candidates, grouping, command selection or oracle authority solely from history. Preserve complete source provenance and expose limitations.
- [x] Run fresh typecheck/build and focused tests with actual exits. Independently verify source/ref/index identity, readonly queries, stale/old index behavior, malformed snapshots and no false history attribution. Stop for review before feedback implementation.

## Task 2: bound human decisions to actual run artifacts

**Checkpoint:** Local candidate implementation and focused verification passed. An earlier parallel full regression had one package-install timeout; its isolated rerun passed. A later single-worker full regression passed 761 tests with one Windows symlink-permission skip. This is not integration or release of the accepted 0.2.0 delivery.

Files: new small CLI feedback module and local persistence module; CLI wiring, feedback schema/documentation and meaningful e2e tests. Plan exact options after inspecting real candidate identity fields.

- [x] Write failing tests using genuine shrink reports and cleanup patches: accepted decision, unknown atom, path mismatch, stale/tampered patch, missing report, bad verdict/note, repeated event, symlink/junction/hardlink target and unchanged Git/source identity.
- [x] Implement `patchdiet feedback` with explicit atom/verdict/note and an explicit show/query operation. Bind every event to actual report bytes, pinned base/head identities, cleanup hash, stable atom identity and repository identity. Do not interpret notes as commands or instructions.
- [x] Use strict bounded validation, ownership checks, safe atomic writes and transactional/idempotent persistence. Preserve the documented legacy feedback format; introduce a distinct version if stronger provenance fields are required rather than silently accepting extra fields. Do not silently ingest arbitrary local records.
- [x] Initially record/show decisions only. Then implement the original plan's repository-local ranking memory with minimum repeated support and run-level deduplication. Ranking can only reorder already eligible candidates; it cannot lower risk, bypass rules, mark unknown atoms removable, change required/supporting/protected retention, cache outcomes or disable final full checks. Test this invariant against weak oracles and adversarial feedback.
- [x] Independently verify actual records, source/patch hashes, concurrency and mandatory retention. Preserve old schemas and required field behavior. Do not call manual/synthetic events natural real PR samples.

## Task 3: GitHub App integration and deployment prerequisites

**Checkpoint:** Mocked connected adapter, signed runner receipt and local action flow passed. Live App installation, durable state, hosting and customer runner remain unverified prerequisites; the checked items below describe local implementation only.

- [x] Audit existing server/auth/provider/jobs/tests; replace preview-only claims with real adapter capability and truthful mode reporting.
- [x] Implement Check Runs, annotations and requested actions against injected local mock GitHub APIs before any live mutation. Pin owner/repo/installation/head/event identities, validate signed payloads, deduplicate delivery/action events, bound queues/body/output and protect private job data. Keep PR code away from server secrets; execution belongs to the Action/customer runner.
- [x] Implement feedback actions and explicitly requested cleanup-branch creation only after real verified artifact identity. Merely opening or synchronizing a PR must never create a branch or run arbitrary PR commands on the credentialed server.
- [x] Test the full webhook → job → runner receipt → check/annotation/action flow with actual mock HTTP and repository fixtures, including stale heads, invalid signatures, cross-installation access, retry and forged verification claims.
- [x] Prepare a reviewable deployment configuration and list actual missing App credentials/installation and hosting conditions. Ask for missing information or approval only when concrete live verification/deployment is ready; never silently publish or send human messages.

## Task 4: optional cloud intent and real pilot validation

**Checkpoint:** Opt-in local adapter and corpus importer passed. Fresh single-worker full regression and the reproducible 16-case benchmark passed. Natural PR sample count remains 0, and standalone Node 20 runtime and production pilot gates remain unverified.

- [x] Implement optional structured intent extraction only behind explicit provider configuration and upload consent. Default behavior stays local. Validate bounded response schemas, source spans and contradictions; fallback cannot turn uncertain evidence into deletion authority. Test with injected transport first. Do not reuse ZCode account credentials for product calls.
- [x] Keep the real PR corpus count0 until genuinely human-labelled natural PRs are supplied. Prepare a local corpus import/validation workflow and aggregate opt-in pilot metrics without inventing participants or outcomes.
- [ ] Require appropriate fresh full regression, reproducible labelled benchmark and supported Node20 package/Action verification after reviewed functional changes. Preserve all failures and record acceptance per batch. Local implementation, mocked integration, live deployment and production effectiveness are separate claims.

Design decisions above implement the existing supplied plan and the user's instruction to continue after the remaining gaps were disclosed. There is no new product direction or automatic publication authorization.
