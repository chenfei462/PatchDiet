# PatchDiet VS Code Extension

This is the minimum runnable extension scaffold for PatchDiet inside VS Code.

## Current Behavior

- Command: `PatchDiet: Analyze Current Git Diff`
- Reads the configured git diff command, defaulting to `git diff origin/main...HEAD`
- Calls PatchDiet preview analysis from the built workspace package
- Opens a webview with before/after files, lines, suggested deletion hunks, and copyable report text
- Command: `PatchDiet: Copy Last Report`

## Local Development

From the repository root:

```bash
npm ci
npm run build
code extensions/vscode-patchdiet
```

Then press `F5` in VS Code to launch an extension host and run `PatchDiet: Analyze Current Git Diff`.

## Next Implementation Steps

1. Bundle `packages/core` into the extension instead of importing from `dist`.
2. Add a sidebar tree view for candidates.
3. Add buttons to open candidate files and copy individual suggestions.
4. Add an option to run `patchdiet shrink --dry-run --json` when the user has configured a test command.
5. Package with `vsce` once the command and webview are stable.
