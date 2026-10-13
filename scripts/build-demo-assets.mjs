import { rm } from "node:fs/promises";

import { build } from "esbuild";

const generatedDirectory = "demo/generated";

await rm(generatedDirectory, { recursive: true, force: true });

const shared = {
  bundle: true,
  sourcemap: true,
  target: ["es2022"],
  logLevel: "info"
};

const browserEntries = {
  homepage: "demo/src/homepage-entry.js",
  workspace: "demo/src/workspace-entry.js"
};

await build({
  ...shared,
  entryPoints: browserEntries,
  outdir: generatedDirectory,
  format: "esm",
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  entryNames: "[name]"
});

await build({
  ...shared,
  entryPoints: ["demo/src/fonts.css"],
  outfile: `${generatedDirectory}/fonts.css`,
  assetNames: "fonts/[name]-[hash]",
  loader: { ".woff": "file", ".woff2": "file" }
});
