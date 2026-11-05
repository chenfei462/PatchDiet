# SCIP indexer comparison matrix

This is a research design matrix, not a benchmark result. The three indexers have separate project/source records. All measured columns remain `NOT_MEASURED` until a fixed commit, reproducible fixture, ground truth and Windows/CI setup are captured.

| Indexer | Language | License status | Install complexity | Windows | CI | Monorepo | Incremental behavior | Output size | Symbol precision | Reference precision | Maintenance status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `scip-typescript` | TypeScript/JavaScript | PARTIAL; fixed commit/license capture pending | NOT_MEASURED | NOT_MEASURED | NOT_MEASURED | NOT_MEASURED | NOT_MEASURED | NOT_MEASURED | NOT_MEASURED | NOT_MEASURED | Official repository exists; version pin pending |
| `scip-python` | Python | PARTIAL; fixed commit/license capture pending | README says Python 3.10+ and npm install; reproducibility not measured | NOT_MEASURED | NOT_MEASURED | NOT_MEASURED | NOT_MEASURED | NOT_MEASURED | NOT_MEASURED | NOT_MEASURED | Official repository exists; version pin pending |
| `scip-java` | Java/Kotlin/Scala (current docs) | PARTIAL; fixed commit/license capture pending | README/docs describe Java build integrations and current Java 17+ constraints | NOT_MEASURED | NOT_MEASURED | NOT_MEASURED | NOT_MEASURED | NOT_MEASURED | NOT_MEASURED | NOT_MEASURED | Official repository/releases inspected; fixed capture pending |

Required experiment fixture: one manually curated TypeScript, Python and Java repository (Java only when a suitable local fixture exists), with symbol-definition and reference ground truth. Measure cold start, index time, index size, precision/recall, incremental update cost, monorepo behavior, Windows installation and CI installation. Decision values are restricted to `KEEP_SQLITE`, `ADD_OPTIONAL_SCIP_IMPORT`, `HYBRID`, or `REJECT_SCIP_FOR_MVP`.
