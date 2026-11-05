# GitHub App

PatchDiet keeps the GitHub Action as a compatibility path, but the product direction is a one-click GitHub App that comments on every pull request without requiring users to write workflow YAML.

## What Exists Now

- `packages/github-app/src/server.mjs`: local webhook server with `/healthz` and `/github/webhook`
- `packages/github-app/src/auth.mjs`: GitHub App JWT generation and installation-token exchange
- `packages/github-app/src/analyzer.mjs`: pull request diff analysis bridge
- `packages/github-app/src/github-provider.mjs`: GitHub REST diff fetch and comment upsert abstraction
- `packages/github-app/src/comment.mjs`: PR comment renderer
- `packages/github-app/src/jobs.mjs`: in-memory preview queue with delivery-id idempotency and job status
- `packages/github-app/app-manifest.json`: manifest template
- `packages/github-app/.env.example`: environment variable template

When `PATCHDIET_GITHUB_APP_ID` and a private key are configured, the server exchanges `installation.id` for an installation token, fetches the real PR diff, creates or updates the PatchDiet PR comment, and can create a neutral preview check run. Without credentials it falls back to local preview payloads for development.

The current App is production-shaped preview, not hosted verified cleanup. Production verified mode still needs GitHub App registration, hosting, persistent queue/storage, and an isolated runner for test-verified `patchdiet shrink`.

## Local Run

```bash
npm run github-app:dev
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/jobs
```

For a local webhook smoke test, POST a pull request payload to `http://127.0.0.1:8787/github/webhook`. Include a `patchdiet_sample_diff` string in the JSON payload to avoid calling GitHub while developing.

When `PATCHDIET_GITHUB_WEBHOOK_SECRET` is set, requests must include `x-hub-signature-256`. Duplicate `x-github-delivery` values return the same job id instead of creating duplicate comments.

## Required GitHub Permissions

- `contents: read`: fetch pull request diffs or checkout sources in a runner
- `metadata: read`: required by GitHub Apps
- `pull_requests: read`: receive PR metadata
- `issues: write`: create or update the PatchDiet PR comment
- `checks: write`: optional, create neutral preview check runs or future verified check runs

Events:

- `pull_request`: `opened`, `reopened`, `synchronize`, `ready_for_review`

## Environment Variables

Copy `packages/github-app/.env.example` and set:

- `PATCHDIET_APP_PORT`
- `PATCHDIET_GITHUB_APP_ID`
- `PATCHDIET_GITHUB_CLIENT_ID`
- `PATCHDIET_GITHUB_CLIENT_SECRET`
- `PATCHDIET_GITHUB_PRIVATE_KEY_PATH`
- `PATCHDIET_GITHUB_WEBHOOK_SECRET`
- `PATCHDIET_DEFAULT_TEST_COMMAND`
- `PATCHDIET_COMMENT_MODE`

## Production Checklist

1. Register the GitHub App from `packages/github-app/app-manifest.json`.
2. Set the webhook URL to the hosted `/github/webhook` endpoint.
3. Store the webhook secret and private key in the hosting platform.
4. Confirm installation-token exchange from `installation.id`.
5. Confirm PR diff fetch through `GitHubProvider.getPullRequestDiff`.
6. Run preview analysis immediately for fast feedback.
7. Persist preview jobs and idempotency keys outside process memory.
8. Queue a trusted runner job that checks out the repo and runs `patchdiet shrink`.
9. Replace the preview comment with the test-verified report once the runner finishes.
10. Keep the Action documented as a fallback for teams that prefer workflow-controlled execution.

## Acceptance Criteria

- App installs with only the permissions above.
- Opening or updating a PR results in a PatchDiet comment when App credentials are configured.
- Fast preview webhooks return a job id immediately and preview jobs should complete in under 10 seconds for ordinary PRs.
- Verified mode never uploads source to third-party services unless a future user-facing upload toggle is explicitly enabled.
- Fork PRs degrade to preview/comment-only behavior when runner secrets are unavailable.
