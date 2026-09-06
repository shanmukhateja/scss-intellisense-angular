'use strict';

import type { ISpan } from './angularComponentStyles.js';

/**
 * Returns `text` with every character *outside* `keepSpans` — and every
 * character *inside* `blankSpans` — replaced by a space, leaving `\r`/`\n`
 * untouched so line/column positions are preserved 1:1.
 *
 * Feeding the result to a single-language parser yields an AST whose offsets and
 * positions already line up with the original mixed-language document, so no
 * separate position mapping is needed on the way back out.
 */
export function buildBlankedText(text: string, keepSpans: ISpan[], blankSpans: ISpan[] = []): string {
	const chars = text.split('');
	const kept = new Array<boolean>(chars.length).fill(false);

	const apply = (spans: ISpan[], value: boolean): void => {
		for (const span of spans) {
			const start = Math.max(0, span.start);
			const end = Math.min(chars.length, span.end);

			for (let index = start; index < end; index++) {
				kept[index] = value;
			}
		}
	};

	apply(keepSpans, true);
	apply(blankSpans, false);

	for (let index = 0; index < chars.length; index++) {
		const char = chars[index];

		if (!kept[index] && char !== '\n' && char !== '\r') {
			chars[index] = ' ';
		}
	}

	return chars.join('');
}
