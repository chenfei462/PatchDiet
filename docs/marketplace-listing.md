# GitHub Marketplace Listing

PatchDiet needs a listing package that tells the story fast and does not overclaim. This is a draft package until the external GitHub Marketplace submission is completed and install-tested.

## Required Assets

- App logo
- 3 screenshots
  - PR comment before/after
  - HTML report
  - Diet Card
- 60-second GIF
- permissions explanation
- privacy policy link
- support link
- terms link

## Listing Copy

### Short Summary

PatchDiet shrinks bloated AI-generated pull requests into smaller, test-verified cleanup patches.

### What it Does

- Reads a pull request diff
- classifies noisy changes
- replays your tests in temporary worktrees
- publishes a comment, report, and cleanup patch

### Why Permissions Are Needed

- `contents: read` for PR diff and checkout
- `pull_requests: read` for PR metadata
- `issues: write` for PR comments
- `checks: write` for preview or verified status

### Privacy Statement

- No source upload by default
- No LLM required by default
- Preview mode only reads the PR diff and metadata
- Verified mode uses a trusted runner checkout and the user-selected test command

## Submission Checklist

1. Export the three screenshots.
2. Confirm the GIF plays in under 60 seconds.
3. Verify the permissions explanation matches `docs/github-app-permissions.md`.
4. Link the privacy, support, and terms pages.
5. Submit the draft listing from the App/Marketplace console.
6. Install-test the App in a test organization before describing Marketplace as live.

## Current Release Status

- Marketplace listing: draft package only.
- GitHub App: local skeleton and documentation are present.
- Judge path: use the local demo, local CLI, and local tarball proof instead of assuming Marketplace availability.
