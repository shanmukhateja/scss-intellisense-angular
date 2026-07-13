'use strict';

import * as assert from 'assert';
import * as path from 'path';
import fs from 'fs';

import * as sinon from 'sinon';
import { Stats } from '@nodelib/fs.macchiato';
import { URI } from 'vscode-uri';

import StorageService from '../../services/storage.js';
import ImportGraphService from '../../services/importGraph.js';
import { goDefinition } from '../../providers/goDefinition.js';
import * as helpers from '../helpers.js';

const globalPath = path.join(process.cwd(), 'one.scss');

const storage = new StorageService();
const importGraph = new ImportGraphService(storage);

storage.set(URI.file(globalPath).toString(), {
	document: globalPath,
	filepath: globalPath,
	variables: [
		{ name: '$a', value: '1', offset: 0, position: { line: 1, character: 1 } }
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

function goDefinitionAt(lines: string[]): ReturnType<typeof goDefinition> {
	const text = lines.join('\n');
	const offset = text.indexOf('|');
	const document = helpers.makeDocument(text.replace('|', ''));

	return goDefinition(document, offset, storage, importGraph, helpers.makeSettings());
}

describe('Providers/GoDefinition', () => {
	let statStub: sinon.SinonStub;

	beforeEach(() => {
		statStub = sinon.stub(fs, 'stat').yields(null, new Stats());
	});

	afterEach(() => {
		statStub.restore();
	});

	it('doGoDefinition - Variables', async () => {
		const actual = await goDefinitionAt([
			'@import "one.scss";',
			'.a { content: $a|; }'
		]);

		assert.ok(URI.parse(actual?.uri ?? ''), 'one.scss');
		assert.deepStrictEqual(actual?.range, {
			start: { line: 1, character: 1 },
			end: { line: 1, character: 3 }
		});
	});

	it('doGoDefinition - Variable definition', async () => {
		const actual = await goDefinitionAt(['$a|: 1;']);

		assert.strictEqual(actual, null);
	});

	it('doGoDefinition - does not find a variable from a file that is not imported/used', async () => {
		const actual = await goDefinitionAt(['.a { content: $a|; }']);

		assert.strictEqual(actual, null);
	});

	it('doGoDefinition - Mixins', async () => {
		const actual = await goDefinitionAt([
			'@import "one.scss";',
			'.a { @include mixin|(); }'
		]);

		assert.ok(URI.parse(actual?.uri ?? ''), 'one.scss');
		assert.deepStrictEqual(actual?.range, {
			start: { line: 1, character: 1 },
			end: { line: 1, character: 6 }
		});
	});

	it('doGoDefinition - Mixin definition', async () => {
		const actual = await goDefinitionAt(['@mixin mi|xin($a) {}']);

		assert.strictEqual(actual, null);
	});

	it('doGoDefinition - Mixin Arguments', async () => {
		const actual = await goDefinitionAt(['@mixin mixin($|a) {}']);

		assert.strictEqual(actual, null);
	});

	it('doGoDefinition - Functions', async () => {
		const actual = await goDefinitionAt([
			'@import "one.scss";',
			'.a { content: ma|ke(1); }'
		]);

		assert.ok(URI.parse(actual?.uri ?? ''), 'one.scss');
		assert.deepStrictEqual(actual?.range, {
			start: { line: 1, character: 1 },
			end: { line: 1, character: 5 }
		});
	});

	it('doGoDefinition - Function definition', async () => {
		const actual = await goDefinitionAt(['@function ma|ke($a) {}']);

		assert.strictEqual(actual, null);
	});

	it('doGoDefinition - Function Arguments', async () => {
		const actual = await goDefinitionAt(['@function make($|a) {}']);

		assert.strictEqual(actual, null);
	});
});
