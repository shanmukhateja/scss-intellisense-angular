'use strict';

import * as assert from 'assert';
import fs from 'fs';

import * as sinon from 'sinon';
import { Stats } from '@nodelib/fs.macchiato';

import { parseDocument } from '../../services/parser.js';
import * as helpers from '../helpers.js';

describe('Utils/ScssModules', () => {
	let statStub: sinon.SinonStub;

	beforeEach(() => {
		statStub = sinon.stub(fs, 'stat').yields(null, new Stats());
	});

	afterEach(() => {
		statStub.restore();
	});

	describe('@use', () => {
		it('uses the explicit `as` namespace', async () => {
			const document = helpers.makeDocument(['@use "variables" as vars;']);
			const { symbols } = await parseDocument(document, null);

			assert.strictEqual(symbols.uses.length, 1);
			assert.strictEqual(symbols.uses[0]?.namespace, 'vars');
			assert.strictEqual(symbols.uses[0]?.wildcard, false);
			assert.strictEqual(symbols.uses[0]?.targetRaw, 'variables');
			assert.ok(symbols.uses[0]?.resolvedPath?.endsWith('variables.scss') || symbols.uses[0]?.resolvedPath?.endsWith('variables'));
		});

		it('infers the default namespace from the path when there is no `as` clause', async () => {
			const document = helpers.makeDocument(['@use "styles/variables";']);
			const { symbols } = await parseDocument(document, null);

			assert.strictEqual(symbols.uses[0]?.namespace, 'variables');
			assert.strictEqual(symbols.uses[0]?.wildcard, false);
		});

		it('strips the partial underscore and extension when inferring the default namespace', async () => {
			const document = helpers.makeDocument(['@use "styles/_variables.scss";']);
			const { symbols } = await parseDocument(document, null);

			assert.strictEqual(symbols.uses[0]?.namespace, 'variables');
		});

		it('detects `as *` as a wildcard use with no namespace lookup required', async () => {
			const document = helpers.makeDocument(['@use "variables" as *;']);
			const { symbols } = await parseDocument(document, null);

			assert.strictEqual(symbols.uses[0]?.wildcard, true);
		});
	});

	describe('@forward', () => {
		it('has no prefix/show/hide by default', async () => {
			const document = helpers.makeDocument(['@forward "buttons";']);
			const { symbols } = await parseDocument(document, null);

			assert.strictEqual(symbols.forwards.length, 1);
			assert.strictEqual(symbols.forwards[0]?.prefix, null);
			assert.strictEqual(symbols.forwards[0]?.show, null);
			assert.strictEqual(symbols.forwards[0]?.hide, null);
			assert.strictEqual(symbols.forwards[0]?.targetRaw, 'buttons');
		});

		it('captures the `as <prefix>-*` prefix', async () => {
			const document = helpers.makeDocument(['@forward "buttons" as btn-*;']);
			const { symbols } = await parseDocument(document, null);

			assert.strictEqual(symbols.forwards[0]?.prefix, 'btn');
		});

		it('captures a `show` member list', async () => {
			const document = helpers.makeDocument(['@forward "buttons" show $primary, button-mixin;']);
			const { symbols } = await parseDocument(document, null);

			assert.deepStrictEqual(symbols.forwards[0]?.show, ['$primary', 'button-mixin']);
			assert.strictEqual(symbols.forwards[0]?.hide, null);
		});

		it('captures a `hide` member list', async () => {
			const document = helpers.makeDocument(['@forward "buttons" hide $internal;']);
			const { symbols } = await parseDocument(document, null);

			assert.strictEqual(symbols.forwards[0]?.show, null);
			assert.deepStrictEqual(symbols.forwards[0]?.hide, ['$internal']);
		});
	});
});
