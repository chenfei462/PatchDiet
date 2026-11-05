# PD-R151 / PD-R152 — fresh source closure decisions

Inspection date: 2026-10-27, America/Los_Angeles. Scope: research records and evidence only. This report does not authorize experiments, reproduce an artifact, import benchmark data, or implement a reducer. Existing runtime work and unrelated dirty files were preserved. Overall state remains `RESEARCH_PARTIAL`; experiment gate remains `EXPERIMENTS_NOT_PERMITTED` pending the separate fresh independent review.

## PD-R151 — WDD

The paper identity and algorithm claim remain `SOURCE_VERIFIED_PRIMARY`. The combined artifact source/project are corrected from a misleading repository-verified state to `SOURCE_PARTIALLY_VERIFIED`. Verified identity is distinct from permission to reuse code.

| Required dimension | Fresh finding | Evidence / decision |
| --- | --- | --- |
| Paper provenance | Xintong Zhou, Zhenyang Xu, Mengxiao Zhang, Yongqiang Tian and Chengnian Sun, *WDD: Weighted Delta Debugging*, ICSE 2025, pp. 1592–1603; DOI `10.1109/ICSE55347.2025.00071`. Inspected accepted preprint `arXiv:2411.19410v2`, 16 December 2024. | [Author metadata](https://arxiv.org/abs/2411.19410v2) and [full text](https://arxiv.org/html/2411.19410v2). Publisher DOI endpoint was inaccessible in this pass; the author metadata supplies its publication locator. |
| `PAPER_LICENSE/ACCESS` | Open preprint accessed. arXiv displays its perpetual non-exclusive distribution license. This establishes access, not an OSS grant to artifact code. | [Pinned full text and license link](https://arxiv.org/html/2411.19410v2). |
| Official artifact provenance | Paper reference [21] names DOI `10.5281/zenodo.14270380`; creators and title match. Immutable record v1 is retained as the inspected historical snapshot. | [Paper reference [21]](https://arxiv.org/html/2411.19410v2#bib.bib21), [Zenodo v1](https://zenodo.org/records/14270380). |
| GitHub identity / snapshot | `https://github.com/weightdd/WeightDD`, exact commit `4a6cdd00f3f136867f23f76057a7104961c2e8e4`; author and committer timestamp `2025-12-08T21:57:06Z`. Fresh recursive tree is complete (`truncated=false`). | [Commit API](https://api.github.com/repos/weightdd/WeightDD/commits/4a6cdd00f3f136867f23f76057a7104961c2e8e4), [tree API](https://api.github.com/repos/weightdd/WeightDD/git/trees/4a6cdd00f3f136867f23f76057a7104961c2e8e4?recursive=1); saved raw responses and SHA-256 manifest. |
| `GITHUB_CODE_LICENSE` | No root project license in the complete pinned tree. The only license-named tree entry is `xml_benchmarks/lib/xmlresolver-5.2.0/notices/LICENSE`, a dependency notice. Root `license_path=null`, license unverified, scope unresolved for repository code reuse. | `evidence/repositories/wdd-github-tree-2026-10-27.json`. No license is transferred from Zenodo or Perses. |
| Project state | Public research artifact; pinned README directs users to WDD implementations integrated into Perses. This does not prove ongoing maintenance or an archive flag. | [Pinned README](https://github.com/weightdd/WeightDD/blob/4a6cdd00f3f136867f23f76057a7104961c2e8e4/README.md). Fresh raw README download failed TLS; the official rendered README was inspected. |
| `ZENODO_ARTIFACT_LICENSE` | API `metadata.license.id` is `cc-by-4.0`, a deposited-resource declaration. Separately uploaded `LICENSE` contains GPL v3. Per-component applicability is not explained by the inspected record. Full archive contents were not inspected. | [v1 API](https://zenodo.org/api/records/14270380), [LICENSE endpoint](https://zenodo.org/records/14270380/files/LICENSE?download=1). SHA-256 `8b1ba204bb69a0ade2bfcf65ef294a920f6bb361b317dba43c7ef29d96332b9b`. Do not infer dual licensing or a complete dependency license audit. |
| Metadata license correction | The earlier assertion “Zenodo metadata is CC-BY-4.0” is unsupported. Zenodo Terms v1.3 §7 says metadata defaults to CC0 unless otherwise specified. The deposit's resource-license field does not establish a metadata-only scope. | [Zenodo Terms](https://about.zenodo.org/terms/). This report supersedes that assertion in prior evidence summaries/reviews; the two current scoped summaries are corrected. |
| Artifact version drift | Latest check resolves v2, DOI `10.5281/zenodo.14301983`, published 8 December 2025. Its archive MD5 is `2de412c8ba298e7ff861b2e293e11d11`; v1 archive MD5 is `5fb52bbe1e42a8b13eaf6f1be579e6c8`. | [v2 record](https://zenodo.org/records/14301983). v1 remains deliberately pinned because the paper cites it. No v1/v2 equivalence is assumed. |
| `CONTAINER/IMAGE_STATUS` | `REPRODUCTION_LIMITATION`: official README uses mutable `wddartifact/wdd:latest`. No immutable digest independently established. Docker Hub rendered page was inaccessible and tags API attempt failed TLS. | Attempts recorded in `evidence/repositories/wdd-source-closure-2026-10-27.json`. No image was pulled or executed. Even a current tag digest would not alone identify the paper's historical image. |
| Reproduction | `REPRODUCTION_LIMITATION`: no archive import, container execution, empirical reproduction or PatchDiet comparison. | Paper algorithm remains research-only; this pass establishes source facts and limitations. |

The existing size-weighted algorithm claim remains supported by the paper. Artifact identity, licensing and execution do not supply PatchDiet performance evidence. The algorithm card keeps the paper-based interpretation and now has explicit D1–D7 states; its artifact limitation is separately recorded.

## PD-R152 — 2026 reviewer reliability citation

Fresh checks of the [publisher version of record](https://link.springer.com/article/10.1007/s10515-026-00638-5) and [arXiv v1](https://arxiv.org/html/2603.00539v1) establish the existing registered source. It is retained with disposition `SOURCE_IDENTIFIED_RETAINED_IN_EVIDENCE_CHAIN`, separate from legal source status `SOURCE_VERIFIED_PRIMARY`. Removal disposition is unnecessary because this is a real identified paper.

The source card records exact title, Haolin Jin and Huaming Chen, *Automated Software Engineering* 33, Article 90 (2026), DOI `10.1007/s10515-026-00638-5`, version of record 26 June 2026, paper CC-BY-4.0, evaluated datasets, five model identifiers, study question, findings and limits. The claim is narrowed to observed error tradeoffs and rationale reliability. Independent executable verification is explicitly a PatchDiet safety mapping, rather than a theorem attributed to the study. Dataset rights and repository snapshot were not audited, and no data import is authorized.

The stale “no bibliographic identity” summary is corrected. The source filename is renamed from `paper-llm-reviewer-reliability-2026-unidentified.yaml` to `paper-llm-reviewer-reliability-2026.yaml`; source ID and claim ID are preserved. Fresh inspection evidence is in `evidence/papers/reviewer-reliability-2026-primary-check.json`. Historical coverage entries describing an unidentified source must be replaced by this identity and bounded disposition.

## D1–D7

`PASS` records a completed research step, not experiment authorization. `D6_NOT_APPLICABLE` means no runtime ticket is required for this research-only decision. `D7_NOT_APPLICABLE` means nothing was implemented or reproduced; it makes no validation claim. Each applicable card includes these justifications.

| Record | D1_SOURCE_VERIFIED | D2_CLAIMS_EXTRACTED | D3_LIMITATIONS_CAPTURED | D4_PATCHDIET_MAPPED | D5_DECISION_RECORDED | D6_TICKET_CREATED_IF_REQUIRED | D7_VALIDATED_IF_IMPLEMENTED |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `paper:zhou-2025-wdd` | PASS | PASS | PASS | PASS | PASS | D6_NOT_APPLICABLE | D7_NOT_APPLICABLE |
| `weighted-delta-debugging` algorithm | PASS | PASS | PASS | PASS | PASS | D6_NOT_APPLICABLE | D7_NOT_APPLICABLE |
| `project:wdd-artifact` source | FAIL | PASS | PASS | PASS | PASS | D6_NOT_APPLICABLE | D7_NOT_APPLICABLE |
| `project:wdd-artifact` project | FAIL | PASS | PASS | PASS | PASS | D6_NOT_APPLICABLE | D7_NOT_APPLICABLE |
| `paper:jin-chen-2026-llm-reviewer-reliability` | PASS | PASS | PASS | PASS | PASS | D6_NOT_APPLICABLE | D7_NOT_APPLICABLE |

The artifact D1 failures are deliberate: root GitHub code licensing and Zenodo component applicability are unresolved. They must not be normalized to PASS to make validation green. Research citation of the paper may proceed; importing/reusing artifact code requires license clarification. The image digest is a reproduction limitation and is not itself asserted to block paper-based research completion. The independent reviewer decides whether the bounded paper-only evidence suffices for a future experiment.

## Integration and verification handoff

Registry edits are reserved to the parent integrator. Required changes: WDD artifact source status → `SOURCE_PARTIALLY_VERIFIED`; retrieval dates for WDD paper/artifact and the reviewer study → `2026-10-27`; reviewer source path → `sources/code-review/paper-llm-reviewer-reliability-2026.yaml`. No new source, claim or algorithm IDs are needed.

Fresh raw API captures, file SHA-256 checks and local YAML parsing are the verification evidence for this bounded pass. The parent will issue the whole-registry validator and full regression after all source work is integrated. This report does not claim those checks passed or issue the fresh independent research verdict.

Executed scoped verification returned `SCOPED_PROVENANCE_CHECKS_PASS`: seven YAML records parsed; all five freshly captured file SHA-256 values checked; the 4,897-entry GitHub tree was complete with no root license; partial-source D1 failures, legal D6/D7 forms, claim authority=false and renamed-file absence were checked. The existing saved Zenodo README also matches the fresh API's MD5; its SHA-256 placeholder is replaced with the actual digest. Experiments run: 0. Runtime changes: 0.

Remaining items for review: GitHub root code license; Zenodo record/GPL file component applicability; unpinned historical container; unexecuted reproduction. Earlier independent review prose that declares Zenodo CC-BY to be metadata-only or the combined WDD source fully repository-verified is superseded by the scoped facts above. Existing algorithm/paper provenance corrections are preserved.
