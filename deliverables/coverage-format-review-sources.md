# Coverage format review sources

These primary references support independent input-fixture construction. They do not constitute a PatchDiet implementation or acceptance result.

- [LCOV tracefile specification](https://github.com/linux-test-project/lcov/blob/master/docs/man/geninfo.rst): source-file records and terminators delimit coverage sections; optional test-name records identify the section's test; line records carry a line number and execution count. Malformed section ordering must be handled explicitly.
- [Istanbul file coverage implementation](https://github.com/istanbuljs/istanbuljs/blob/main/packages/istanbul-lib-coverage/lib/file-coverage.js): statement locations and execution counters provide covered source locations. A combined file report alone does not supply per-test execution identity.
- [Coverage.py JSON command](https://coverage.readthedocs.io/en/latest/commands/cmd_json.html) and [JSON emitter source](https://github.com/nedbat/coveragepy/blob/master/coverage/jsonreport.py): JSON generation can include covered-line contexts when requested. Preserve the reported context/provenance instead of claiming complete coverage.
- [pytest-cov context documentation](https://pytest-cov.readthedocs.io/en/latest/contexts.html): test execution contexts distinguish test identity and phase. Missing contexts must remain aggregate/unmapped.

Review expectation: ingest bounded local data, map measured intervals to actual pinned symbols, preserve raw-format/hash/commit provenance, and distinguish reported per-test evidence from aggregate coverage. Every exact cleanup artifact still requires the full configured oracle.
