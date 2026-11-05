# VS Code Extension

PatchDiet should meet developers where review cleanup starts: inside the editor.

## What Exists Now

`extensions/vscode-patchdiet/` contains a bundled extension scaffold:

- `package.json` with commands and settings
- `extension.mjs` command activation
- `npm run bundle` for `dist/extension.mjs`
- `npm run package` for a local `.vsix` package
- activity bar container and `patchdiet.candidates` sidebar tree
- `PatchDiet: Analyze Current Git Diff`
- `PatchDiet: Copy Last Report`
- `PatchDiet: Open Candidate`
- `PatchDiet: Copy Suggestion`
- `PatchDiet: Run Dry-Run JSON`
- Webview with before/after metrics and deletion candidates

The extension bundles its runtime with esbuild, while treating `vscode` as external.

## Local Run

```bash
npm ci
npm run build
cd extensions/vscode-patchdiet
npm run package
code extensions/vscode-patchdiet
```

Press `F5` in VS Code, open a repository with changes, and run:

```text
PatchDiet: Analyze Current Git Diff
```

## Current Limits

- Preview mode is heuristic. It does not run tests.
- The extension still shells out to a globally available `patchdiet` binary for verified dry-run JSON.
- Marketplace and Open VSX publication still require publisher accounts and manual token setup.

## Package Smoke

```bash
npm run smoke:vscode
```

The smoke gate runs the extension `package` script, creates `patchdiet-vscode-<version>.vsix`, and checks the package contains:

- `extension.vsixmanifest`
- `extension/package.json`
- `extension/README.md`
- `extension/dist/extension.mjs`
- `extension/media/patchdiet.svg`

The root CI workflow runs `npm run smoke:vscode`, so the local VSIX package structure is protected before release.

## Acceptance Criteria For The Next Pass

1. Publish the generated `.vsix` to the VS Code Marketplace.
2. Publish the same package to Open VSX.
3. Add per-hunk line navigation.
4. Surface dry-run JSON failures in a friendly panel.
