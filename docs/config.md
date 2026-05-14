# Config

Example `patchdiet.yaml`:

```yaml
version: 1
base: origin/main
commands:
  required:
    - node --test
  optional: []
reduction:
  strategy: conservative
  atom_granularity: hunk
scope:
  ignore_paths: []
report:
  html: true
  markdown: true
  github_comment: true
```

Generated run artifacts are written to `.patchdiet/`, including:

- `run.json`
- `report.md`
- `report.html`
- `report.github.md`

The CLI can re-render a stored run with `patchdiet report --format markdown|html|github|json`.
