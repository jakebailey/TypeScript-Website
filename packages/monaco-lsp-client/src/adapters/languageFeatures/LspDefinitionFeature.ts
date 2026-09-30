import * as monaco from 'monaco-editor-core';
import { capabilities, DefinitionRegistrationOptions } from '../../../src/types';
import { Disposable } from '../../utils';
import { LspConnection } from '../LspConnection';
import { toMonacoLanguageSelector } from './common';
import { toMonacoLocation } from "./common";

export class LspDefinitionFeature extends Disposable {
    constructor(
        private readonly _connection: LspConnection,
    ) {
        super();

        this._register(this._connection.capabilities.addStaticClientCapabilities({
            textDocument: {
                definition: {
                    dynamicRegistration: true,
                    linkSupport: true,
                }
            }
        }));

        this._register(this._connection.capabilities.registerCapabilityHandler(capabilities.textDocumentDefinition, true, capability => {
            return monaco.languages.registerDefinitionProvider(
                toMonacoLanguageSelector(capability.documentSelector),
                new LspDefinitionProvider(this._connection, capability),
            );
        }));
    }
}

class LspDefinitionProvider implements monaco.languages.DefinitionProvider {
    constructor(
        private readonly _client: LspConnection,
        private readonly _capabilities: DefinitionRegistrationOptions,
    ) { }

    async provideDefinition(
        model: monaco.editor.ITextModel,
        position: monaco.Position,
        token: monaco.CancellationToken
    ): Promise<monaco.languages.Definition | monaco.languages.LocationLink[] | null> {
        const translated = this._client.bridge.translate(model, position);

        const result = await this._client.server.textDocumentDefinition({
            textDocument: translated.textDocument,
            position: translated.position,
        });

        if (!result) {
            return null;
        }

        const definitions = Array.isArray(result)
            ? result.map(loc => toMonacoLocation(loc, this._client))
            : [toMonacoLocation(result, this._client)];
        const external = definitions.find(definition => definition.uri.toString() !== model.uri.toString());
        if (external) {
            const targetModel = monaco.editor.getModel(external.uri);
            const editor = monaco.editor.getEditors().find(editor => editor.getModel() === model);
            if (targetModel && editor) {
                const range = 'targetSelectionRange' in external
                    ? external.targetSelectionRange ?? external.range
                    : external.range;
                editor.setModel(targetModel);
                editor.setSelection(range);
                editor.revealRangeInCenter(range, monaco.editor.ScrollType.Immediate);
                editor.focus();
                return null;
            }
        }

        return Array.isArray(result) ? definitions : definitions[0];
    }
}
