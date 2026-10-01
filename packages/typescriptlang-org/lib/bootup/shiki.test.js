jest.mock("remark-shiki-twoslash", () => ({
  setupForFile: jest.fn(),
  remarkVisitor: jest.fn(),
}))

const { setupForFile, remarkVisitor } = require("remark-shiki-twoslash")
const plugin = require("gatsby-remark-shiki-twoslash")

const ast = (value = "const value = 1", lang = "ts", meta = undefined) => ({
  type: "root",
  children: [{ type: "code", value, lang, meta }],
})

let highlighter

beforeEach(() => {
  jest.clearAllMocks()
  highlighter = {
    codeToThemedTokens: jest.fn(() => [[{ content: "token", color: "#000" }]]),
  }
  setupForFile.mockImplementation(async settings => ({
    settings,
    highlighters: [highlighter],
  }))
  remarkVisitor.mockImplementation(highlighters => node => {
    const tokens = highlighters[0].codeToThemedTokens(node.value, node.lang)
    node.type = "html"
    node.value = `<div class='code-container'>${tokens[0][0].content}</div>`
    tokens[0][0].content = "mutated"
    node.children = []
  })
})

it("reuses highlighting without sharing mutable tokens or losing focusability", async () => {
  const first = ast()
  const second = ast()
  await plugin({ markdownAST: first }, {})
  await plugin({ markdownAST: second }, {})
  expect(highlighter.codeToThemedTokens).toHaveBeenCalledTimes(1)
  expect(highlighter.codeToThemedTokens).toHaveBeenCalledWith(
    "const value = 1",
    "ts",
    undefined,
    { includeExplanation: false }
  )
  expect(second).toEqual(first)
  expect(second.children[0].value).toContain("tabindex='0'>token")
  expect(setupForFile).toHaveBeenCalledTimes(2)
  expect(remarkVisitor).toHaveBeenCalledTimes(2)
})

it("keeps scopes for TSConfig property hovers", async () => {
  await plugin({ markdownAST: ast('{"strict": true}', "json", "tsconfig") }, {})
  expect(highlighter.codeToThemedTokens).toHaveBeenCalledWith(
    '{"strict": true}',
    "json",
    undefined,
    { includeExplanation: true }
  )
})

it("distinguishes languages and code", async () => {
  await plugin({ markdownAST: ast() }, {})
  await plugin({ markdownAST: ast("const value = 2") }, {})
  await plugin({ markdownAST: ast("const value = 1", "js") }, {})
  expect(highlighter.codeToThemedTokens).toHaveBeenCalledTimes(3)
})

it("does not cache highlighting failures", async () => {
  highlighter.codeToThemedTokens.mockImplementationOnce(() => {
    throw new Error("highlighting failed")
  })
  await expect(plugin({ markdownAST: ast() }, {})).rejects.toThrow(
    "highlighting failed"
  )
  await plugin({ markdownAST: ast() }, {})
  expect(highlighter.codeToThemedTokens).toHaveBeenCalledTimes(2)
})

it("isolates highlighter instances", async () => {
  const firstHighlighter = highlighter
  await plugin({ markdownAST: ast() }, {})
  highlighter = {
    codeToThemedTokens: jest.fn(() => [[{ content: "different theme" }]]),
  }
  const second = ast()
  await plugin({ markdownAST: second }, {})
  expect(firstHighlighter.codeToThemedTokens).toHaveBeenCalledTimes(1)
  expect(highlighter.codeToThemedTokens).toHaveBeenCalledTimes(1)
  expect(second.children[0].value).toContain("different theme")
})

it("bounds the highlighting cache", async () => {
  for (let i = 0; i < 257; i++) {
    await plugin({ markdownAST: ast(`const value = ${i}`) }, {})
  }
  await plugin({ markdownAST: ast("const value = 0") }, {})
  expect(highlighter.codeToThemedTokens).toHaveBeenCalledTimes(258)
})

describe("persistent Twoslash cache", () => {
  const fs = require("fs")
  const shikiTwoslash = require("shiki-twoslash")
  const { runTwoSlashOnNode } = jest.requireActual("remark-shiki-twoslash")
  const fence = lang => ({ lang, meta: { twoslash: true } })
  let runTwoSlash

  beforeEach(() => {
    const files = new Map()
    const existsSync = fs.existsSync
    const readFileSync = fs.readFileSync
    const writeFileSync = fs.writeFileSync
    const isCache = path =>
      typeof path === "string" &&
      (path.includes(".cache/twoslash") || path.includes(".cache\\twoslash"))
    jest
      .spyOn(fs, "existsSync")
      .mockImplementation(path =>
        isCache(path) ? files.has(path) : existsSync(path)
      )
    const mkdirSync = fs.mkdirSync
    jest
      .spyOn(fs, "mkdirSync")
      .mockImplementation((path, ...args) =>
        isCache(path) ? undefined : mkdirSync(path, ...args)
      )
    jest
      .spyOn(fs, "readFileSync")
      .mockImplementation((path, ...args) =>
        isCache(path) ? files.get(path) : readFileSync(path, ...args)
      )
    jest
      .spyOn(fs, "writeFileSync")
      .mockImplementation((path, data, ...args) => {
        if (isCache(path)) files.set(path, data)
        else writeFileSync(path, data, ...args)
      })
    runTwoSlash = jest
      .spyOn(shikiTwoslash, "runTwoSlash")
      .mockImplementation((code, lang, settings) => ({ code, lang, settings }))
  })

  afterEach(() => jest.restoreAllMocks())

  it("reuses identical semantic inputs", () => {
    const first = runTwoSlashOnNode("const value = 1", fence("ts"), {})
    const second = runTwoSlashOnNode("const value = 1", fence("ts"), {})
    expect(second).toEqual(first)
    expect(runTwoSlash).toHaveBeenCalledTimes(1)
  })

  it("distinguishes TypeScript from JavaScript", () => {
    runTwoSlashOnNode("const value = 1", fence("ts"), {})
    runTwoSlashOnNode("const value = 1", fence("js"), {})
    expect(runTwoSlash).toHaveBeenCalledTimes(2)
  })

  it("invalidates results when compiler or Twoslash options change", () => {
    runTwoSlashOnNode("const value = 1", fence("ts"), {})
    runTwoSlashOnNode("const value = 1", fence("ts"), {
      defaultCompilerOptions: { strict: true },
    })
    runTwoSlashOnNode("const value = 1", fence("ts"), {
      defaultOptions: { noErrors: true },
    })
    expect(runTwoSlash).toHaveBeenCalledTimes(3)
  })

  it("does not save failed compilations", () => {
    runTwoSlash.mockImplementationOnce(() => {
      throw new Error("compilation failed")
    })
    expect(() => runTwoSlashOnNode("bad code", fence("ts"), {})).toThrow(
      "compilation failed"
    )
    runTwoSlashOnNode("bad code", fence("ts"), {})
    expect(runTwoSlash).toHaveBeenCalledTimes(2)
  })
})
