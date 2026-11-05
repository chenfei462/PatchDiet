# GitHub App Permissions

PatchDiet App preview needs the smallest practical permission set:

- `metadata: read`: required by GitHub Apps.
- `contents: read`: fetch PR diffs or checkout source for a verified runner.
- `pull_requests: read`: receive PR metadata.
- `issues: write`: create or update the PatchDiet PR comment.
- `checks: write`: create neutral preview check runs now and support verified check runs when enabled.

Events:

- `pull_request`: `opened`, `reopened`, `synchronize`, `ready_for_review`.

Preview mode reads PR metadata and diff text. Verified mode requires a trusted runner checkout of the PR branch and should be enabled only when the operator has configured runner isolation.

Fork PRs should degrade to preview/comment-only when secrets or write permissions are unavailable.
