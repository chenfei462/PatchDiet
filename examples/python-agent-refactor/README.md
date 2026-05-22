# python-agent-refactor

Python demo scenario with a required feature change plus unrelated agent files.

```bash
npx patchdiet shrink --base main --head agent/bloated --test "python -m unittest discover -s tests -v"
```

Expected result: PatchDiet keeps the `multiply` behavior patch, removes the unrelated
agent notes, and writes `.patchdiet/cleanup.diff` plus Markdown/HTML reports.
