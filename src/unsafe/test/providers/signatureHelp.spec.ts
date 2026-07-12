'use strict';

import * as assert from 'assert';
import * as path from 'path';
import fs from 'fs';

import * as sinon from 'sinon';
import { Stats } from '@nodelib/fs.macchiato';
import type { SignatureHelp } from 'vscode-languageserver';
import { URI } from 'vscode-uri';

import StorageService from '../../services/storage.js';
import ImportGraphService from '../../services/importGraph.js';
import { doSignatureHelp } from '../../providers/signatureHelp.js';
import * as helpers from '../helpers.js';

const globalPath = path.join(process.cwd(), 'one.scss');

const storage = new StorageService();
const importGraph = new ImportGraphService(storage);

storage.set(URI.file(globalPath).toString(), {
	document: globalPath,
	filepath: globalPath,
	variables: [],
	mixins: [
		{ name: 'one', parameters: [], offset: 0, position: undefined },
		{ name: 'two', parameters: [], offset: 0, position: undefined },
		{
			name: 'two',
			parameters: [
				{ name: '$a', value: null, offset: 0 }
			],
			offset: 0,
			position: undefined
		},
		{
			name: 'two',
			parameters: [
				{ name: '$a', value: null, offset: 0 },
				{ name: '$b', value: null, offset: 0 }
			],
			offset: 0,
			position: undefined
		}
	],
	functions: [
		{ name: 'make', parameters: [], offset: 0, position: undefined },
		{
			name: 'one',
			parameters: [
				{ name: '$a', value: null, offset: 0 },
				{ name: '$b', value: null, offset: 0 },
				{ name: '$c', value: null, offset: 0 }
			],
			offset: 0,
			position: undefined
		},
		{
			name: 'two',
			parameters: [
				{ name: '$a', value: null, offset: 0 },
				{ name: '$b', value: null, offset: 0 }
			],
			offset: 0,
			position: undefined
		}
	],
	imports: [],
	uses: [],
	forwards: [],
	customProperties: []
});

function getSignatureHelp(lines: string[]): Promise<SignatureHelp> {
	const text = ['@import "one.scss";', ...lines].join('\n');

	const document = helpers.makeDocument(text.replace('|', ''));
	const offset = text.indexOf('|');

	return doSignatureHelp(document, offset, storage, importGraph);
}

