import * as path from 'path';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { MarkupKind, Position, Range } from 'vscode-languageserver-types';
import type { MarkupContent } from 'vscode-css-languageservice';
import cssLanguageService from 'vscode-css-languageservice';
import { URI } from 'vscode-uri';

import type { INode } from '../types/nodes.js';
import type { ISettings } from '../types/settings.js';

const { getSCSSLanguageService } = cssLanguageService;

const ls = getSCSSLanguageService();

ls.configure({
	validate: false
});

export type MakeDocumentOptions = {
	uri?: string;
	languageId?: string;
	version?: number;
};

export function makeDocument(lines: string | string[], options: MakeDocumentOptions = {}): TextDocument {
	return TextDocument.create(
		options.uri || URI.file(path.join(process.cwd(), 'index.scss')).toString(),
		options.languageId || 'scss',
		options.version || 1,
		Array.isArray(lines) ? lines.join('\n') : lines
	);
}

export function makeAst(lines: string[]): INode {
	const document = makeDocument(lines);

	return ls.parseStylesheet(document) as INode;
}

export function makeSameLineRange(line: number = 1, start: number = 1, end: number = 1): Range {
	return Range.create(Position.create(line, start), Position.create(line, end));
}

export function makeSettings(options?: Partial<ISettings>): ISettings {
	return {
		scannerDepth: 30,
		scannerExclude: ['**/.git', '**/node_modules', '**/bower_components'],
		scanImportedFiles: true,
		showErrors: false,
		suggestVariables: true,
		suggestMixins: true,
		suggestFunctions: true,
		suggestFunctionsInStringContextAfterSymbols: ' (+-*%',
		angular: {
			includePaths: []
		},
		customProperties: {
			scope: 'workspace'
		},
		...options
	};
}

export function makeMarkupContentForScssLanguage(content: string): MarkupContent {
	return {
		kind: MarkupKind.Markdown,
		value: ['```scss', content, '```'].join('\n')
	}
}
