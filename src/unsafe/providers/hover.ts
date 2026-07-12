'use strict';

import { Hover, MarkupContent, MarkupKind } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import { NodeType } from '../types/nodes.js';
import type { IDocumentSymbols, IVariable, IMixin, IFunction, ISymbols } from '../types/symbols.js';
import type StorageService from '../services/storage.js';
import type ImportGraphService from '../services/importGraph.js';
import type { ISettings } from '../types/settings.js';

import { parseDocument } from '../services/parser.js';
import { getDocumentPath } from '../utils/document.js';
import { getLimitedString } from '../utils/string.js';
import { detectModuleAccess, resolveNamespacedSymbol } from '../utils/scssModules.js';
import { detectCustomPropertyAccess, getCustomPropertyCandidates, resolveCustomProperty } from '../utils/customProperties.js';

type BareIdentifier = { type: keyof ISymbols; name: string };

function formatVariableMarkupContent(symbol: IVariable, fsPath: string): MarkupContent {
	const value = getLimitedString(symbol.value || '');
	const suffix = fsPath !== 'current' ? `\n@import "${fsPath}"` : '';

	return {
		kind: MarkupKind.Markdown,
		value: [
			'```scss',
			`${symbol.name}: ${value};${suffix}`,
			'```'
		].join('\n')
	};
}

function formatMixinMarkupContent(symbol: IMixin, fsPath: string): MarkupContent {
	const args = symbol.parameters.map(item => `${item.name}: ${item.value}`).join(', ');
	const suffix = fsPath !== 'current' ? `\n@import "${fsPath}"` : '';

	return {
		kind: MarkupKind.Markdown,
		value: [
			'```scss',
			`@mixin ${symbol.name}(${args}) {…}${suffix}`,
			'```'
		].join('\n')
	};
}

function formatFunctionMarkupContent(symbol: IFunction, fsPath: string): MarkupContent {
	const args = symbol.parameters.map(item => `${item.name}: ${item.value}`).join(', ');
	const suffix = fsPath !== 'current' ? `\n@import "${fsPath}"` : '';

	return {
		kind: MarkupKind.Markdown,
		value: [
			'```scss',
			`@function ${symbol.name}(${args}) {…}${suffix}`,
			'```'
		].join('\n')
	};
}

function formatCustomPropertyMarkupContent(name: string, value: string | null, fsPath: string): MarkupContent {
	const suffix = fsPath !== 'current' ? `\n@import "${fsPath}"` : '';

	return {
		kind: MarkupKind.Markdown,
		value: [
			'```scss',
			`${name}: ${getLimitedString(value || '')};${suffix}`,
			'```'
		].join('\n')
	};
}

interface IBareSymbol {
	document?: string;
	path: string;
	info: IVariable | IMixin | IFunction;
}

/**
 * Returns the first bare-name match across `symbolList` — a scoped list
 * (the entry document's own `getReachableDocuments()` result), not the whole
 * workspace, so "first match" is now a meaningful, mostly-unambiguous choice
 * rather than an arbitrary one.
 */
function getBareSymbol(symbolList: IDocumentSymbols[], identifier: BareIdentifier, currentPath: string): IBareSymbol | null {
	for (const symbols of symbolList) {
		if (identifier.type === 'imports') {
			continue;
		}

		const symbolsByType = symbols[identifier.type];
		const fsPath = getDocumentPath(currentPath, symbols.filepath || symbols.document);

		const match = symbolsByType.find(item => item && item.name === identifier.name);
		if (match !== undefined) {
			return { document: symbols.document, path: fsPath, info: match };
		}
	}

	return null;
}

export async function doHover(
	document: TextDocument,
	offset: number,
	storage: StorageService,
	importGraph: ImportGraphService,
	settings: ISettings
): Promise<Hover | null> {
	const documentPath = URI.parse(document.uri).fsPath;

	const resource = await parseDocument(document, offset);
	const hoverNode = resource.node;
	if (!hoverNode || !hoverNode.type) {
		return null;
	}

	storage.set(document.uri, resource.symbols);

	// Namespaced access (`ns.$x`, `ns.fn()`, `@include ns.mixin()`).
	const moduleAccess = detectModuleAccess(hoverNode);
	if (moduleAccess !== null) {
		const resolved = resolveNamespacedSymbol(importGraph, documentPath, moduleAccess.namespace, moduleAccess.memberName, moduleAccess.memberType);
		if (resolved === null) {
			return null;
		}

		const fsPath = getDocumentPath(documentPath, resolved.documentPath);
		let contents: MarkupContent;
		if (moduleAccess.memberType === 'variables') {
			contents = formatVariableMarkupContent(resolved.symbol as IVariable, fsPath);
		} else if (moduleAccess.memberType === 'mixins') {
			contents = formatMixinMarkupContent(resolved.symbol as IMixin, fsPath);
		} else {
			contents = formatFunctionMarkupContent(resolved.symbol as IFunction, fsPath);
		}

		return { contents };
	}

	// CSS custom property (`var(--x)`).
	const customPropertyName = detectCustomPropertyAccess(hoverNode);
	if (customPropertyName !== null) {
		const candidates = getCustomPropertyCandidates(storage, settings);
		const match = resolveCustomProperty(candidates, customPropertyName);
		if (match === undefined) {
			return null;
		}

		const fsPath = getDocumentPath(documentPath, match.fsPath);

		return { contents: formatCustomPropertyMarkupContent(match.property.name, match.property.value, fsPath) };
	}

	// Bare-name access ($x, mixin-name(...), function-name(...)).
	let identifier: BareIdentifier | null = null;
	if (hoverNode.type === NodeType.VariableName) {
		const parent = hoverNode.getParent();

		if (parent.type !== NodeType.VariableDeclaration && parent.type !== NodeType.FunctionParameter) {
			identifier = {
				name: hoverNode.getName(),
				type: 'variables'
			};
		}
	} else if (hoverNode.type === NodeType.Identifier) {
		let node;
		let type: keyof ISymbols | null = null;

		const parent = hoverNode.getParent();
		if (parent.type === NodeType.Function) {
			node = parent;
			type = 'functions';
		} else if (parent.type === NodeType.MixinReference) {
			node = parent;
			type = 'mixins';
		}

		if (type === null) {
			return null;
		}

		if (node) {
			identifier = {
				name: node.getName(),
				type
			};
		}
	} else if (hoverNode.type === NodeType.MixinReference) {
		identifier = {
			name: hoverNode.getName(),
			type: 'mixins'
		};
	}

	if (!identifier) {
		return null;
	}

	const symbolsList = importGraph.getReachableDocuments(documentPath);
	const symbol = getBareSymbol(symbolsList, identifier, documentPath);

	let contents: MarkupContent | undefined;
	if (symbol && symbol.document !== undefined) {
		if (identifier.type === 'variables') {
			contents = formatVariableMarkupContent(symbol.info as IVariable, symbol.path);
		} else if (identifier.type === 'mixins') {
			contents = formatMixinMarkupContent(symbol.info as IMixin, symbol.path);
		} else if (identifier.type === 'functions') {
			contents = formatFunctionMarkupContent(symbol.info as IFunction, symbol.path);
		}
	}

	if (contents === undefined) {
		return null;
	}

	return {
		contents
	};
}
