# Self Hosting

## GitHub App Preview

```bash
cp packages/github-app/.env.example packages/github-app/.env
npm run build
npm run github-app:dev
```

Expose `/github/webhook` through your hosting platform and set `PATCHDIET_GITHUB_WEBHOOK_SECRET`.

## Required Secrets

- `PATCHDIET_GITHUB_APP_ID`
- `PATCHDIET_GITHUB_PRIVATE_KEY_PATH`
- `PATCHDIET_GITHUB_WEBHOOK_SECRET`

## Production Notes

- Terminate TLS at the edge.
- Keep private keys outside the repository.
- Do not log installation tokens.
- Run verified jobs in isolated workspaces.
- Clean runner workspaces after each job.
- Keep preview and verified comments clearly labeled.
