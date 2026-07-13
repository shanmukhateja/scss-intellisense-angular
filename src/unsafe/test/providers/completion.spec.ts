'use strict';

import * as assert from 'assert';
import * as path from 'path';
import fs from 'fs';

import * as sinon from 'sinon';
import { Stats } from '@nodelib/fs.macchiato';
import { CompletionItemKind, CompletionList } from 'vscode-languageserver';
import { URI } from 'vscode-uri';

import StorageService from '../../services/storage.js';
import ImportGraphService from '../../services/importGraph.js';
import { doCompletion } from '../../providers/completion.js';
import * as helpers from '../helpers.js';
import type { ISettings } from '../../types/settings.js';

const globalPath = path.join(process.cwd(), 'one.scss');

const storage = new StorageService();
const importGraph = new ImportGraphService(storage);

storage.set(URI.file(globalPath).toString(), {
	document: globalPath,
	filepath: globalPath,
	variables: [
		{ name: '$one', value: '1', offset: 0, position: undefined },
		{ name: '$two', value: null, offset: 0, position: undefined },
		{ name: '$hex', value: '#fff', offset: 0, position: undefined },
		{ name: '$rgb', value: 'rgb(0,0,0)', offset: 0, position: undefined },
		{ name: '$word', value: 'red', offset: 0, position: undefined }
	],
	mixins: [
		{ name: 'test', parameters: [], offset: 0, position: undefined }
	],
	functions: [
		{ name: 'make', parameters: [], offset: 0, position: undefined }
	],
	imports: [],
	uses: [
		{ namespace: 'one', wildcard: false, resolvedPath: globalPath, targetRaw: 'one' }
	],
	forwards: [],
	customProperties: [
		{ name: '--primary', value: '#cec111', offset: 0, position: { line: 0, character: 0 }, isRootScope: true }
	]
});

/**
 * Every fixture line gets `@import "one.scss";` prepended so `one.scss`'s
 * symbols are actually in scope, per the import-graph-scoped resolution
 * model — matches how a real component `.scss` file would need to `@import`/
 * `@use` a shared file before its symbols are suggested.
 */
function getCompletionList(lines: string[], options?: Partial<ISettings>): Promise<CompletionList | null> {
	const text = ['@import "one.scss";', ...lines].join('\n');

	const settings = helpers.makeSettings(options);
	const document = helpers.makeDocument(text.replace('|', ''));
	const offset = text.indexOf('|');

	return doCompletion(document, offset, settings, storage, importGraph);
}

describe('Providers/Completion - Basic', () => {
	let statStub: sinon.SinonStub;

	beforeEach(() => {
		statStub = sinon.stub(fs, 'stat').yields(null, new Stats());
	});

	afterEach(() => {
		statStub.restore();
	});

	it('Variables', async () => {
		const actual = await getCompletionList(['$|']);

		assert.strictEqual(actual?.items.length, 5);
	});

	it('Mixins', async () => {
		const actual = await getCompletionList(['@include |']);

		assert.strictEqual(actual?.items.length, 1);
	});

	it('does not suggest variables from a file that is not imported/used', async () => {
		const document = helpers.makeDocument('$|');
		const settings = helpers.makeSettings();
		const offset = 1;

		const actual = await doCompletion(document, offset, settings, storage, importGraph);

		assert.strictEqual(actual?.items.length, 0);
	});

	it('shows the source file as the completion detail (no more "(implicitly)" label)', async () => {
		const actual = await getCompletionList(['$|']);

		assert.strictEqual(actual?.items[0]?.detail, 'one.scss');
	});
});

describe('Providers/Completion - Context', () => {
	let statStub: sinon.SinonStub;

	beforeEach(() => {
		statStub = sinon.stub(fs, 'stat').yields(null, new Stats());
	});

	afterEach(() => {
		statStub.restore();
	});

	it('Empty property value', async () => {
		const actual = await getCompletionList(['.a { content: | }']);

		assert.strictEqual(actual?.items.length, 5);
	});

	it('Non-empty property value without suggestions', async () => {
		const actual = await getCompletionList(['.a { background: url(../images/one|.png); }']);

		assert.strictEqual(actual?.items.length, 0);
	});

	it('Non-empty property value with Variables', async () => {
		const actual = await getCompletionList(['.a { background: url(../images/#{$one|}/one.png); }']);

		assert.strictEqual(actual?.items.length, 5);
	});

	it('Discard suggestions inside quotes', async () => {
		const actual = await getCompletionList([
			'.a {',
			'    background: url("../images/#{$one}/$one|.png");',
			'}'
		]);

		assert.strictEqual(actual?.items.length, 0);
	});

	it('Custom value for `suggestFunctionsInStringContextAfterSymbols` option', async () => {
		const actual = await getCompletionList(['.a { background: url(../images/m|'], {
			suggestFunctionsInStringContextAfterSymbols: '/'
		});

		assert.strictEqual(actual?.items.length, 1);
	});

	it('Discard suggestions inside single-line comments', async () => {
		const actual = await getCompletionList(['// $|']);

		assert.strictEqual(actual?.items.length, 0);
	});

	it('Discard suggestions inside block comments', async () => {
		const actual = await getCompletionList(['/* $| */']);

		assert.strictEqual(actual?.items.length, 0);
	});

	it('Identify color variables', async () => {
		const actual = await getCompletionList(['$|']);

		assert.strictEqual(actual?.items[0]?.kind, CompletionItemKind.Variable);
		assert.strictEqual(actual?.items[1]?.kind, CompletionItemKind.Variable);
		assert.strictEqual(actual?.items[2]?.kind, CompletionItemKind.Color);
		assert.strictEqual(actual?.items[3]?.kind, CompletionItemKind.Color);
		assert.strictEqual(actual?.items[4]?.kind, CompletionItemKind.Color);
	});
});

