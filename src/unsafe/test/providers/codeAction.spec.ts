'use strict';

import * as assert from 'assert';
import * as path from 'path';
import fs from 'fs';

import * as sinon from 'sinon';
import { Stats } from '@nodelib/fs.macchiato';
import { CodeAction } from 'vscode-languageserver';
import { URI } from 'vscode-uri';

import StorageService from '../../services/storage.js';
import ImportGraphService from '../../services/importGraph.js';
import { doCodeAction } from '../../providers/codeAction.js';
import { MAX_COLOR_CANDIDATES } from '../../utils/colorCandidates.js';
import type { IDocumentSymbols } from '../../types/symbols.js';
import type { ISettings } from '../../types/settings.js';
import * as helpers from '../helpers.js';

function fsPath(name: string): string {
	return path.join(process.cwd(), name);
}

function makeDoc(overrides: Partial<IDocumentSymbols> & { filepath: string }): IDocumentSymbols {
	return {
		document: overrides.filepath,
		variables: [],
		mixins: [],
		functions: [],
		imports: [],
		uses: [],
		forwards: [],
		customProperties: [],
		...overrides
	};
}

async function codeActionAt(lines: string[], storage: StorageService, importGraph: ImportGraphService, settings?: Partial<ISettings>): Promise<CodeAction[]> {
	const text = lines.join('\n');
	const offset = text.indexOf('|');
	const uri = URI.file(fsPath('main.scss')).toString();
	const document = helpers.makeDocument(text.replace('|', ''), { uri });

	const position = document.positionAt(offset);

	return doCodeAction(document, { start: position, end: position }, storage, importGraph, helpers.makeSettings(settings));
}

function titles(actions: CodeAction[]): string[] {
	return actions.map(action => action.title);
}

