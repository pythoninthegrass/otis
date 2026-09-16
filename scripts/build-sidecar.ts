#!/usr/bin/env bun

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
process.chdir(root)

// Tauri resolves `externalBin` by appending the Rust host triple to the configured name
// (`otis-runtime-<rust-triple>`), then strips that suffix when copying into the app bundle.
// Bun's `--target` strings use different names, so the mapping below is explicit rather than
// derived by string manipulation — never guess one from the other.
const RUST_TRIPLE_TO_BUN_TARGET: Record<string, string> = {
  "aarch64-apple-darwin": "bun-darwin-arm64",
  "x86_64-apple-darwin": "bun-darwin-x64",
  "aarch64-unknown-linux-gnu": "bun-linux-arm64",
  "x86_64-unknown-linux-gnu": "bun-linux-x64",
}

const requestedTriple = process.argv[2]
const triples = requestedTriple ? [requestedTriple] : Object.keys(RUST_TRIPLE_TO_BUN_TARGET)

const outDir = path.join(root, "src-tauri", "binaries")
await fs.promises.mkdir(outDir, { recursive: true })

for (const triple of triples) {
  const bunTarget = RUST_TRIPLE_TO_BUN_TARGET[triple]
  if (!bunTarget) {
    throw new Error(`Unknown Rust host triple: ${triple}`)
  }

  const outfile = path.join(outDir, `otis-runtime-${triple}`)
  console.log(`Building sidecar for ${triple} (bun target ${bunTarget})...`)

  const result = await Bun.build({
    entrypoints: ["./src/desktop/sidecar/index.ts"],
    compile: {
      target: bunTarget,
      outfile,
    },
    sourcemap: "none",
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`Sidecar build failed for ${triple}`)
  }

  await fs.promises.chmod(outfile, 0o755)
  console.log(`  -> ${outfile}`)
}