describe('Providers/Completion - Namespaced (@use)', () => {
	let statStub: sinon.SinonStub;

	beforeEach(() => {
		statStub = sinon.stub(fs, 'stat').yields(null, new Stats());
	});

	afterEach(() => {
		statStub.restore();
	});

	it('suggests members through a namespace, resolved via the @use edge (not by bare name)', async () => {
		const text = ['@use "one" as one;', '.a { content: one.$|; }'].join('\n');
		const document = helpers.makeDocument(text.replace('|', ''));
		const settings = helpers.makeSettings();
		const offset = text.indexOf('|');

		const actual = await doCompletion(document, offset, settings, storage, importGraph);

		assert.strictEqual(actual?.items.length, 5);
		assert.ok(actual?.items.every(item => item.label.startsWith('$')));
	});
});

describe('Providers/Completion - Custom properties (var(--x))', () => {
	let statStub: sinon.SinonStub;

	beforeEach(() => {
		statStub = sinon.stub(fs, 'stat').yields(null, new Stats());
	});

	afterEach(() => {
		statStub.restore();
	});

	it('suggests custom properties inside var(...), unscoped by import graph', async () => {
		// No @import/@use of one.scss here — custom properties are global by
		// design (default `scss.customProperties.scope` is "workspace").
		const text = '.a { color: var(--pri|';
		const document = helpers.makeDocument(text.replace('|', ''));
		const settings = helpers.makeSettings();
		const offset = text.indexOf('|');

		const actual = await doCompletion(document, offset, settings, storage, importGraph);

		assert.strictEqual(actual?.items.length, 1);
		assert.strictEqual(actual?.items[0]?.label, '--primary');
	});
});

describe('Providers/Completion - Sorting', () => {
	let statStub: sinon.SinonStub;

	beforeEach(() => {
		statStub = sinon.stub(fs, 'stat').yields(null, new Stats());
	});

	afterEach(() => {
		statStub.restore();
	});

	it('ranks a project variable above a node_modules-sourced one, even when the label would otherwise sort it later', async () => {
		const localStorage = new StorageService();
		const localImportGraph = new ImportGraphService(localStorage);

		const localPath = path.join(process.cwd(), 'local.scss');
		const vendorPath = path.join(process.cwd(), 'node_modules', 'lib', '_vars.scss');

		const emptySymbols = { mixins: [], functions: [], imports: [], uses: [], forwards: [], customProperties: [] };

		localStorage.set(URI.file(localPath).toString(), {
			document: localPath,
			filepath: localPath,
			variables: [{ name: '$zzz-local', value: '1', offset: 0, position: undefined }],
			...emptySymbols
		});
		localStorage.set(URI.file(vendorPath).toString(), {
			document: vendorPath,
			filepath: vendorPath,
			variables: [{ name: '$aaa-vendor', value: '1', offset: 0, position: undefined }],
			...emptySymbols
		});

		const text = [
			'@import "local.scss";',
			'@import "node_modules/lib/_vars.scss";',
			'$|'
		].join('\n');
		const document = helpers.makeDocument(text.replace('|', ''));
		const settings = helpers.makeSettings();
		const offset = text.indexOf('|');

		const actual = await doCompletion(document, offset, settings, localStorage, localImportGraph);

		const local = actual?.items.find(item => item.label === '$zzz-local');
		const vendor = actual?.items.find(item => item.label === '$aaa-vendor');

		assert.ok(local?.sortText, 'expected the local variable to have a sortText');
		assert.ok(vendor?.sortText, 'expected the vendor variable to have a sortText');
		assert.ok(
			(local?.sortText as string) < (vendor?.sortText as string),
			`expected local sortText "${local?.sortText}" to sort before vendor sortText "${vendor?.sortText}"`
		);
	});
});