describe('Providers/SignatureHelp', () => {
	let statStub: sinon.SinonStub;

	beforeEach(() => {
		statStub = sinon.stub(fs, 'stat').yields(null, new Stats());
	});

	afterEach(() => {
		statStub.restore();
	});

	describe('Empty', () => {
		it('Empty', async () => {
			const actual = await getSignatureHelp(['@include one(|']);

			assert.strictEqual(actual.signatures.length, 1);
		});
		it('Closed without parameters', async () => {
			const actual = await getSignatureHelp(['@include two(|)']);

			assert.strictEqual(actual.signatures.length, 3);
		});

		it('Closed with parameters', async () => {
			const actual = await getSignatureHelp(['@include two(1);']);

			assert.strictEqual(actual.signatures.length, 0);
		});
	});

	describe('Two parameters', () => {
		it('Passed one parameter of two', async () => {
			const actual = await getSignatureHelp(['@include two(1,|']);

			assert.strictEqual(actual.activeParameter, 1, 'activeParameter');
			assert.strictEqual(actual.signatures.length, 2, 'signatures.length');
		});

		it('Passed two parameter of two', async () => {
			const actual = await getSignatureHelp(['@include two(1, 2,|']);

			assert.strictEqual(actual.activeParameter, 2, 'activeParameter');
			assert.strictEqual(actual.signatures.length, 1, 'signatures.length');
		});

		it('Passed three parameters of two', async () => {
			const actual = await getSignatureHelp(['@include two(1, 2, 3,|']);

			assert.strictEqual(actual.signatures.length, 0);
		});

		it('Passed two parameter of two with parenthesis', async () => {
			const actual = await getSignatureHelp(['@include two(1, 2)|']);

			assert.strictEqual(actual.signatures.length, 0);
		});
	});

	describe('parseArgumentsAtLine for Mixins', () => {
		it('RGBA', async () => {
			const actual = await getSignatureHelp(['@include two(rgba(0,0,0,.0001),|']);

			assert.strictEqual(actual.activeParameter, 1, 'activeParameter');
			assert.strictEqual(actual.signatures.length, 2, 'signatures.length');
		});

		it('RGBA when typing', async () => {
			const actual = await getSignatureHelp(['@include two(rgba(0,0,0,|']);

			assert.strictEqual(actual.activeParameter, 0, 'activeParameter');
			assert.strictEqual(actual.signatures.length, 3, 'signatures.length');
		});

		it('Quotes', async () => {
			const actual = await getSignatureHelp(['@include two("\\",;",|']);

			assert.strictEqual(actual.activeParameter, 1, 'activeParameter');
			assert.strictEqual(actual.signatures.length, 2, 'signatures.length');
		});

		it('With overload', async () => {
			const actual = await getSignatureHelp(['@include two(|']);

			assert.strictEqual(actual.signatures.length, 3);
		});

		it('Single-line selector', async () => {
			const actual = await getSignatureHelp(['h1 { @include two(1,| }']);

			assert.strictEqual(actual.signatures.length, 2);
		});

		it('Single-line Mixin reference', async () => {
			const actual = await getSignatureHelp([
				'h1 {',
				'    @include two(1, 2);',
				'    @include two(1,|)',
				'}']);

			assert.strictEqual(actual.signatures.length, 2);
		});

		it('Mixin with named argument', async () => {
			const actual = await getSignatureHelp(['@include two($a: 1,|']);

			assert.strictEqual(actual.signatures.length, 2);
		});
	});

	describe('parseArgumentsAtLine for Functions', () => {
		it('Empty', async () => {
			const actual = await getSignatureHelp(['content: make(|']);

			assert.strictEqual(actual.signatures.length, 1, 'length');
			assert.ok(actual.signatures[0]?.label.startsWith('make'), 'name');
		});

		it('Single-line Function reference', async () => {
			const actual = await getSignatureHelp(['content: make()+make(|']);

			assert.strictEqual(actual.signatures.length, 1, 'length');
			assert.ok(actual.signatures[0]?.label.startsWith('make'), 'name');
		});

		it('Inside another uncompleted function', async () => {
			const actual = await getSignatureHelp(['content: attr(make(|']);

			assert.strictEqual(actual.signatures.length, 1, 'length');
			assert.ok(actual.signatures[0]?.label.startsWith('make'), 'name');
		});

		it('Inside another completed function', async () => {
			const actual = await getSignatureHelp(['content: attr(one(1, two(1, two(1, 2)),|']);

			assert.strictEqual(actual.signatures.length, 1, 'length');
			assert.ok(actual.signatures[0]?.label.startsWith('one'), 'name');
		});

		it('Inside several completed functions', async () => {
			const actual = await getSignatureHelp(['background: url(one(1, one(1, 2, two(1, 2)),|']);

			assert.strictEqual(actual.signatures.length, 1, 'length');
			assert.ok(actual.signatures[0]?.label.startsWith('one'), 'name');
		});

		it('Inside another function with CSS function', async () => {
			const actual = await getSignatureHelp(['background-color: make(rgba(|']);

			assert.strictEqual(actual.signatures.length, 1, 'length');
			assert.ok(actual.signatures[0]?.label.startsWith('make'), 'name');
		});

		it('Inside another function with uncompleted CSS function', async () => {
			const actual = await getSignatureHelp(['background-color: make(rgba(1, 1,2,|']);

			assert.strictEqual(actual.signatures.length, 1, 'length');
			assert.ok(actual.signatures[0]?.label.startsWith('make'), 'name');
		});

		it('Inside another function with completed CSS function', async () => {
			const actual = await getSignatureHelp(['background-color: make(rgba(1,2, 3,.5)|']);

			assert.strictEqual(actual.signatures.length, 1, 'length');
			assert.ok(actual.signatures[0]?.label.startsWith('make'), 'name');
		});

		it('Interpolation', async () => {
			const actual = await getSignatureHelp(['background-color: "#{make(|}"']);

			assert.strictEqual(actual.signatures.length, 1, 'length');
			assert.ok(actual.signatures[0]?.label.startsWith('make'), 'name');
		});
	});
});
