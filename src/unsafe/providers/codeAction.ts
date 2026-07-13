'use strict';

import * as path from 'path';

import { CodeAction, CodeActionKind, TextEdit, Range, Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import { NodeType } from '../types/nodes.js';
import type { INode } from '../types/nodes.js';
import type { ISettings } from '../types/settings.js';
import type StorageService from '../services/storage.js';
import type ImportGraphService from '../services/importGraph.js';

import { parseDocument } from '../services/parser.js';
import { getParentNodeByType } from '../utils/ast.js';
import { getDocumentPath } from '../utils/document.js';
import { findColorLiteralAt, normalizeColor } from '../utils/colorLiteral.js';
import { iterateColorVariableCandidates, iterateColorCustomPropertyCandidates, takeCandidates } from '../utils/colorCandidates.js';
import { detectVarFallbackContext, getCustomPropertyCandidates } from '../utils/customProperties.js';
import { inferDefaultNamespace } from '../utils/scssModules.js';

// Sass requires `@use`/`@forward` to be a contiguous prefix of the file, so
// scanning down from the top for that prefix is a reliable insertion point
// without a second full AST parse.
const reUseOrForwardLine = /^\s*@(use|forward)\b.*;\s*$/;

function getLineText(document: TextDocument, line: number): string {
	const start = Position.create(line, 0);
	const end = line + 1 < document.lineCount ? Position.create(line + 1, 0) : document.positionAt(document.getText().length);

	return document.getText({ start, end }).replace(/\r?\n$/, '');
}

function findUseInsertionLine(document: TextDocument): number {
	let line = 0;

	while (line < document.lineCount && reUseOrForwardLine.test(getLineText(document, line))) {
		line++;
	}

	return line;
}

/**
 * Relative `@use` target path from `fromPath` to `toPath`, stripped of the
 * `.scss` extension and a leading partial `_` — the conventional Sass
 * load-path specifier form (`@use 'colors'`, not `@use './_colors.scss'`).
 */
function computeUseTargetRaw(fromPath: string, toPath: string): string {
	const rel = path.relative(path.dirname(fromPath), toPath).replace(/\\/g, '/');
	const dir = path.dirname(rel);
	const base = path.basename(rel).replace(/\.scss$/i, '').replace(/^_/, '');

	return dir === '.' ? base : `${dir}/${base}`;
}

function pickNamespace(base: string, existing: Set<string>): string {
	if (!existing.has(base)) {
		return base;
	}

	let suffix = 2;
	while (existing.has(`${base}-${suffix}`)) {
		suffix++;
	}

	return `${base}-${suffix}`;
}

interface IVariableAccessibility {
	replacement: string;
	insertUseEdit?: TextEdit;
}

/**
 * Resolves how `candidateFsPath`'s variable can be referenced from
 * `documentPath`, reusing the same import-graph services the rest of the
 * providers already rely on for scoping: same file / already-reachable →
 * bare name; already `@use`d under some namespace → that namespace; else a
 * brand new `@use` is needed.
 */
function resolveVariableAccessibility(
	document: TextDocument,
	documentPath: string,
	candidateFsPath: string,
	variableName: string,
	importGraph: ImportGraphService
): IVariableAccessibility {
	if (candidateFsPath === documentPath) {
		return { replacement: variableName };
	}

	const reachable = importGraph.getReachableDocuments(documentPath);
	if (reachable.some(doc => doc.filepath === candidateFsPath)) {
		return { replacement: variableName };
	}

	const entryDoc = importGraph.getDocument(documentPath);
	const existingUse = entryDoc?.uses.find(
		use => !use.wildcard && importGraph.resolveEdgeTarget(documentPath, use) === candidateFsPath
	);

	if (existingUse !== undefined) {
		return { replacement: `${existingUse.namespace}.${variableName}` };
	}

	const targetRaw = computeUseTargetRaw(documentPath, candidateFsPath);
	const existingNamespaces = new Set((entryDoc?.uses ?? []).map(use => use.namespace));
	const namespace = pickNamespace(inferDefaultNamespace(targetRaw), existingNamespaces);

	const insertUseEdit = TextEdit.insert(Position.create(findUseInsertionLine(document), 0), `@use '${targetRaw}' as ${namespace};\n`);

	return { replacement: `${namespace}.${variableName}`, insertUseEdit };
}

/**
 * Builds one `CodeAction` per candidate (custom property, then variable)
 * matching `colorKey`, all replacing `replaceRange`. Shared by both trigger
 * paths below — the plain literal path and the `var()`-fallback path only
 * differ in what `replaceRange`/`excludeOffset` they pass in; a matching
 * custom property is always re-wrapped in `var(...)` (dropping any stale
 * fallback in the fallback-path case), a matching variable never is.
 */
function buildColorReplacementActions(
	document: TextDocument,
	documentPath: string,
	replaceRange: Range,
	colorKey: string,
	storage: StorageService,
	importGraph: ImportGraphService,
	settings: ISettings,
	excludeOffset: number | undefined
): CodeAction[] {
	const actions: CodeAction[] = [];

	for (const candidate of takeCandidates(iterateColorCustomPropertyCandidates(storage, settings, colorKey, documentPath, excludeOffset))) {
		const relativePath = getDocumentPath(documentPath, candidate.fsPath);

		actions.push({
			title: `Replace with var(${candidate.property.name}) (${relativePath})`,
			kind: CodeActionKind.RefactorRewrite,
			edit: {
				changes: {
					[document.uri]: [TextEdit.replace(replaceRange, `var(${candidate.property.name})`)]
				}
			}
		});
	}

	for (const candidate of takeCandidates(iterateColorVariableCandidates(storage, colorKey, documentPath, excludeOffset))) {
		const accessibility = resolveVariableAccessibility(document, documentPath, candidate.fsPath, candidate.variable.name, importGraph);
		const relativePath = getDocumentPath(documentPath, candidate.fsPath);
		const suffix = accessibility.insertUseEdit !== undefined ? ' (adds @use)' : '';

		const edits = [TextEdit.replace(replaceRange, accessibility.replacement)];
		if (accessibility.insertUseEdit !== undefined) {
			edits.push(accessibility.insertUseEdit);
		}

		actions.push({
			title: `Replace with ${candidate.variable.name} (${relativePath})${suffix}`,
			kind: CodeActionKind.RefactorRewrite,
			edit: {
				changes: {
					[document.uri]: edits
				}
			}
		});
	}

	return actions;
}

function getEnclosingVariableDeclarationOffset(node: INode | null): number | undefined {
	if (node === null) {
		return undefined;
	}

	return getParentNodeByType(node, NodeType.VariableDeclaration)?.offset;
}

export async function doCodeAction(
	document: TextDocument,
	range: Range,
	storage: StorageService,
	importGraph: ImportGraphService,
	settings: ISettings
): Promise<CodeAction[]> {
	const documentPath = URI.parse(document.uri).fsPath;
	const offset = document.offsetAt(range.start);

	const resource = await parseDocument(document, offset);
	if (resource.symbols.document !== undefined) {
		storage.set(document.uri, resource.symbols);
	}

	// Trigger 1: cursor on a plain color literal (#hex, rgb()/hsl(), named word).
	const lineText = getLineText(document, range.start.line);
	const literal = findColorLiteralAt(lineText, range.start.character);

	if (literal !== null) {
		const colorKey = normalizeColor(literal.text);
		if (colorKey === null) {
			return [];
		}

		const replaceRange = Range.create(
			Position.create(range.start.line, literal.start),
			Position.create(range.start.line, literal.end)
		);

		const excludeOffset = getEnclosingVariableDeclarationOffset(resource.node);

		return buildColorReplacementActions(document, documentPath, replaceRange, colorKey, storage, importGraph, settings, excludeOffset);
	}

	// Trigger 2: cursor on the property-name argument of `var(--undeclared, #fallback)`.
	if (resource.node === null) {
		return [];
	}

	const fallbackContext = detectVarFallbackContext(resource.node);
	if (fallbackContext === null) {
		return [];
	}

	const alreadyDeclared = getCustomPropertyCandidates(storage, settings).some(
		candidate => candidate.property.name === fallbackContext.propertyName
	);
	if (alreadyDeclared) {
		return [];
	}

	const colorKey = normalizeColor(fallbackContext.fallbackNode.getText());
	if (colorKey === null) {
		return [];
	}

	const callRange = Range.create(
		document.positionAt(fallbackContext.callNode.offset),
		document.positionAt(fallbackContext.callNode.end)
	);

	return buildColorReplacementActions(document, documentPath, callRange, colorKey, storage, importGraph, settings, undefined);
}
