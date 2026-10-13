# GitHub App development adapter

This is an **isolated post-MVP development candidate**, not the accepted 0.2.0 delivery or a deployed App. The App server offers a local preview and a credentialed GitHub adapter. No hosting, App installation, customer runner or natural PR pilot has been completed.

## Modes and trust boundary

- With `PATCHDIET_ALLOW_UNSIGNED_PREVIEW=1` in a non-production environment and no App credentials, the server accepts synthetic local webhook payloads and returns diff counts. This mode makes no GitHub API calls. The smoke script uses this mode.
- Connected mode requires an App id, private key file, HMAC webhook secret and admin token. A signed `pull_request` event pins repository id, owner/name, installation id, PR number, base SHA and head SHA. The server fetches the current PR and diff through the installation token, then posts a **neutral preview** Check Run and comment. It does not execute PR code or create a branch on PR open/synchronize.
- `POST /runner/receipts` accepts a separate HMAC-signed receipt from a trusted runner configured with `PATCHDIET_RUNNER_RECEIPT_SECRET`. It must match a completed preview job and current PR head/base. Only then does the server post a success Check Run with bounded annotations and up to three actions. The server trusts the runner's exact-artifact and final-oracle claims; it cannot independently re-run the repository oracle from digest fields alone. Keep the runner secret isolated from PR code and sign only after actual local verification.
- `check_run.requested_action` must be a signed GitHub webhook matching the verified check id, pinned head, repository and installation. One candidate can receive Accept/Reject buttons. Its decision is an **in-memory feedback intent**, visible through authenticated `GET /runner/actions`; it is not yet durable, authenticated human attribution or an automatic import into local `patchdiet feedback`. A cleanup branch action appears only if `PATCHDIET_ENABLE_CLEANUP_BRANCH=1` and the signed receipt names a cleanup commit. Before creating a ref, the App rechecks the PR and verifies that the commit has exactly the pinned PR head as its sole parent. The trusted runner remains responsible for constructing that commit from the verified artifact. A real installation needs the separate `app-manifest.cleanup-branch.json` with `contents: write`; the default manifest retains `contents: read`.

No provider response, model output, PR body or reviewer note can authorize a deletion. The server has no arbitrary command endpoint.

## Endpoints

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /healthz` | public | Status and actual mode (`local-preview` or `connected-preview`). |
| `POST /github/webhook` | GitHub HMAC, except explicit local unsigned preview | PR and requested-action events. Delivery IDs are deduplicated while jobs remain retained. |
| `POST /runner/receipts` | separate runner HMAC | Accept a matching verified artifact receipt. |
| `GET /jobs`, `GET /jobs/:id`, `GET /runner/actions` | admin bearer token in connected mode | Private bounded in-memory job and feedback views. |

The request body limit is 1 MiB. GitHub response bodies are capped at 1 MiB, jobs at 500, annotations at 50 and a Check Run at three actions. These are per-process limits; in-memory deduplication and decisions do not survive restart.

## Trusted runner receipt v1

The runner sends one JSON object, with `x-patchdiet-runner-signature-256: sha256=<HMAC-SHA256 of exact request bytes>`:

```json
{
  "jobId": "preview-1",
  "owner": "octocat", "repo": "demo", "repositoryId": 77,
  "installationId": 9, "pullNumber": 6,
  "baseSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "headSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "reportSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "cleanupDiffSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "verification": { "exactArtifact": true, "finalOraclePassed": true },
  "annotations": [{ "path": "src/a.ts", "startLine": 1, "endLine": 1, "message": "Review this candidate" }],
  "candidates": [{ "id": "candidate-1", "contentSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" }]
}
```

`cleanupCommitSha` is optional and is required for the branch button. The App accepts at most one candidate per Check Run so Accept, Reject and optional Branch fit GitHub's three-action limit. The digest fields bind the runner's assertions, but the App does not receive source or patch contents. A production runner must derive them from genuine `run.json` and `cleanup.diff`, verify the exact final artifact, then sign the receipt. The mocked HTTP integration test exercises signature, replay, cross-installation, stale head, Check Run, annotation, feedback and branch gates. It does not prove a live runner exists.

`packages/github-app/src/runner-receipt.mjs` provides `buildSignedRunnerReceipt({ cwd, context, secret, cleanupCommitSha? })` for the trusted runner. It reads regular local artifacts, checks the emission-time patch digest, pinned Git refs, final oracle and matching artifact tree, then signs exact JSON bytes. A genuine shrink-artifact test verifies it refuses a changed patch. The caller must keep `secret` out of untrusted PR code and send the returned `body` unchanged with the returned signature.

## Local smoke

Run `node scripts/github-app-smoke.mjs` from the repository. The script builds the development candidate, starts the local-only server, submits a synthetic PR diff and checks the job. For manual local use, set `PATCHDIET_ALLOW_UNSIGNED_PREVIEW=1` and `PATCHDIET_APP_PORT=8787`, then run `node packages/github-app/src/server.mjs` and query `http://127.0.0.1:8787/healthz`. Populate `packages/github-app/.env.example` in your own secret manager; Node does not load that file automatically.

## Deployment prerequisites and remaining proof

1. Replace placeholder domains in the chosen App manifest. Register and install the App, obtain its id and private key, configure the webhook URL and HMAC secret, and verify permissions and `pull_request` plus `check_run` subscriptions.
2. Provide an HTTPS host and a private authenticated channel from a customer-controlled runner. The runner must hold the separate receipt secret outside untrusted PR code and actually run the required commands and final artifact check.
3. Replace the in-memory queue, receipt/feedback state and delivery dedupe with transactional persistent storage and restart-safe idempotency. Add delivery retries and cleanup-ref conflict handling.
4. Perform a live installation smoke and a consented natural PR pilot. Until then, connected mock integration is verified locally, while live deployment and production effectiveness are **NOT VERIFIED**.

No credential, hosting account, installed App, runner endpoint or human-labelled natural PR sample was supplied for this development pass. No live GitHub mutation or customer message was made.
