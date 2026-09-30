import { build } from "esbuild"
import { mkdir, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outputDirectory = resolve(packageDirectory, "out")

await rm(outputDirectory, { force: true, recursive: true })
await mkdir(outputDirectory, { recursive: true })
await build({
  absWorkingDir: packageDirectory,
  bundle: true,
  entryPoints: ["src/index.ts"],
  external: ["monaco-editor-core"],
  format: "esm",
  outfile: "out/index.js",
  platform: "browser",
  sourcemap: true,
  target: ["es2022"],
})
