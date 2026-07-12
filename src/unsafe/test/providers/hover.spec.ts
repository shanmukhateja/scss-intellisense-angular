'use strict';

import * as assert from 'assert';
import * as path from 'path';
import fs from 'fs';

import * as sinon from 'sinon';
import { Stats } from '@nodelib/fs.macchiato';
import type { Hover } from 'vscode-languageserver';
import { URI } from 'vscode-uri';

import StorageService from '../../services/storage.js';
import ImportGraphService from '../../services/importGraph.js';
import { doHover } from '../../providers/hover.js';
import * as helpers from '../helpers.js';

const globalPath = path.join(process.cwd(), 'file.scss');

const storage = new StorageService();
const importGraph = new ImportGraphService(storage);

storage.set(URI.file(globalPath).toString(), {
	document: globalPath,
	filepath: globalPath,
	variables: [
		{ name: '$variable', value: null, offset: 0, position: { line: 1, character: 1 } }
	],
	mixins: [
		{ name: 'mixin', parameters: [], offset: 0, position: { line: 1, character: 1 } }
	],
	functions: [
		{ name: 'make', parameters: [], offset: 0, position: { line: 1, character: 1 } }
	],
	imports: [],
	uses: [],
	forwards: [],
	customProperties: []
});

function getHover(lines: string[]): Promise<Hover | null> {
	const text = lines.join('\n');

	const document = helpers.makeDocument(text.replace('|', ''));
	const offset = text.indexOf('|');

	return doHover(document, offset, storage, importGraph, helpers.makeSettings());
}

describe('Providers/Hover', () => {
	let statStub: sinon.SinonStub;

	beforeEach(() => {
		statStub = sinon.stub(fs, 'stat').yields(null, new Stats());
	});

	afterEach(() => {
		statStub.restore();
	});

	it('should suggest local symbols', async () => {
		const actual = await getHover([
			'$one: 1;',
			'.a { content: $one|; }'
		]);

		assert.deepStrictEqual(actual?.contents, helpers.makeMarkupContentForScssLanguage('$one: 1;'));
	});

	it('should suggest variables from an imported file', async () => {
		const actual = await getHover([
			'@import "file.scss";',
			'.a { content: $variable|; }'
		]);

		assert.deepStrictEqual(actual?.contents, helpers.makeMarkupContentForScssLanguage('$variable: null;\n@import "file.scss"'));
	});

	it('should suggest mixins from an imported file', async () => {
		const actual = await getHover([
			'@import "file.scss";',
			'@include mixin|'
		]);

		assert.deepStrictEqual(actual?.contents, helpers.makeMarkupContentForScssLanguage('@mixin mixin() {…}\n@import "file.scss"'));
	});

	it('does not suggest a variable from a file that is not imported/used', async () => {
		const actual = await getHover([
			'.a { content: $variable|; }'
		]);

		assert.strictEqual(actual, null);
	});

	// Does not work right now
	it.skip('should suggest global functions', async () => {
		const actual = await getHover([
			'@import "file.scss";',
			'.a { content: make|(); }'
		]);

		assert.deepStrictEqual(actual?.contents, helpers.makeMarkupContentForScssLanguage('@function make($a: null) {…}\n@import "file.scss"'));
	});
});
