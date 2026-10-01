import { build } from "esbuild"
import { spawnSync } from "node:child_process"
import { mkdir, rm } from "node:fs/promises"
import { resolve } from "node:path"

const packageDirectory = resolve(import.meta.dirname, "..")
const testFile = resolve(packageDirectory, "dist/ata.test.mjs")
await mkdir(resolve(packageDirectory, "dist"), { recursive: true })
try {
  await build({
    absWorkingDir: packageDirectory,
    bundle: true,
    conditions: ["browser"],
    entryPoints: ["src/ata/ata.test.ts"],
    external: ["jsonc-parser"],
    format: "esm",
    outfile: testFile,
    platform: "node",
    target: ["es2022"],
  })
  const result = spawnSync(process.execPath, ["--test", testFile], {
    env: { ...process.env, PLAYGROUND_DIR: packageDirectory },
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
  await rm(testFile, { force: true })
}