describe('Providers/CodeAction', () => {
	let statStub: sinon.SinonStub;

	beforeEach(() => {
		statStub = sinon.stub(fs, 'stat').yields(null, new Stats());
	});

	afterEach(() => {
		statStub.restore();
	});

	it('returns [] when the cursor is not on a color literal', async () => {
		const storage = new StorageService();
		const importGraph = new ImportGraphService(storage);

		const actions = await codeActionAt(['.a { color: $prim|ary; }'], storage, importGraph);

		assert.deepStrictEqual(actions, []);
	});

	it('returns [] when no candidate matches the literal color', async () => {
		const storage = new StorageService();
		const importGraph = new ImportGraphService(storage);

		const actions = await codeActionAt(['.a { color: #12ab|34; }'], storage, importGraph);

		assert.deepStrictEqual(actions, []);
	});

	it('offers a bare $name replacement for a same-file variable', async () => {
		const storage = new StorageService();
		const importGraph = new ImportGraphService(storage);

		const actions = await codeActionAt([
			'$brand: #ff0000;',
			'.a { color: #ff00|00; }'
		], storage, importGraph);

		assert.deepStrictEqual(titles(actions), ['Replace with $brand (current)']);

		const edit = actions[0]?.edit?.changes?.[URI.file(fsPath('main.scss')).toString()];
		assert.strictEqual(edit?.length, 1);
		assert.strictEqual(edit?.[0]?.newText, '$brand');
	});

	it('excludes the literal from offering itself as a candidate when it is inside its own declaration', async () => {
		const storage = new StorageService();
		const importGraph = new ImportGraphService(storage);

		const actions = await codeActionAt(['$brand: #ff00|00;'], storage, importGraph);

		assert.deepStrictEqual(actions, []);
	});

	it('offers a bare $name replacement for a variable reachable via @import', async () => {
		const storage = new StorageService();
		const importGraph = new ImportGraphService(storage);

		storage.set(URI.file(fsPath('shared.scss')).toString(), makeDoc({
			filepath: fsPath('shared.scss'),
			variables: [{ name: '$shared-brand', value: '#112233', offset: 0, position: { line: 0, character: 0 } }]
		}));

		const actions = await codeActionAt([
			'@import "shared.scss";',
			'.a { color: #1122|33; }'
		], storage, importGraph);

		assert.deepStrictEqual(titles(actions), ['Replace with $shared-brand (shared.scss)']);
	});

	it('reuses an existing @use namespace instead of inserting a new one', async () => {
		const storage = new StorageService();
		const importGraph = new ImportGraphService(storage);

		storage.set(URI.file(fsPath('palette.scss')).toString(), makeDoc({
			filepath: fsPath('palette.scss'),
			variables: [{ name: '$accent', value: '#445566', offset: 0, position: { line: 0, character: 0 } }]
		}));

		const actions = await codeActionAt([
			"@use 'palette.scss' as p;",
			'.a { color: #4455|66; }'
		], storage, importGraph);

		assert.deepStrictEqual(titles(actions), ['Replace with $accent (palette.scss)']);

		const edit = actions[0]?.edit?.changes?.[URI.file(fsPath('main.scss')).toString()];
		assert.strictEqual(edit?.length, 1);
		assert.strictEqual(edit?.[0]?.newText, 'p.$accent');
	});

	it('inserts a new @use, picking a non-colliding namespace, after the existing @use block', async () => {
		const storage = new StorageService();
		const importGraph = new ImportGraphService(storage);

		storage.set(URI.file(fsPath('accent.scss')).toString(), makeDoc({
			filepath: fsPath('accent.scss'),
			variables: [{ name: '$brand', value: '#abcdef', offset: 0, position: { line: 0, character: 0 } }]
		}));

		const actions = await codeActionAt([
			"@use 'existing.scss' as accent;",
			"@use 'other.scss' as helper;",
			'.a { color: #abcd|ef; }'
		], storage, importGraph);

		assert.deepStrictEqual(titles(actions), ['Replace with $brand (accent.scss) (adds @use)']);

		const edit = actions[0]?.edit?.changes?.[URI.file(fsPath('main.scss')).toString()];
		assert.strictEqual(edit?.length, 2);
		assert.strictEqual(edit?.[0]?.newText, 'accent-2.$brand');
		assert.strictEqual(edit?.[1]?.newText, "@use 'accent' as accent-2;\n");
		assert.deepStrictEqual(edit?.[1]?.range, { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } });
	});

	it('offers a var(--x) replacement for a matching custom property', async () => {
		const storage = new StorageService();
		const importGraph = new ImportGraphService(storage);

		storage.set(URI.file(fsPath('tokens.scss')).toString(), makeDoc({
			filepath: fsPath('tokens.scss'),
			customProperties: [{ name: '--brand', value: '#ff9900', offset: 0, position: { line: 0, character: 0 }, isRootScope: true }]
		}));

		const actions = await codeActionAt(['.a { color: #ff99|00; }'], storage, importGraph);

		assert.deepStrictEqual(titles(actions), ['Replace with var(--brand) (tokens.scss)']);

		const edit = actions[0]?.edit?.changes?.[URI.file(fsPath('main.scss')).toString()];
		assert.strictEqual(edit?.[0]?.newText, 'var(--brand)');
	});

	it('caps the number of variable candidates offered', async () => {
		const storage = new StorageService();
		const importGraph = new ImportGraphService(storage);

		storage.set(URI.file(fsPath('many.scss')).toString(), makeDoc({
			filepath: fsPath('many.scss'),
			variables: Array.from({ length: MAX_COLOR_CANDIDATES + 10 }, (_, i) => ({
				name: `$v${i}`,
				value: '#123123',
				offset: i,
				position: { line: 0, character: 0 }
			}))
		}));

		const actions = await codeActionAt(['.a { color: #1231|23; }'], storage, importGraph);

		assert.strictEqual(actions.length, MAX_COLOR_CANDIDATES);
	});

	describe('var() fallback trigger', () => {
		it('offers whole-call replacement with a matching $variable and a matching real custom property, dropping the fallback', async () => {
			const storage = new StorageService();
			const importGraph = new ImportGraphService(storage);

			storage.set(URI.file(fsPath('tokens.scss')).toString(), makeDoc({
				filepath: fsPath('tokens.scss'),
				customProperties: [{ name: '--real', value: '#ff0000', offset: 0, position: { line: 0, character: 0 }, isRootScope: true }]
			}));

			const actions = await codeActionAt([
				'$brand: #ff0000;',
				'.a { color: var(--w|ont-exist, #ff0000); }'
			], storage, importGraph);

			assert.deepStrictEqual(titles(actions).sort(), ['Replace with $brand (current)', 'Replace with var(--real) (tokens.scss)'].sort());

			const uri = URI.file(fsPath('main.scss')).toString();
			for (const action of actions) {
				const edit = action.edit?.changes?.[uri];
				assert.strictEqual(edit?.length, 1);
				assert.deepStrictEqual(edit?.[0]?.range, {
					start: { line: 1, character: 12 },
					end: { line: 1, character: 38 }
				});
			}
		});

		it('returns [] when the property name already resolves to a real declared custom property', async () => {
			const storage = new StorageService();
			const importGraph = new ImportGraphService(storage);

			storage.set(URI.file(fsPath('existing-tokens.scss')).toString(), makeDoc({
				filepath: fsPath('existing-tokens.scss'),
				customProperties: [{ name: '--already-real', value: '#cccccc', offset: 0, position: { line: 0, character: 0 }, isRootScope: true }]
			}));

			const actions = await codeActionAt(['.a { color: var(--al|ready-real, #ff0000); }'], storage, importGraph);

			assert.deepStrictEqual(actions, []);
		});

		it('matches the fallback color case-insensitively', async () => {
			const storage = new StorageService();
			const importGraph = new ImportGraphService(storage);

			storage.set(URI.file(fsPath('tokens.scss')).toString(), makeDoc({
				filepath: fsPath('tokens.scss'),
				customProperties: [{ name: '--white', value: '#fff', offset: 0, position: { line: 0, character: 0 }, isRootScope: true }]
			}));

			const actions = await codeActionAt(['.a { color: var(--wo|nt-exist2, #FFF); }'], storage, importGraph);

			assert.deepStrictEqual(titles(actions), ['Replace with var(--white) (tokens.scss)']);
		});
	});
});
