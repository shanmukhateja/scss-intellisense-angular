'use strict';

import * as assert from 'assert';

import { buildBlankedText } from '../../utils/blankedDocument.js';

describe('Utils/BlankedDocument', () => {
	describe('buildBlankedText', () => {
		it('replaces everything outside keepSpans with spaces, preserving newlines', () => {
			const text = 'abc\ndef\nghi';

			assert.strictEqual(buildBlankedText(text, [{ start: 4, end: 7 }]), '   \ndef\n   ');
		});

		it('preserves total length and line count', () => {
			const text = 'line one\nline two\nline three';

			const out = buildBlankedText(text, [{ start: 9, end: 12 }]);

			assert.strictEqual(out.length, text.length);
			assert.strictEqual(out.split('\n').length, text.split('\n').length);
		});

		it('lets blankSpans override an overlapping keepSpan', () => {
			assert.strictEqual(
				buildBlankedText('keepXXkeep', [{ start: 0, end: 10 }], [{ start: 4, end: 6 }]),
				'keep  keep'
			);
		});

		it('clamps spans that fall outside the text', () => {
			assert.strictEqual(buildBlankedText('abc', [{ start: -5, end: 99 }]), 'abc');
		});

		it('blanks everything (still newline-preserving) when keepSpans is empty', () => {
			assert.strictEqual(buildBlankedText('ab\ncd', []), '  \n  ');
		});
	});
});
