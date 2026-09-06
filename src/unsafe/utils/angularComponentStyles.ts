'use strict';

import { parse, type ParserOptions } from '@babel/parser';

import type { Node } from '@babel/types';

export interface ISpan {
	start: number;
	end: number;
}

export interface IStyleRegions {
	/**
	 * Inner offset spans (quote/backtick excluded) of every inline `styles`
	 * string found in an `@Component` decorator.
	 */
	styleSpans: ISpan[];
	/**
	 * `${ ... }` spans inside those style strings, delimiters included — callers
	 * blank these so a template expression is never fed to the SCSS parser.
	 */
	interpolationSpans: ISpan[];
}

const EMPTY: IStyleRegions = { styleSpans: [], interpolationSpans: [] };

const PARSE_OPTIONS: ParserOptions = {
	// Angular component files carry top-level `import`s; `unambiguous` lets Babel
	// pick module vs script itself so a plain script never trips the parser.
	sourceType: 'unambiguous',
	// Behave like `ts.createSourceFile`: collect syntax errors instead of
	// throwing, so a half-typed file still yields whatever parsed.
	errorRecovery: true,
	plugins: ['typescript', 'decorators-legacy']
};

function isNode(value: unknown): value is Node {
	return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/**
 * Visits `root` and every AST node reachable from it. Position and comment
 * metadata hang off nodes under fixed keys and never hold child nodes, so they
 * are skipped rather than walked.
 */
function walk(root: Node, visit: (node: Node) => void): void {
	visit(root);

	for (const key in root) {
		if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') {
			continue;
		}

		const value = (root as unknown as Record<string, unknown>)[key];

		if (Array.isArray(value)) {
			for (const item of value) {
				if (isNode(item)) {
					walk(item, visit);
				}
			}
		} else if (isNode(value)) {
			walk(value, visit);
		}
	}
}

function propertyKeyName(node: Node): string | undefined {
	if (node.type === 'Identifier') {
		return node.name;
	}

	if (node.type === 'StringLiteral') {
		return node.value;
	}

	return undefined;
}

function calleeName(node: Node): string | undefined {
	if (node.type === 'Identifier') {
		return node.name;
	}

	if (node.type === 'MemberExpression' && node.property.type === 'Identifier') {
		return node.property.name;
	}

	return undefined;
}

function collectStyleValue(node: Node, styleSpans: ISpan[], interpolationSpans: ISpan[]): void {
	if (node.start === null || node.end === null || node.start === undefined || node.end === undefined) {
		return;
	}

	if (node.type === 'StringLiteral') {
		// +1 / -1 strips the surrounding quote.
		styleSpans.push({ start: node.start + 1, end: node.end - 1 });

		return;
	}

	if (node.type === 'TemplateLiteral') {
		// Covers both a plain `` `x` `` and one with `${ ... }` substitutions.
		styleSpans.push({ start: node.start + 1, end: node.end - 1 });

		for (const expression of node.expressions) {
			if (expression.start === null || expression.end === null || expression.start === undefined || expression.end === undefined) {
				continue;
			}

			// `${` is 2 chars before the expression, `}` is 1 char after it.
			interpolationSpans.push({ start: expression.start - 2, end: expression.end + 1 });
		}

		return;
	}

	if (node.type === 'ArrayExpression') {
		for (const element of node.elements) {
			if (element !== null && element.type !== 'SpreadElement') {
				collectStyleValue(element, styleSpans, interpolationSpans);
			}
		}
	}
}

/**
 * Inner offset spans of every inline `styles` string in an Angular `@Component`
 * decorator, plus the `${ ... }` interpolation spans inside any template
 * literals.
 *
 * Uses a real JS/TS parser (`@babel/parser`) rather than a hand-rolled scanner:
 * template literals, nested braces, comments and escaped quotes are all handled
 * correctly for free. `styleUrls`/`styleUrl` are ignored — those point at real
 * `.scss` files the `**\/*.scss` glob already covers.
 */
export function extractStyleRegions(text: string): IStyleRegions {
	let program: Node;

	try {
		program = parse(text, PARSE_OPTIONS).program;
	} catch {
		return EMPTY;
	}

	const styleSpans: ISpan[] = [];
	const interpolationSpans: ISpan[] = [];

	walk(program, node => {
		if (node.type !== 'Decorator' || node.expression.type !== 'CallExpression') {
			return;
		}

		if (calleeName(node.expression.callee as Node) !== 'Component') {
			return;
		}

		const [metadata] = node.expression.arguments;

		if (metadata === undefined || metadata.type !== 'ObjectExpression') {
			return;
		}

		for (const property of metadata.properties) {
			if (property.type === 'ObjectProperty' && propertyKeyName(property.key as Node) === 'styles') {
				collectStyleValue(property.value as Node, styleSpans, interpolationSpans);
			}
		}
	});

	if (styleSpans.length === 0) {
		return EMPTY;
	}

	return { styleSpans, interpolationSpans };
}
