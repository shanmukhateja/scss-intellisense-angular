'use strict';

import Color from 'color';

import { colorHex, colorFunctions, colorWeb } from './color.js';

export interface IColorLiteralMatch {
	text: string;
	start: number;
	end: number;
}

type MatchWithIndices = RegExpMatchArray & { indices?: Array<[number, number] | undefined> };

function withIndices(re: RegExp): RegExp {
	const flags = re.flags.includes('d') ? re.flags : `${re.flags}d`;

	return new RegExp(re.source, flags);
}

/**
 * Boundary check mirrors `findWords` in `color.ts`: `colorWeb`'s leading
 * `.?` swallows the character right before the matched word (if any), so a
 * preceding `$`/`@`/`#`/`-` means this is part of an identifier (`$red`,
 * `@red`, `bg-red`) rather than a standalone color word.
 */
function isExcludedByBoundary(match: MatchWithIndices): boolean {
	const boundaryChar = match[0]?.[0];

	return boundaryChar !== undefined && boundaryChar.length > 0 && /[-\\$@#]/.test(boundaryChar);
}

function findGroupMatches(line: string, re: RegExp, checkBoundary: boolean): IColorLiteralMatch[] {
	const result: IColorLiteralMatch[] = [];

	for (const match of line.matchAll(withIndices(re)) as IterableIterator<MatchWithIndices>) {
		const group = match.indices?.[1];
		const text = match[1];

		if (group === undefined || text === undefined) {
			continue;
		}

		if (checkBoundary && isExcludedByBoundary(match)) {
			continue;
		}

		result.push({ text, start: group[0], end: group[1] });
	}

	return result;
}

/**
 * Locates the color literal (hex/`rgb()`/`hsl()`/named word) overlapping
 * `character` on a single line — reuses the same three patterns
 * `utils/color.ts` already uses for completion color swatches, but resolved
 * to the exact span of one match (needed for a precise replace `Range`)
 * rather than "does this whole string contain a color".
 */
export function findColorLiteralAt(lineText: string, character: number): IColorLiteralMatch | null {
	const candidates = [
		...findGroupMatches(lineText, colorHex, false),
		...findGroupMatches(lineText, colorFunctions, false),
		...findGroupMatches(lineText, colorWeb, true)
	];

	return candidates.find(candidate => character >= candidate.start && character <= candidate.end) ?? null;
}

/**
 * Canonical comparison key for a color literal, regardless of input format —
 * `#FFF`, `#ffffff`, `rgb(255, 255, 255)` and `white` all normalize to the
 * same key. Same approach `findWords` (`color.ts`) already uses for the word
 * case; also makes hex comparison case-insensitive for free.
 */
export function normalizeColor(text: string): string | null {
	try {
		return Color(text).rgb().string();
	} catch {
		return null;
	}
}
