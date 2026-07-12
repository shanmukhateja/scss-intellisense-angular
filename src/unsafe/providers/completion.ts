'use strict';

import { CompletionList, CompletionItemKind, CompletionItem } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import type { IMixin, IVariable, IFunction, IDocumentSymbols } from '../types/symbols.js';
import type { ISettings } from '../types/settings.js';
import type StorageService from '../services/storage.js';
import type ImportGraphService from '../services/importGraph.js';

import { parseDocument } from '../services/parser.js';
import { getDocumentPath } from '../utils/document.js';
import { getCurrentWord, getLimitedString, getTextBeforePosition } from '../utils/string.js';
import { getVariableColor } from '../utils/color.js';
import { resolveNamespaceMembers, type IResolvedModuleSymbol, type ModuleMemberType } from '../utils/scssModules.js';
import { getCustomPropertyCandidates, type ICustomPropertyCandidate } from '../utils/customProperties.js';

// RegExp's
const rePropertyValue = /.*:\s*/;
const reEmptyPropertyValue = /.*:\s*$/;
const reQuotedValueInString = /['"](?:[^'"\\]|\\.)*['"]/g;
const reMixinReference = /.*@include\s+(.*)/;
const reComment = /^(\/(\/|\*)|\*)/;
const reQuotes = /['"]/;
const reVarCallOpen = /var\(\s*$/;

/**
 * Return Mixin as string.
 */
function makeMixinDocumentation(symbol: IMixin): string {
	const args = symbol.parameters.map(item => `${item.name}: ${item.value}`).join(', ');
	return `${symbol.name}(${args}) {…}`;
}

/**
 * Check context for Variables suggestions.
 */
function checkVariableContext(
	word: string,
	isInterpolation: boolean,
	isPropertyValue: boolean,
	isEmptyValue: boolean,
	isQuotes: boolean
): boolean {
	if (isPropertyValue && !isEmptyValue && !isQuotes) {
		return word.includes('$');
	} else if (isQuotes) {
		return isInterpolation;
	}

	return word[0] === '$' || isInterpolation || isEmptyValue;
}

/**
 * Check context for Mixins suggestions.
 */
function checkMixinContext(textBeforeWord: string, isPropertyValue: boolean): boolean {
	return !isPropertyValue && reMixinReference.test(textBeforeWord);
}

/**
 * Check context for Function suggestions.
 */
function checkFunctionContext(
	textBeforeWord: string,
	isInterpolation: boolean,
	isPropertyValue: boolean,
	isEmptyValue: boolean,
	isQuotes: boolean,
	settings: ISettings
): boolean {
	if (isPropertyValue && !isEmptyValue && !isQuotes) {
		const lastChar = textBeforeWord.substr(-2, 1);
		return settings.suggestFunctionsInStringContextAfterSymbols.indexOf(lastChar) !== -1;
	} else if (isQuotes) {
		return isInterpolation;
	}

	return false;
}

/**
 * Check context for custom property (`var(--x)`) suggestions.
 */
function checkCustomPropertyContext(word: string, textBeforeWord: string): boolean {
	return word.startsWith('--') || reVarCallOpen.test(textBeforeWord);
}

function isCommentContext(text: string): boolean {
	return reComment.test(text.trim());
}

function isInterpolationContext(text: string): boolean {
	return text.includes('#{');
}

/**
 * A `namespace.member` (or `namespace.` with nothing typed yet) currently
 * being written. Text-based (like the rest of this file's context detection)
 * rather than AST-based, since completion routinely runs on syntactically
 * incomplete text mid-edit.
 */
function detectNamespacedWord(word: string): { namespace: string; memberPrefix: string } | null {
	const dotIndex = word.indexOf('.');
	if (dotIndex === -1) {
		return null;
	}

	return {
		namespace: word.slice(0, dotIndex),
		memberPrefix: word.slice(dotIndex + 1)
	};
}

function createCompletionContext(document: TextDocument, offset: number, settings: ISettings) {
	const currentWord = getCurrentWord(document.getText(), offset);
	const textBeforeWord = getTextBeforePosition(document.getText(), offset);

	// Is "#{INTERPOLATION}"
	const isInterpolation = isInterpolationContext(currentWord);

	// Information about current position
	const isPropertyValue = rePropertyValue.test(textBeforeWord);
	const isEmptyValue = reEmptyPropertyValue.test(textBeforeWord);
	const isQuotes = reQuotes.test(textBeforeWord.replace(reQuotedValueInString, ''));

	return {
		comment: isCommentContext(textBeforeWord),
		variable: checkVariableContext(currentWord, isInterpolation, isPropertyValue, isEmptyValue, isQuotes),
		function: checkFunctionContext(
			textBeforeWord,
			isInterpolation,
			isPropertyValue,
			isEmptyValue,
			isQuotes,
			settings
		),
		mixin: checkMixinContext(textBeforeWord, isPropertyValue),
		customProperty: checkCustomPropertyContext(currentWord, textBeforeWord),
		namespace: detectNamespacedWord(currentWord)
	};
}

function createVariableCompletionItems(symbols: IDocumentSymbols[], filepath: string): CompletionItem[] {
	const completions: CompletionItem[] = [];

	symbols.forEach(symbol => {
		const fsPath = getDocumentPath(filepath, symbol.filepath || symbol.document);

		symbol.variables.forEach(variable => {
			const color = getVariableColor(variable.value || '');
			const completionKind = color ? CompletionItemKind.Color : CompletionItemKind.Variable;

			// Add 'argument from MIXIN_NAME' suffix if Variable is Mixin argument
			let detailText = fsPath;
			if (variable.mixin) {
				detailText = `argument from ${variable.mixin}, ${detailText}`;
			}

			completions.push({
				label: variable.name,
				kind: completionKind,
				detail: detailText,
				documentation: getLimitedString(color ? color.toString() : variable.value || '')
			});
		});
	});

	return completions;
}

function createMixinCompletionItems(symbols: IDocumentSymbols[], filepath: string): CompletionItem[] {
	const completions: CompletionItem[] = [];

	symbols.forEach(symbol => {
		const fsPath = getDocumentPath(filepath, symbol.filepath || symbol.document);

		symbol.mixins.forEach(mixin => {
			completions.push({
				label: mixin.name,
				kind: CompletionItemKind.Function,
				detail: fsPath,
				documentation: makeMixinDocumentation(mixin),
				insertText: mixin.name
			});
		});
	});

	return completions;
}

function createFunctionCompletionItems(symbols: IDocumentSymbols[], filepath: string): CompletionItem[] {
	const completions: CompletionItem[] = [];

	symbols.forEach(symbol => {
		const fsPath = getDocumentPath(filepath, symbol.filepath || symbol.document);

		symbol.functions.forEach(func => {
			completions.push({
				label: func.name,
				kind: CompletionItemKind.Interface,
				detail: fsPath,
				documentation: makeMixinDocumentation(func),
				insertText: func.name
			});
		});
	});

	return completions;
}

function createNamespacedMemberCompletionItems(members: IResolvedModuleSymbol[], filepath: string, memberType: ModuleMemberType): CompletionItem[] {
	return members.map(({ symbol, documentPath }) => {
		const detail = getDocumentPath(filepath, documentPath);

		if (memberType === 'variables') {
			const variable = symbol as IVariable;
			const color = getVariableColor(variable.value || '');

			return {
				label: variable.name,
				kind: color ? CompletionItemKind.Color : CompletionItemKind.Variable,
				detail,
				documentation: getLimitedString(color ? color.toString() : variable.value || '')
			};
		}

		const callable = symbol as IMixin | IFunction;

		return {
			label: callable.name,
			kind: memberType === 'mixins' ? CompletionItemKind.Function : CompletionItemKind.Interface,
			detail,
			documentation: makeMixinDocumentation(callable),
			insertText: callable.name
		};
	});
}

function createCustomPropertyCompletionItems(candidates: ICustomPropertyCandidate[], filepath: string): CompletionItem[] {
	return candidates.map(({ property, fsPath }) => {
		const color = getVariableColor(property.value || '');

		return {
			label: property.name,
			kind: color ? CompletionItemKind.Color : CompletionItemKind.Variable,
			detail: getDocumentPath(filepath, fsPath),
			documentation: getLimitedString(color ? color.toString() : property.value || '')
		};
	});
}

export async function doCompletion(
	document: TextDocument,
	offset: number,
	settings: ISettings,
	storage: StorageService,
	importGraph: ImportGraphService
): Promise<CompletionList | null> {
	const completions = CompletionList.create([], false);

	const documentPath = URI.parse(document.uri).fsPath;

	const resource = await parseDocument(document, offset);

	storage.set(document.uri, resource.symbols);

	const context = createCompletionContext(document, offset, settings);

	// Drop suggestions inside `//` and `/* */` comments
	if (context.comment) {
		return completions;
	}

	// `namespace.` / `namespace.partial-member` — resolve through the @use
	// edge instead of the reachable-set/custom-property paths below.
	if (context.namespace !== null) {
		const { namespace } = context.namespace;

		if (settings.suggestVariables && context.variable) {
			const members = resolveNamespaceMembers(importGraph, documentPath, namespace, 'variables');
			completions.items = completions.items.concat(createNamespacedMemberCompletionItems(members, documentPath, 'variables'));
		}

		if (settings.suggestMixins && context.mixin) {
			const members = resolveNamespaceMembers(importGraph, documentPath, namespace, 'mixins');
			completions.items = completions.items.concat(createNamespacedMemberCompletionItems(members, documentPath, 'mixins'));
		}

		if (settings.suggestFunctions && context.function) {
			const members = resolveNamespaceMembers(importGraph, documentPath, namespace, 'functions');
			completions.items = completions.items.concat(createNamespacedMemberCompletionItems(members, documentPath, 'functions'));
		}

		return completions;
	}

	if (context.customProperty) {
		const candidates = getCustomPropertyCandidates(storage, settings);
		completions.items = completions.items.concat(createCustomPropertyCompletionItems(candidates, documentPath));

		return completions;
	}

	const symbolsList = importGraph.getReachableDocuments(documentPath);

	if (settings.suggestVariables && context.variable) {
		const variables = createVariableCompletionItems(symbolsList, documentPath);

		completions.items = completions.items.concat(variables);
	}

	if (settings.suggestMixins && context.mixin) {
		const mixins = createMixinCompletionItems(symbolsList, documentPath);

		completions.items = completions.items.concat(mixins);
	}

	if (settings.suggestFunctions && context.function) {
		const functions = createFunctionCompletionItems(symbolsList, documentPath);

		completions.items = completions.items.concat(functions);
	}

	return completions;
}
