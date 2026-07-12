'use strict';

import * as assert from 'assert';
import fs from 'fs';

import * as sinon from 'sinon';
import { Stats } from '@nodelib/fs.macchiato';

import { parseDocument } from '../../services/parser.js';
import { getCustomPropertyCandidates } from '../../utils/customProperties.js';
import StorageService from '../../services/storage.js';
import * as helpers from '../helpers.js';

describe('Utils/CustomProperties', () => {
	let statStub: sinon.SinonStub;

	beforeEach(() => {
		statStub = sinon.stub(fs, 'stat').yields(null, new Stats());
	});

	afterEach(() => {
		statStub.restore();
	});

	describe('collectCustomProperties (via parseDocument)', () => {
		it('collects a custom property declared at :root', async () => {
			const document = helpers.makeDocument([':root { --primary: #cec111; }']);
			const { symbols } = await parseDocument(document, null);

			assert.strictEqual(symbols.customProperties.length, 1);
			assert.strictEqual(symbols.customProperties[0]?.name, '--primary');
			assert.strictEqual(symbols.customProperties[0]?.value, '#cec111');
			assert.strictEqual(symbols.customProperties[0]?.isRootScope, true);
		});

		it('collects a custom property declared at html/body', async () => {
			const document = helpers.makeDocument(['html, body { --spacing: 8px; }']);
			const { symbols } = await parseDocument(document, null);

			assert.strictEqual(symbols.customProperties[0]?.isRootScope, true);
		});

		it('marks a custom property declared inside a normal selector as non-root-scope', async () => {
			const document = helpers.makeDocument(['.btn { --local: 2px; }']);
			const { symbols } = await parseDocument(document, null);

			assert.strictEqual(symbols.customProperties.length, 1);
			assert.strictEqual(symbols.customProperties[0]?.name, '--local');
			assert.strictEqual(symbols.customProperties[0]?.isRootScope, false);
		});

		it('does not collect regular Sass variables as custom properties', async () => {
			const document = helpers.makeDocument([':root { $sass-var: 1; --real: 2px; }']);
			const { symbols } = await parseDocument(document, null);

			assert.strictEqual(symbols.customProperties.length, 1);
			assert.strictEqual(symbols.customProperties[0]?.name, '--real');
		});
	});

	describe('getCustomPropertyCandidates', () => {
		function makeStorage(): StorageService {
			const storage = new StorageService();

			storage.set('root.scss', {
				document: 'root.scss',
				filepath: 'root.scss',
				variables: [],
				mixins: [],
				functions: [],
				imports: [],
				uses: [],
				forwards: [],
				customProperties: [
					{ name: '--primary', value: '#000', offset: 0, position: { line: 0, character: 0 }, isRootScope: true }
				]
			});

			storage.set('button.scss', {
				document: 'button.scss',
				filepath: 'button.scss',
				variables: [],
				mixins: [],
				functions: [],
				imports: [],
				uses: [],
				forwards: [],
				customProperties: [
					{ name: '--local', value: '2px', offset: 0, position: { line: 0, character: 0 }, isRootScope: false }
				]
			});

			return storage;
		}

		it('includes every custom property (root and non-root) with the default "workspace" scope', () => {
			const storage = makeStorage();
			const settings = helpers.makeSettings({ customProperties: { scope: 'workspace' } });

			const candidates = getCustomPropertyCandidates(storage, settings).map(c => c.property.name);

			assert.deepStrictEqual(candidates.sort(), ['--local', '--primary']);
		});

		it('excludes non-root-scope custom properties with "root-selectors" scope', () => {
			const storage = makeStorage();
			const settings = helpers.makeSettings({ customProperties: { scope: 'root-selectors' } });

			const candidates = getCustomPropertyCandidates(storage, settings).map(c => c.property.name);

			assert.deepStrictEqual(candidates, ['--primary']);
		});
	});
});
