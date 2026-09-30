import * as monaco from 'monaco-editor-core';
import { capabilities, Hover, HoverParams, HoverRegistrationOptions, MarkupContent, MarkedString, MarkupKind } from '../../../src/types';
import { Disposable } from '../../utils';
import { LspConnection } from '../LspConnection';
import { toMonacoLanguageSelector } from './common';

export class LspHoverFeature extends Disposable {
    constructor(
        private readonly _connection: LspConnection,
    ) {
        super();

        this._register(this._connection.capabilities.addStaticClientCapabilities({
            textDocument: {
                hover: {
                    dynamicRegistration: true,
                    contentFormat: [MarkupKind.Markdown, MarkupKind.PlainText],
                }
            },
            experimental: {
                hoverVerbosityLevel: true,
            },
        }));

        this._register(this._connection.capabilities.registerCapabilityHandler(capabilities.textDocumentHover, true, capability => {
            return monaco.languages.registerHoverProvider(
                toMonacoLanguageSelector(capability.documentSelector),
                new LspHoverProvider(this._connection, capability),
            );
        }));
    }
}

interface LspVerboseHover extends monaco.languages.Hover {
    verbosityLevel: number;
}

interface VerboseHoverParams extends HoverParams {
    verbosityLevel: number;
}

interface VerboseHover extends Hover {
    canIncreaseVerbosity?: boolean;
}

class LspHoverProvider implements monaco.languages.HoverProvider<LspVerboseHover> {
    constructor(
        private readonly _client: LspConnection,
        private readonly _capabilities: HoverRegistrationOptions,
    ) { }

    async provideHover(
        model: monaco.editor.ITextModel,
        position: monaco.Position,
        token: monaco.CancellationToken,
        context?: monaco.languages.HoverContext<LspVerboseHover>,
    ): Promise<LspVerboseHover | null> {
        const translated = this._client.bridge.translate(model, position);
        const verbosityLevel = Math.max(
            0,
            (context?.verbosityRequest?.previousHover.verbosityLevel ?? 0)
                + (context?.verbosityRequest?.verbosityDelta ?? 0),
        );

        const params: VerboseHoverParams = {
            textDocument: translated.textDocument,
            position: translated.position,
            verbosityLevel,
        };
        const result = await this._client.server.textDocumentHover(params) as VerboseHover | null;

        if (!result || !result.contents) {
            return null;
        }

        return {
            contents: toMonacoMarkdownString(result.contents),
            range: result.range ? this._client.bridge.translateBackRange(translated.textDocument, result.range).range : undefined,
            canIncreaseVerbosity: result.canIncreaseVerbosity,
            canDecreaseVerbosity: verbosityLevel > 0,
            verbosityLevel,
        };
    }
}

function toMonacoMarkdownString(
    contents: MarkupContent | MarkedString | MarkedString[]
): monaco.IMarkdownString[] {
    if (Array.isArray(contents)) {
        return contents.map(c => toSingleMarkdownString(c));
    }
    return [toSingleMarkdownString(contents)];
}

function toSingleMarkdownString(content: MarkupContent | MarkedString): monaco.IMarkdownString {
    if (typeof content === 'string') {
        return { value: content };
    }
    if ('kind' in content) {
        // MarkupContent
        return { value: content.value };
    }
    // MarkedString with language
    return { value: `\`\`\`${content.language}\n${content.value}\n\`\`\`` };
}
