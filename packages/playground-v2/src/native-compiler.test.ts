import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { test } from "node:test"
import { API } from "@typescript/typescript/unstable/sync"
import { instantiateWasm, WasmTransport } from "@typescript/typescript-wasip1-wasm"
import { NativeCompiler, type NativeCompileInput } from "./native-compiler"

test("native compiler reuses snapshots across edits, types, and configuration changes", async () => {
  const directory = process.env.PLAYGROUND_DIR!
  const module = await WebAssembly.compile(await readFile(`${directory}/vendor/typescript-wasip1-wasm/lib/tsc.wasm`))
  const transport = new WasmTransport({ instance: await instantiateWasm(module), cwd: "/workspace" })
  for (const name of await readdir(`${directory}/vendor/lib`)) {
    if (/^lib(?:\..+)?\.d\.ts$/.test(name)) transport.setFile(`/${name}`, await readFile(`${directory}/vendor/lib/${name}`, "utf8"))
  }
  const compiler = new NativeCompiler(new API({ transport }), transport)
  const configFileName = "/workspace/tsconfig.json"
  const source = "/workspace/src/index.ts"
  const config = { compilerOptions: { strict: true, target: "es2022", module: "commonjs", declaration: true }, include: ["src/**/*"] }
  const input: NativeCompileInput = {
    configFileName,
    sourceFiles: [source],
    files: {
      [configFileName]: JSON.stringify(config),
      [source]: "const answer = 42;\n//    ^?\n",
    },
  }
  try {
    const first = compiler.compile(input)
    assert.equal(first.diagnostics.length, 0)
    assert.match(first.outputFiles["/workspace/src/index.js"], /42/)
    assert(first.typeQueries[source].some(query => query.label.includes("42")))

    input.files[source] = 'const answer: number = "wrong";\n//    ^?\n'
    const changed = compiler.compile(input)
    assert(changed.diagnostics.some(diagnostic => diagnostic.code === 2322))
    assert.match(changed.outputFiles["/workspace/src/index.js"], /wrong/)
    assert(changed.typeQueries[source].some(query => query.label === ": number"))

    input.files[source] = 'import { value } from "pkg";\nconst answer: string = value;'
    assert(compiler.compile(input).diagnostics.some(diagnostic => diagnostic.code === 2307))
    input.files["/workspace/node_modules/pkg/package.json"] = '{"name":"pkg","types":"index.d.ts"}'
    input.files["/workspace/node_modules/pkg/index.d.ts"] = "export const value: string;"
    assert.equal(compiler.compile(input).diagnostics.length, 0)
    delete input.files["/workspace/node_modules/pkg/package.json"]
    delete input.files["/workspace/node_modules/pkg/index.d.ts"]
    assert(compiler.compile(input).diagnostics.some(diagnostic => diagnostic.code === 2307))

    input.files[source] = "const answer = 1;"
    input.files[configFileName] = JSON.stringify({ ...config, compilerOptions: { ...config.compilerOptions, noEmit: true } })
    assert.deepEqual(compiler.compile(input).outputFiles, {})
    input.files[configFileName] = JSON.stringify(config)
    assert.match(compiler.compile(input).outputFiles["/workspace/src/index.js"], /1/)

    const orphan = "/workspace/orphan.ts"
    input.sourceFiles = [source, orphan]
    input.files[orphan] = "const orphanValue = true;\n//    ^?\n"
    assert(compiler.compile(input).typeQueries[orphan].some(query => query.label.includes("true")))
  } finally {
    compiler.close()
  }
})
