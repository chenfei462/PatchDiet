# RG-2 regression evidence

Date: 2026-10-27.

- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `git diff --check`: no patch errors; Git emitted existing LF/CRLF normalization warnings for dirty files.
- `npx vitest run tests/unit/research-integrity-validator.test.ts tests/unit/diff.test.ts --maxWorkers=1`: PASS, 2 files / 53 tests.
- Targeted bundled Action test after excluding local `.patchdiet` scratch from copied fixtures: PASS, 1 test in 19.52 seconds. The fixture previously copied about 12,938 local scratch entries and reached the 180-second timeout.
- The earlier fresh full-suite run is retained in `RG2_FULL_REGRESSION_TESTS.log`: it failed with two Action timeouts and one CLI dry-run timeout; it must not be reused as a pass.
- A subsequent full Action-file rerun did not produce a result before the local runner stalled and was terminated. This remains unresolved regression evidence.

Research gate consequence: no runtime adoption, experiment, dataset import or authorization file is created. The Action fixture change is test-only and does not alter the runtime.
