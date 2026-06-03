#!/usr/bin/env node
// Build the static Sentinel web demo: bundle the audit engine for the browser.
// The HTML (web/dist/index.html) is hand-authored and embeds the two sample
// contracts inline (base64) so it has zero runtime fetch dependencies — surge
// refuses to serve .sol files, and a single self-contained page is the most
// robust thing to host. This script only (re)produces the JS bundle.
//
//   node web/build.mjs        # writes web/dist/sentinel.bundle.js
//   surge web/dist <domain>   # deploy (200.html mirrors index.html for SPA-style 404s)
//
// Live: https://sentinel-audit.surge.sh
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [resolve(here, "src/entry.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  outfile: resolve(here, "dist/sentinel.bundle.js"),
});
console.log("built web/dist/sentinel.bundle.js");
