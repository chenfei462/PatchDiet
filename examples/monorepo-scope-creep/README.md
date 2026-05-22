# monorepo-scope-creep

Monorepo demo scenario with a real feature patch plus unrelated docs and scratch files.

```bash
npx patchdiet shrink --base main --head agent/bloated --test "node --test packages/app/test/math.test.js"
```

Expected result: PatchDiet keeps the app math change, removes docs/scratch scope creep,
and writes `.patchdiet/cleanup.diff` plus Markdown/HTML reports.
