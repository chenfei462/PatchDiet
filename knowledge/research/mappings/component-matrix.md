# PatchDiet research-to-component matrix

| PatchDiet Component | Current Implementation | Relevant Research | Relevant OSS Projects | Useful Claims | Current Gap | Decision | Ticket | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DiffParser | `packages/core/src/diff.ts` parses extended Git headers and round-trips | Git diff-format, git-apply | Git | claim:git:001, claim:git:002, claim:git:003 | Combined diff and full mode/type fixture audit | ADAPT | PD-R050 | diff unit/e2e fixtures |
| PatchEncoder | `packages/core/src/patch-encoder.ts` | Git diff-format | Git | claim:git:001 | Binary/mode/symlink fidelity benchmark | ADAPT | PD-R050 | round-trip and git apply |
| AstAtomizer | `packages/core/src/ast-atomizer.ts` | syntax-guided reduction, Tree-sitter | Perses, Tree-sitter | claim:perses:001, claim:treesitter:001 | Parse filtering cost/value | EXPERIMENT | PD-R003 | AST fixture tests + benchmark |
| ScopeEngine | `packages/scope/src` | slicing, change impact | Tree-sitter, SCIP | claim:scip:001 | Dynamic and monorepo precision | ADAPT | PD-R020 | scope precision/recall |
| EvidenceGraph | `packages/evidence/src` | change-impact, code intelligence | SCIP, Joern | claim:scip:001 | Optional SCIP comparison | EXPERIMENT | PD-R020 | graph benchmark |
| KnowledgeStore | `packages/knowledge/src` | repository knowledge vs research trust domains | SCIP | claim:scip:001 | Boundary documentation and import adapter | ADAPT | PD-R020 | schema and isolation tests |
| CandidateGenerator | `packages/core/src/reducer.ts` | ddmin, HDD, syntax-guided, WDD, ProbDD, CDD | Perses, C-Reduce, Picire | claim:perses:002, claim:creduce:001, claim:picire:001 | Strategy benchmark | ADAPT | PD-R002, PD-R003 | reducer tests and benchmark |
| Reducer | `packages/core/src/reducer.ts` | ddmin and reduction variants | Perses, C-Reduce, Picire | claim:perses:003 | Current reducer has no measured strategy comparison | ALREADY_IMPLEMENTED | PD-R002 | current reducer suite |
| VerificationEngine | `packages/core/src/runner.ts` | interestingness oracle, SSDF | C-Reduce, Harden-Runner, NIST SSDF | claim:creduce:001, claim:security:001, claim:security:002 | Sandbox and provenance evidence | ADAPT | PD-R090 | runner/security tests |
| TargetedVerification | `packages/core/src/targeted.ts` | regression test selection, change impact | SCIP, StrykerJS | claim:scip:001, claim:mutation:001 | Hidden regression benchmark | ADAPT | PD-R030 | targeted-first e2e |
| FeedbackRanking | `packages/core/src/insights.ts` | weighted ordering, review research | reviewdog | claim:review:001 | No measured reviewer benefit | RESEARCH_ONLY | PD-R070 | human review study |
| GitHubAction | `packages/action` | review transport, security | reviewdog, Harden-Runner | claim:review:001, claim:security:002 | External runner telemetry | RESEARCH_ONLY | PD-R080, PD-R090 | action smoke |
| GitHubApp | `packages/github-app` | provider abstraction, review findings | reviewdog | claim:review:001 | Provider correctness vs finding correctness | ADAPT | PD-R080 | app smoke |
| BenchmarkHarness | `benchmarks`, `docs/benchmark-schema.json` | reproducible task bundles, mutation audit | SWE-bench, StrykerJS | claim:swebench:001, claim:mutation:001 | Ground-truth labels and separate reports | ADAPT | PD-R061, PD-R041 | benchmark fixtures |
