'use strict';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { extractStyleRegions, type IStyleRegions } from '../utils/angularComponentStyles.js';
import { buildBlankedText } from '../utils/blankedDocument.js';
import { hasComponentStyles } from '../utils/componentStyleGuard.js';

export interface IResolvedStyleDocument {
	/**
	 * The document to hand to a provider: the original for a plain `.scss` file,
	 * or a blanked SCSS view of a `.ts` file's inline `styles` (same URI, same
	 * length, same line layout — positions map 1:1).
	 */
	document: TextDocument;
	/**
	 * True when `document` is a blanked view of embedded styles. Callers use it
	 * to suppress edits that cannot be applied to a `.ts` host file, e.g.
	 * inserting a new `@use` line.
	 */
	embedded: boolean;
}

interface ICacheEntry {
	version: number;
	regions: IStyleRegions;
}

const EMPTY: IStyleRegions = { styleSpans: [], interpolationSpans: [] };

const regionCache = new Map<string, ICacheEntry>();

function regionsFor(doc: TextDocument): IStyleRegions {
	const cached = regionCache.get(doc.uri);
	if (cached !== undefined && cached.version === doc.version) {
		return cached.regions;
	}

	const text = doc.getText();
	const regions = hasComponentStyles(text) ? extractStyleRegions(text) : EMPTY;
	regionCache.set(doc.uri, { version: doc.version, regions });

	return regions;
}

/**
 * Drops the cached inline-`styles` spans for a document — call on close.
 */
export function forgetStyleDocument(uri: string): void {
	regionCache.delete(uri);
}

/**
 * Resolves the document a provider should operate on for a request covering
 * `span`. A non-TypeScript document is a passthrough (`embedded: false`). A
 * `.ts` document yields a blanked SCSS view iff `span` sits inside an inline
 * `styles` string; otherwise `undefined`, meaning the caller should produce no
 * result.
 */
export function resolveStyleDocument(doc: TextDocument, span: { start: number; end?: number }): IResolvedStyleDocument | undefined {
	if (doc.languageId !== 'typescript') {
		return { document: doc, embedded: false };
	}

	const regions = regionsFor(doc);
	const end = span.end ?? span.start;
	const inStyles = regions.styleSpans.some(styleSpan => span.start >= styleSpan.start && end <= styleSpan.end);
	if (!inStyles) {
		return undefined;
	}

	const blanked = buildBlankedText(doc.getText(), regions.styleSpans, regions.interpolationSpans);

	return {
		document: TextDocument.create(doc.uri, 'scss', doc.version, blanked),
		embedded: true
	};
}
