# Contributing

## Setup

```bash
npm install
npm run build
npm test
```

## Development Rules

- keep changes local-first
- do not add cloud upload paths by default
- keep shrink behavior conservative
- add tests before production changes

## Useful Commands

```bash
npm run typecheck
npx vitest run
node dist/packages/cli/src/index.js --help
```

## Publishing

PatchDiet publishes to npm as a public package.

### Local publish prerequisites

- log into npm on this machine with `npm login` or `npm adduser`
- verify `npm whoami` succeeds
- publish with `npm publish --access public`

### GitHub Actions publish prerequisites

- configure npm trusted publishing for this repo/workflow and keep `id-token: write` enabled in `publish-npm.yml`
- use the `Publish npm` GitHub Actions workflow or publish from a GitHub release event
- keep `npm run build`, `npm run typecheck`, and `npm test` green before publishing
