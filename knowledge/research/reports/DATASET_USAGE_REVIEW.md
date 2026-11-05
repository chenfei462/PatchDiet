# Dataset Usage Review

Date: 2026-10-27. This is a legal and data-use gate, separate from publication identity and benchmark capability.

| Dataset | Official source/version | License evidence | Terms/data-use | Redistribution | Privacy | Sampling/freshness | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SWE-rebench | NeurIPS 2025 paper and official Hugging Face snapshot `89cdfbab4ab1bd8f5a658bb212d1b63624f4f881` | CC-BY-4.0 dataset-card declaration; upstream repository licenses separate | Per-record code/review/container terms unresolved | No raw rows, patches, review text, or images redistributed | Public availability is not consent; minimization and deletion workflow absent | Automated collection, filters, Python-oriented population, fixed vs monthly cohorts distinct | **HOLD** |
| SWE-bench Live | Official publication/site and pinned dataset metadata | Dataset/repository scope requires per-record review | Docker, language and environment terms need selected snapshot review | No import or redistribution approved | Public issue/PR content requires minimization review | Live updates make headline counts snapshot-specific | **HOLD** |
| AIDev | Official paper/dataset metadata | License and repository-level code rights not closed | Terms, privacy, redistribution and storage policy unresolved | No import | Agent identity/PR text minimization not approved | Agent-authored sample and collection methodology require reproducible selection | **HOLD** |
| CodeReviewQA | Official publication/artifact metadata | Artifact/data license not closed | Terms, redistribution and repository code rights unresolved | No import | Review text handling not approved | Languages/sample and contamination controls require pinned artifact | **HOLD** |

**Decision:** `import_permitted=false`. No dataset rows were imported or relabeled as real. Current counters remain `REAL_HUMAN_PR_COUNT=0`, `REAL_AGENT_PR_COUNT=0`, `FRESH_TASK_COUNT=0`. A future PASS requires record-level code licensing, terms, privacy minimization, storage/deletion controls, a pinned snapshot, and reproducible sampling evidence.
