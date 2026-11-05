# CLI v0.2 local MVP acceptance

Status: **LOCAL FUNCTIONAL MVP ACCEPTED**, 2026-10-07. Package version **0.2.0**, local build; not published. Implementation used Paseo MCP → ZCode **BigModel GLM-5.3-Flash**; Codex independently reviewed and executed acceptance checks.

| Gate | Observed result |
| --- | --- |
| Typecheck / build / CLI version | Exit 0 / exit 0 / 0.2.0 |
| Full main regression | 51 files; 707 passed, 1 environment skip (708 total); exit 0 |
| Offline bundled Action | Runs without dist, node_modules, installation or build; full regression passed |
| Node 20 fresh production install | Node20.20.2, no dev dependencies, native SQLite12.9.0, real index, AST cleanup, independent exact-base required behavior and tree identity passed |
| Public coverage / AST explanation | Main CLI independent probes passed; indexed test context and actual shrink atom IDs |
| Windows timeout tree cleanup | Restricted PATH with no System32: owned descendant dead on timeout return |
| Passive feedback format | 20 Python JSONSchema checks and native JS path matrix passed; no feedback collector |
| Labelled corpus | 16 cases: 6 synthetic and 10 injected; all per-case checks passed, exit 0 |
| Automatic removal precision | 17/17 (100.0%) |
| Static detection before reduction | 9/14 (64.3%) |
| Runtime-confirmed detection | 12/14 (85.7%) |
| Full-pipeline detection (case union) | 13/14 (92.9%); ≥80% available-corpus gate passed |
| Deletion rate (separate, not detection) | 12/14 (85.7%) |
| Independent final configured oracle | 12/12 (100.0%); zero known hidden regressions |
| Natural human-labelled agent PRs | Sample0: **NOT VERIFIED** |

The single skipped test requires creating a dangling file symlink, which this Windows account cannot do. It is disclosed, not counted as passed. Existing failed-run history remains in the reviewer ledger. The small controlled corpus does not establish production precision or large-repository performance.

## Install the reviewed package

From this directory, run:

```powershell
npm install -g ./patchdiet-0.2.0.tgz
patchdiet --version
```

SHA-256: `a5f718d78fef76de9524275c812c8576c28361276482b183e2864f217c1147a0`. The tarball was installed and tested in a separate clean directory; no global installation was performed by the reviewer.

In the repository, run `npm run bench:cli-v02` to reproduce the labelled corpus after `npm run build`. See [CLI/configuration reference](../../docs/cli-v02.md), [demonstrations](../../docs/demo.md), [benchmark methodology](../../benchmarks/README.md), [machine-readable acceptance](acceptance.json), and [full benchmark results](benchmark/summary.json).

History/merged-PR evidence and cloud intent are unavailable in local0.2; feedback is a passive schema only. The CLI documents accepted inert fields and conservative fallback. Required final full checks and exact-base artifact verification cannot be disabled. Weeks7–8 GitHub App/pilot work, external publishing and recruitment are outside this local MVP delivery.
