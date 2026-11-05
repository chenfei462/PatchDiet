import { rm } from "node:fs/promises";

import { build } from "esbuild";

const shared = {
  bundle: true,
  sourcemap: true,
  target: ["es2022"],
  logLevel: "info"
};

/**
 * Bundles one demo UI: its homepage/workspace entries plus self-hosted fonts.
 * The default liquid-glass UI lives in `demo/`, the preserved Three.js
 * Patch Forge UI in `demo/forge/`.
 */
async function buildDemo(root) {
  const generatedDirectory = `${root}/generated`;
  await rm(generatedDirectory, { recursive: true, force: true });

  await build({
    ...shared,
    entryPoints: {
      homepage: `${root}/src/homepage-entry.js`,
      workspace: `${root}/src/workspace-entry.js`
    },
    outdir: generatedDirectory,
    format: "esm",
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    entryNames: "[name]"
  });

  await build({
    ...shared,
    entryPoints: [`${root}/src/fonts.css`],
    outfile: `${generatedDirectory}/fonts.css`,
    assetNames: "fonts/[name]-[hash]",
    loader: { ".woff": "file", ".woff2": "file" }
  });
}

await buildDemo("demo");
await buildDemo("demo/forge");
