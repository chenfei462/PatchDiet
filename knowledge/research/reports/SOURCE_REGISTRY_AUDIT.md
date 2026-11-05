# PD-R100 — Source registry forensic audit

Initial forensic classification of every one of the 20 legacy sources. Repository sources are downgraded first; any later re-verification must cite a fixed capture. Original records are preserved in PRE_CORRECTION_RECORDS.json.

| Source | Classification | Reason |
| --- | --- | --- |
| standard:sarif-2.1.0 | SOURCE_VERIFIED_PRIMARY | Primary content inspected at listed locators; not merely a webpage existence check. |
| standard:git-diff-format | SOURCE_VERIFIED_PRIMARY | Primary content inspected at listed locators; not merely a webpage existence check. |
| standard:git-apply | SOURCE_VERIFIED_PRIMARY | Primary content inspected at listed locators; not merely a webpage existence check. |
| standard:nist-ssdf-1.1 | SOURCE_VERIFIED_PRIMARY | Primary content inspected at listed locators; not merely a webpage existence check. |
| paper:perses-icse-2018 | SOURCE_VERIFIED_PRIMARY | Primary content inspected at listed locators; not merely a webpage existence check. |
| project:perses | SOURCE_PARTIALLY_VERIFIED | DOWNGRADED: prior branch/date string is not an inspected commit. New captures require separate license/content review. |
| project:creduce | SOURCE_PARTIALLY_VERIFIED | DOWNGRADED: prior branch/date string is not an inspected commit. New captures require separate license/content review. |
| project:picire | SOURCE_PARTIALLY_VERIFIED | DOWNGRADED: prior branch/date string is not an inspected commit. New captures require separate license/content review. |
| project:tree-sitter | SOURCE_PARTIALLY_VERIFIED | DOWNGRADED: prior branch/date string is not an inspected commit. New captures require separate license/content review. |
| project:gumtree | SOURCE_PARTIALLY_VERIFIED | DOWNGRADED: prior branch/date string is not an inspected commit. New captures require separate license/content review. |
| project:refactoringminer | SOURCE_PARTIALLY_VERIFIED | DOWNGRADED: prior branch/date string is not an inspected commit. New captures require separate license/content review. |
| project:scip | SOURCE_PARTIALLY_VERIFIED | DOWNGRADED: prior branch/date string is not an inspected commit. New captures require separate license/content review. |
| project:strykerjs | SOURCE_PARTIALLY_VERIFIED | DOWNGRADED: prior branch/date string is not an inspected commit. New captures require separate license/content review. |
| benchmark:swe-bench | SOURCE_PARTIALLY_VERIFIED | DOWNGRADED: prior branch/date string is not an inspected commit. New captures require separate license/content review. |
| paper:rothermel-harrold-1997-safe-regression-test-selection | SOURCE_PARTIALLY_VERIFIED | Publisher HTTP 403; bibliographic identity known, original content verification remains open. |
| paper:microsoft-modern-code-review-2013 | SOURCE_VERIFIED_PRIMARY | Primary content inspected at listed locators; not merely a webpage existence check. |
| paper:google-modern-code-review-2018 | SOURCE_VERIFIED_PRIMARY | Primary content inspected at listed locators; not merely a webpage existence check. |
| project:reviewdog | SOURCE_PARTIALLY_VERIFIED | DOWNGRADED: prior branch/date string is not an inspected commit. New captures require separate license/content review. |
| project:harden-runner | SOURCE_PARTIALLY_VERIFIED | DOWNGRADED: prior branch/date string is not an inspected commit. New captures require separate license/content review. |
| project:openssf-scorecard | SOURCE_PARTIALLY_VERIFIED | DOWNGRADED: prior branch/date string is not an inspected commit. New captures require separate license/content review. |

All requested metadata fields, missing fields and claim references are recorded per source in SOURCE_REGISTRY_AUDIT.json. Missing venue for repositories is not a paper venue; repo founding year is unverified historical metadata. This report does not assert research distillation or license closure.
