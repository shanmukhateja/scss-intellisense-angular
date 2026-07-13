'use strict';

import { Location } from 'vscode-languageserver';
import type { TextDocument, Position } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import { NodeType } from '../types/nodes.js';
import type { IDocumentSymbols, ISymbols } from '../types/symbols.js';
import type StorageService from '../services/storage.js';
import type ImportGraphService from '../services/importGraph.js';
import type { ISettings } from '../types/settings.js';

import { parseDocument } from '../services/parser.js';
import { getDocumentPath } from '../utils/document.js';
import { detectModuleAccess, resolveNamespacedSymbol } from '../utils/scssModules.js';
import { detectCustomPropertyAccess, getCustomPropertyCandidates, resolveCustomProperty } from '../utils/customProperties.js';

interface ISymbol {
	document: string | undefined;
	path: string;
	info: { name: string; position?: Position };
}

interface IIdentifier {
	type: keyof ISymbols;
	position: Position;
	name: string;
}

function samePosition(a: Position | undefined, b: Position): boolean {
	if (a === undefined) {
		return false;
	}

	return a.line === b.line && a.character === b.character;
}

/**
 * Returns bare-name matches across `symbolList` — a scoped list (the entry
 * document's `getReachableDocuments()` result), not the whole workspace, so
 * `candidates[0]` below is now a meaningful choice rather than an arbitrary
 * first-in-map-order pick.
 */
function getSymbols(symbolList: IDocumentSymbols[], identifier: IIdentifier, currentPath: string): ISymbol[] {
	const list: ISymbol[] = [];

	for (const symbols of symbolList) {
		if (identifier.type === 'imports') {
			continue;
		}

		const fsPath = getDocumentPath(currentPath, symbols.document);

		for (const item of symbols[identifier.type]) {
			if (item && item.name === identifier.name && !samePosition(item.position, identifier.position)) {
				list.push({ document: symbols.filepath, path: fsPath, info: item });
			}
		}
	}

	return list;
}

function locationFromNamedPosition(documentPath: string, name: string, position: Position | undefined): Location | null {
	if (position === undefined) {
		return null;
	}

	return Location.create(URI.file(documentPath).toString(), {
		start: position,
		end: { line: position.line, character: position.character + name.length }
	});
}

export async function goDefinition(
	document: TextDocument,
	offset: number,
	storage: StorageService,
	importGraph: ImportGraphService,
	settings: ISettings
): Promise<Location | null> {
	const documentPath = URI.parse(document.uri).fsPath;

	const resource = await parseDocument(document, offset);
	const hoverNode = resource.node;
	if (!hoverNode || !hoverNode.type) {
		return null;
	}

	if (resource.symbols.document !== undefined) {
		storage.set(document.uri, resource.symbols);
	}

	// Namespaced access (`ns.$x`, `ns.fn()`, `@include ns.mixin()`).
	const moduleAccess = detectModuleAccess(hoverNode);
	if (moduleAccess !== null) {
		const resolved = resolveNamespacedSymbol(importGraph, documentPath, moduleAccess.namespace, moduleAccess.memberName, moduleAccess.memberType);
		if (resolved === null) {
			return null;
		}

		return locationFromNamedPosition(resolved.documentPath, resolved.symbol.name, resolved.symbol.position);
	}

	// CSS custom property (`var(--x)`).
	const customPropertyName = detectCustomPropertyAccess(hoverNode);
	if (customPropertyName !== null) {
		const candidates = getCustomPropertyCandidates(storage, settings);
		const match = resolveCustomProperty(candidates, customPropertyName);
		if (match === undefined) {
			return null;
		}

		return locationFromNamedPosition(match.fsPath, match.property.name, match.property.position);
	}

	// Bare-name access ($x, mixin-name(...), function-name(...)).
	let identifier: IIdentifier | null = null;
	if (hoverNode.type === NodeType.VariableName) {
		const parent = hoverNode.getParent();
		if (parent.type !== NodeType.FunctionParameter && parent.type !== NodeType.VariableDeclaration) {
			identifier = {
				name: hoverNode.getName(),
				position: document.positionAt(hoverNode.offset),
				type: 'variables'
			};
		}
	} else if (hoverNode.type === NodeType.Identifier) {
		let i = 0;
		let node = hoverNode;
		while (node.type !== NodeType.MixinReference && node.type !== NodeType.Function && i !== 2) {
			node = node.getParent();
			i++;
		}

		if (node && (node.type === NodeType.MixinReference || node.type === NodeType.Function)) {
			let type: keyof ISymbols = 'mixins';
			if (node.type === NodeType.Function) {
				type = 'functions';
			}

			identifier = {
				name: node.getName(),
				position: document.positionAt(node.offset),
				type
			};
		}
	}

	if (!identifier) {
		return null;
	}

	const symbolsList = importGraph.getReachableDocuments(documentPath);

	const candidates = getSymbols(symbolsList, identifier, documentPath);
	if (candidates.length === 0) {
		return null;
	}

	const definition = candidates[0];
	if (definition?.document === undefined) {
		return null;
	}

	return locationFromNamedPosition(definition.document, definition.info.name, definition.info.position);
}
