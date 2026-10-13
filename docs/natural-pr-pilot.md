# Natural PR pilot input and validation

As of 2026-10-08, **0 natural, human-labelled PR cases have been supplied**. Production effectiveness is **NOT VERIFIED**. Synthetic fixtures and adversarial benchmarks remain separate.

For a consented local pilot, prepare a JSON file with `schemaVersion: "patchdiet-natural-pr-corpus/1"` and 1–100 cases. Each case requires a stable id, `consent: true`, a HTTPS repository URL, PR number, exact 40-character base/head SHAs, a pseudonymous labeler, RFC 3339 label time, and 1–500 candidate labels with candidate id, `necessary|unnecessary|uncertain` verdict and human rationale. Optional `pilot` measures review minutes before/after, suggestions, accepted suggestions and regressions. Do not enter estimates as observed outcomes.

Run `node scripts/import-natural-pr-corpus.mjs --input <repo-local-json> --dry-run` to validate without writing, then omit `--dry-run` to copy the validated corpus to `.patchdiet/pilot/natural-pr-corpus.json`. The script bounds the input, rejects duplicate case/PR heads and labels, rejects unknown fields and redirected or hardlinked inputs/outputs, and uses a lock plus atomic rename for import. It prints an aggregate of only supplied pilot measurements. No sample data is bundled or fabricated.

The importer cannot authenticate the human labeler or verify GitHub merge status by itself. Its output declares `provenance: caller-supplied-unverified` and `independentlyVerifiedNaturalCases: 0`. A separate reviewer must confirm consent, PR identity, labels and measured outcomes before claiming an independently verified natural PR count or product accuracy. Do not combine this count with synthetic benchmark gates.
