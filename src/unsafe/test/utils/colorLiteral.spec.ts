'use strict';

import * as assert from 'assert';

import { findColorLiteralAt, normalizeColor } from '../../utils/colorLiteral.js';

describe('Utils/ColorLiteral', () => {
	describe('findColorLiteralAt', () => {
		it('finds a hex literal overlapping the cursor', () => {
			const line = '.a { color: #fff; }';
			const cursor = line.indexOf('#fff') + 2;

			const match = findColorLiteralAt(line, cursor);

			assert.deepStrictEqual(match, { text: '#fff', start: 12, end: 16 });
		});

		it('finds an rgb() literal overlapping the cursor', () => {
			const line = '.a { color: rgb(0,0,0); }';
			const cursor = line.indexOf('rgb(0,0,0)') + 1;

			const match = findColorLiteralAt(line, cursor);

			assert.strictEqual(match?.text, 'rgb(0,0,0)');
		});

		it('finds a named color word overlapping the cursor', () => {
			const line = '.a { color: red; }';
			const cursor = line.indexOf('red') + 1;

			const match = findColorLiteralAt(line, cursor);

			assert.deepStrictEqual(match, { text: 'red', start: 12, end: 15 });
		});

		it('does not treat a variable name ($red) as a color word', () => {
			const line = '.a { color: $red; }';
			const cursor = line.indexOf('$red') + 2;

			assert.strictEqual(findColorLiteralAt(line, cursor), null);
		});

		it('does not treat a hyphenated word (bg-red) as a color word', () => {
			const line = '.a { class: bg-red; }';
			const cursor = line.indexOf('bg-red') + 4;

			assert.strictEqual(findColorLiteralAt(line, cursor), null);
		});

		it('returns null when the cursor is not on a color literal', () => {
			const line = '.a { color: $primary; }';
			const cursor = line.indexOf('$primary') + 2;

			assert.strictEqual(findColorLiteralAt(line, cursor), null);
		});

		it('returns null on an empty line', () => {
			assert.strictEqual(findColorLiteralAt('', 0), null);
		});
	});

	describe('normalizeColor', () => {
		it('normalizes hex regardless of case', () => {
			assert.strictEqual(normalizeColor('#FFF'), normalizeColor('#fff'));
			assert.strictEqual(normalizeColor('#FFFFFF'), normalizeColor('#fff'));
		});

		it('normalizes rgb() and hex to the same key for the same color', () => {
			assert.strictEqual(normalizeColor('rgb(255,255,255)'), normalizeColor('#fff'));
		});

		it('normalizes a named color to the same key as its hex equivalent', () => {
			assert.strictEqual(normalizeColor('red'), normalizeColor('#ff0000'));
		});

		it('returns null for an unparseable value', () => {
			assert.strictEqual(normalizeColor('not-a-color'), null);
			assert.strictEqual(normalizeColor(''), null);
		});
	});
});
