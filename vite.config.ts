import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Plugin } from "vite"
import { defineConfig } from "vite"
import { inlineCanvas } from "./scripts/vite-inline-canvas.js"

const root = fileURLToPath(new URL(".", import.meta.url))

/** Mirrors Bun's built-in text loader (`import … with { type: "text" }`) for the system-prompt asset; this Vite
 * build runs under Tauri's dev/build tooling, not Bun, so the loader must be reproduced here too. */
const inlineText: Plugin = {
  name: "otis-inline-text",
  enforce: "pre",
  async load(id) {
    if (!id.endsWith(".txt")) return null
    return `export default ${JSON.stringify(await readFile(id, "utf8"))}`
  },
}

export default defineConfig({
  root: `${root}src/desktop/renderer`,
  plugins: [react(), inlineCanvas(), inlineText],
  build: {
    outDir: `${root}out/tauri-renderer`,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: `${root}src/desktop/renderer/index.html`,
        canvas: `${root}src/desktop/renderer/canvas.html`,
      },
    },
  },
})
