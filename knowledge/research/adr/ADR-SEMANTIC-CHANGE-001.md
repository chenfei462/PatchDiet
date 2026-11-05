# ADR-SEMANTIC-CHANGE-001: Treat semantic diff tools as evidence adapters

- Status: ACCEPTED
- Date: 2026-10-26
- Scope: `packages/core/src/diff.ts`, `packages/core/src/insights.ts`, `packages/core/src/ast-atomizer.ts`

## Decision

PatchDiet will represent change evidence in layers: Git text/metadata diff, parser-derived structure, and optional semantic/refactoring evidence. The proposed vocabulary is advisory:

`TextModification`, `SymbolModification`, `SymbolAddition`, `SymbolDeletion`, `Rename`, `Move`, `MoveAndRename`, `Extract`, `Inline`, `DependencyChange`, `GeneratedArtifactChange`, `TestChange`, `PublicApiChange`, `MigrationChange`, and `UnsupportedChange`.

The vocabulary is not added to the runtime until a benchmark shows that it improves candidate grouping or review effort. GumTree and RefactoringMiner remain adapter or research-only options because their JVM and language-specific assumptions are not justified by current evidence.

## Evidence order

Source references: `standard:git-diff-format`, `project:tree-sitter`, `project:gumtree`, `project:refactoringminer`. These establish capabilities and normative formats, not measured PatchDiet gains.

1. Git diff and patch metadata remain the fidelity source of truth.
2. Tree-sitter or existing parsers provide structural atoms and changed ranges.
3. GumTree/RefactoringMiner-style matches may annotate moves and refactorings with confidence.
4. The executable verification oracle decides whether a candidate is acceptable.

## Rejected shortcut

An LLM-generated meaning or a detected refactoring cannot be converted directly into `VERIFIED_REMOVABLE`.

## Validation

Existing parser and diff fixtures are the baseline. A future adapter experiment must report match precision, runtime, semantic reduction, and review effort separately.
