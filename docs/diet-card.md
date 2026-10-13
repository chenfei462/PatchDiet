# Diet Card

Diet Card makes PatchDiet results screenshot-friendly and shareable.

## Generate From A Real Run

```bash
patchdiet shrink --test "npm test"
```

`patchdiet shrink` writes `.patchdiet/diet-card.svg` by default. Use `patchdiet card` when you want to re-render the same `.patchdiet/run.json` with a custom project name or another format:

```bash
patchdiet card --project "my-repo" --format html --output .patchdiet/diet-card.html
patchdiet card --project "my-repo" --format svg --output .patchdiet/diet-card.svg
patchdiet card --project "my-repo" --format png --output .patchdiet/diet-card.png
patchdiet card --format badge --badge-url "https://your-host.example/patchdiet/pr-123.svg" --output .patchdiet/patchdiet-badge.md
```

## Generate The Bundled Sample

```bash
npm run build
npm run card:sample
```

Outputs:

- `.patchdiet/diet-card.sample.html`
- `.patchdiet/diet-card.sample.svg`
- `.patchdiet/diet-card.sample.png`

## Badge Pattern

```markdown
![PatchDiet -42%](https://your-host.example/patchdiet/pr-123.svg)
```

Future hosted badge endpoint:

```text
GET /badge/:owner/:repo/:pull.svg
```

Response should be an SVG badge or redirect to a shields.io-style badge. The public endpoint should expose only aggregate metrics: saved percent, PR number, and status. It must not expose source code or full diff content.

## PNG Export

PNG export is local and deterministic. It avoids remote screenshot services and heavy native image dependencies by rasterizing the same 1200x628 Diet Card metrics with a small built-in renderer:

```bash
patchdiet card --format png --output .patchdiet/diet-card.png
```

Current acceptance criteria:

- no remote rendering service
- deterministic 1200x628 output
- works in CI on Linux
- no browser binaries required
