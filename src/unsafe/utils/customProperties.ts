'use strict';

import type { TextDocument } from 'vscode-languageserver-textdocument';

import { INode, NodeType } from '../types/nodes.js';
import type { ICustomProperty } from '../types/symbols.js';
import type { ISettings } from '../types/settings.js';
import type StorageService from '../services/storage.js';
import { getParentNodeByType } from './ast.js';
import { getSymbolsCollection } from './symbols.js';

const reRootSelector = /^(:root|html|body)$/i;

/**
 * True if `node` (a `CustomPropertyDeclaration`) sits directly inside a
 * `:root`/`html`/`body` selector — the conventional place for global design
 * tokens, as opposed to a component-private custom property scoped to its
 * own selector (e.g. `.btn { --local: 2px }`).
 */
function isRootScopeDeclaration(node: INode): boolean {
	const ruleset = getParentNodeByType(node, NodeType.Ruleset);
	if (ruleset === null) {
		return false;
	}

	const selectors = ruleset.getSelectors().getChildren();

	return selectors.some(selector => reRootSelector.test(selector.getText().trim()));
}

/**
 * Custom properties are plain CSS `Declaration`s, not Sass "symbols" — the
 * language service parses them as their own dedicated `CustomPropertyDeclaration`
 * node (confirmed in source: `cssNodes.js`'s `CustomPropertyDeclaration extends
 * Declaration`), so this is a normal AST walk, not a text/regex scan.
 */
export function collectCustomProperties(document: TextDocument, ast: INode): ICustomProperty[] {
	const result: ICustomProperty[] = [];

	ast.accept(node => {
		if (node.type === NodeType.CustomPropertyDeclaration) {
			const property = node.getProperty();
			const value = node.getValue();

			if (property !== undefined && property !== null) {
				result.push({
					name: property.getName(),
					value: value ? value.getText() : null,
					offset: property.offset,
					position: document.positionAt(property.offset),
					isRootScope: isRootScopeDeclaration(node)
				});
			}
		}

		return true;
	});

	return result;
}

/**
 * True if `node` is a `var(--x)` usage's `--x` argument. CSS custom-property
 * identifiers are unambiguous by the `--` prefix alone — they don't appear in
 * any other expression-level position — so a plain text check is enough
 * (confirmed empirically: `var(--primary)`'s argument parses as a plain
 * `Identifier` node, not wrapped in anything `var`-specific).
 */
export function detectCustomPropertyAccess(node: INode): string | null {
	if (node.type === NodeType.Identifier && node.getText().startsWith('--')) {
		return node.getText();
	}

	return null;
}

export interface IVarFallbackContext {
	propertyName: string;
	callNode: INode;
	fallbackNode: INode;
}

/**
 * Detects `var(--property-name, <fallback>)` with the cursor on the
 * property-name argument, and returns the whole call node (for a
 * whole-expression replace range) plus the fallback argument. `var()`'s two
 * arguments are `FunctionArgument` children of the `Function` node's
 * `Nodelist` (confirmed empirically — `getArguments().getChildren()` gives
 * `[FunctionArgument(name), FunctionArgument(fallback)?]`, mirroring how
 * `scssModules.ts` documents similar `vscode-css-languageservice` node-shape
 * quirks rather than assuming them from the type declarations alone).
 */
export function detectVarFallbackContext(node: INode): IVarFallbackContext | null {
	const propertyName = detectCustomPropertyAccess(node);
	if (propertyName === null) {
		return null;
	}

	const callNode = getParentNodeByType(node, NodeType.Function);
	if (callNode === null || callNode.getName() !== 'var') {
		return null;
	}

	const args = callNode.getArguments().getChildren();
	const fallbackNode = args[1];
	if (fallbackNode === undefined) {
		return null;
	}

	return { propertyName, callNode, fallbackNode };
}

export interface ICustomPropertyCandidate {
	fsPath: string;
	property: ICustomProperty;
}

/**
 * The set of custom properties visible for `var(...)` completion/hover/
 * goto-def, per `scss.customProperties.scope`:
 * - `workspace` (default): every declared custom property, anywhere — matches
 *   real CSS cascade behavior (an unresolved `var()` doesn't error, unlike an
 *   out-of-scope Sass `$variable`, so there's no correctness downside to
 *   being permissive here).
 * - `root-selectors`: only ones declared inside `:root`/`html`/`body`.
 */
export function getCustomPropertyCandidates(storage: StorageService, settings: ISettings): ICustomPropertyCandidate[] {
	const result: ICustomPropertyCandidate[] = [];

	for (const doc of getSymbolsCollection(storage)) {
		if (doc.filepath === undefined) {
			continue;
		}

		for (const property of doc.customProperties) {
			if (settings.customProperties.scope === 'root-selectors' && !property.isRootScope) {
				continue;
			}

			result.push({ fsPath: doc.filepath, property });
		}
	}

	return result;
}

export function resolveCustomProperty(candidates: ICustomPropertyCandidate[], name: string): ICustomPropertyCandidate | undefined {
	return candidates.find(candidate => candidate.property.name === name);
}
