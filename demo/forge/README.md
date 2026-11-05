# Patch Forge (3D) snapshot

This directory keeps the Three.js "Patch Forge" UI that was the default demo
before the liquid-glass redesign.

- Homepage: `/demo/forge/`
- Workspace: `/demo/forge/workspace.html`

It is self-contained: its own HTML, styles, motion code, and copy of the
workspace script (`app.js`, `insights.mjs`). `npm run demo:build` bundles it
into `demo/forge/generated/`, separately from the default `/demo/` UI.

Treat it like `/demo/classic/`: a preserved alternative. Only security,
runtime-compatibility, or build fixes should change it.
