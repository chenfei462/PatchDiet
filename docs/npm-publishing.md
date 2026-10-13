# npm Publishing Checklist

PatchDiet has package metadata and a trusted-publishing workflow. A maintainer still needs to complete the external npm release steps.

## Current Repository Readiness

- package name: `patchdiet`
- license: MIT
- bin: `patchdiet -> dist/packages/cli/src/index.js`
- package files allowlist: runtime `dist`, Action bundle, README, LICENSE
- build: `npm run build`
- typecheck: `npm run typecheck`
- tests: `npm test`
- prepublish gate: `prepublishOnly`
- publish workflow: `.github/workflows/publish-npm.yml`
- Action bundle freshness check: `.github/workflows/ci.yml`

## Maintainer Steps

1. Confirm npm package ownership for `patchdiet`.
2. Configure npm trusted publishing for the GitHub repository.
3. Create a GitHub Release for the version.
4. Let `.github/workflows/publish-npm.yml` publish with `id-token: write`.
5. Confirm:

```bash
npm view patchdiet version
npm exec -- patchdiet --help
```

## Pre-Release Smoke

```bash
npm ci
npm run build
npm run typecheck
npm test
npm pack --json --dry-run
npm run smoke:release
```

`npm run smoke:release` packs the current workspace, installs the tarball into a temporary project, runs `npm exec -- patchdiet --help`, and verifies `patchdiet init --preset node`.

## Versioning

- Patch releases: CLI/report/docs fixes
- Minor releases: GitHub App verified mode, VS Code packaged extension, parallel worktree engine
- Major releases: any change to default safety behavior or cleanup semantics
