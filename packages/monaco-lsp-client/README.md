# Monaco LSP Client

Private Playground v2 fork of the unpublished
`@vscode/monaco-lsp-client` package from
[`microsoft/monaco-editor` v0.56.0](https://github.com/microsoft/monaco-editor/tree/v0.56.0/monaco-lsp-client)
(commit `13f0c872dcf352815cc28d92dfff496c9839ea5c`).

The source was previously stored only in
`packages/playground-v2/vendor/vscode-monaco-lsp-client-0.1.0.tgz`, copied from
the GopherCon 2026 talk. It is checked in here so the Website builds the client
from source and the local changes can be reviewed and upstreamed.

## Local changes

- Track `/typescript/lib/lib*.d.ts` Monaco models for URI translation without
  synchronizing the server-owned documents.
- Use the current word as the fallback completion replacement range.
- Materialize and navigate to external definition models.
- Skip pull diagnostics for server-owned bundled library models.
- Bridge Monaco hover-verbosity requests to the TypeScript LSP extension.
- Declare the build dependencies required by the upstream Rolldown config.

The bundled-library and navigation policies are Playground-specific. They
should eventually be replaced by general upstream model lifecycle and model
resolution hooks.

## Build

```sh
pnpm --filter @typescript/monaco-lsp-client build
```

This uses the repository's existing esbuild and TypeScript toolchain. The
runtime is bundled as browser ESM with `monaco-editor-core` external, while
TypeScript emits the declaration module graph to `out/`.
