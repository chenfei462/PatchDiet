# ts-bloated-pr

Canonical TypeScript demo for PatchDiet.

```bash
npx patchdiet shrink --base main --head agent/bloated
```

Expected result: PatchDiet auto-detects the root JS test script, keeps the
`multiply` implementation, removes unrelated docs and unused files, and writes
`.patchdiet/cleanup.diff` plus Markdown/HTML reports.
