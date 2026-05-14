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
