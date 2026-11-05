# Patch Encoder (`packages/core/src/patch-encoder.ts`)

Standalone encoding + coordinate-mapping module for P0-4/5 of the AI change
scope verification plan. It exports its own types from `patch-encoder.ts`
(it does **not** touch `diff.ts`, `shrink.ts`, `types.ts` or the package
index). Scope: encoding and mapping only — no reducer, no Tree-sitter; the
runtime integration API is scheduled separately by the reviewer.

## `encodeSelectivePatch(input)`

```ts
interface SelectiveEdit {
  id: string;
  baseStartByte: number; // inclusive, UTF-8 byte offset into baseText
  baseEndByte: number;   // exclusive
  headStartByte: number; // inclusive, UTF-8 byte offset into headText
  headEndByte: number;   // exclusive
}

interface SelectivePatchInput {
  path: string;            // repo-relative, forward slashes
  baseText: string;
  headText: string;
  edits: SelectiveEdit[];  // must fully explain baseText -> headText
  keepEditIds?: string[];  // edits RETAINED in the reduced patch
  isSymlink?: boolean;     // rejected when true
  isNewFile?: boolean;     // rejected when true (caller owns newfile metadata)
  isDeletedFile?: boolean; // rejected when true (caller owns deletion metadata)
}

function encodeSelectivePatch(input: SelectivePatchInput):
  { patch: string; reducedText: string };
```

Semantics:

1. **Validation.** Rejects duplicate/unknown edit ids, out-of-bounds or
   inverted byte ranges, byte ranges that split a UTF-8 codepoint, edits
   overlapping on the base or head side, NUL bytes (binary), absolute /
   traversal / drive-relative / `.git` paths, symlink targets, and flagged
   whole-file creation or deletion. An existing empty file is a normal
   modification target.
2. **Coverage check.** Applying the *full* edit set to `baseText` must
   reproduce `headText` byte-for-byte, or the encoder throws
   (`edits do not fully explain the diff`).
3. **Reduction.** `reducedText` = `baseText` with only `keepEditIds` applied.
4. **Encoding.** The patch is regenerated from scratch with a real
   `git diff --no-index` (default 3-line context — ordinary applicable
   hunks, not `--unidiff-zero`) over temp files, with global/system
   gitconfig, attributes and external diff drivers disabled. Headers are
   rewritten onto the target path; the `@@` headers and offsets are always
   recomputed, never copied from an upstream hunk. Header paths use git
   quoting: bare when printable-ASCII without spaces/quotes/backslashes,
   otherwise double-quoted with `\"`, `\\`, `\t` and octal escapes for
   control and non-ASCII bytes (verified against real `git apply`).
5. **Fidelity.** CRLF endings, missing trailing newlines (`\ No newline at
   end of file`) and unicode content round-trip byte-for-byte. Returns
   `patch: ""` when nothing is kept.

Non-goals: whole-file create/delete, symlinks, binary content, mode/metadata
changes — the caller must handle those and never hand them here.

## `mapHunkCoordinates(patch)`

```ts
function mapHunkCoordinates(patch: string): HunkCoordinates[];

interface HunkCoordinates {
  oldStart: number; oldCount: number;
  newStart: number; newCount: number;
  lines: Array<{
    kind: "context" | "delete" | "add";
    baseLine?: number; // 1-based, context + delete lines
    headLine?: number; // 1-based, context + add lines
    text: string;      // verbatim diff line incl. marker
  }>;
  oldNoNewline: boolean;
  newNoNewline: boolean;
}
```

- Hunks are consumed strictly by their declared counts: mismatched counts
  (too few or too many lines) throw, and the next `@@`/file header is never
  swallowed as content. Content that merely *looks* like `---`/`+++` while
  counts are pending is parsed as content.
- Zero-count sides carry no lines. For `@@ -N,0 ...` the old start `N` is
  the line *after which* content is inserted; for `@@ ... +M,0 @@` the new
  start `M` is the line after which content is deleted.
- `\ No newline at end of file` after an add → `newNoNewline`; after a
  delete → `oldNoNewline`; after a context line → **both** sides end there.

## Tests

`tests/unit/patch-encoder.test.ts`. Acceptance for every produced patch is a
real `git apply --index` in a temp repo (forward result equals the expected
reduced text, reverse-apply restores the base text). Fixtures cover: two
independent function edits in one hunk with one dropped, four statement
deletions plus a business change retained selectively, far-apart hunks with
offset regeneration, top insertion + tail deletion, CRLF, no-newline EOF,
unicode + spaced paths, empty-file edits, and the rejection matrix. Test
cleanup uses async `fs.rm` with retries (Windows `rmSync` does not retry
transient `EPERM`).
