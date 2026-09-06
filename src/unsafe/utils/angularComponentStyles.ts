'use strict';

import ts from 'typescript';

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

function propertyName(name: ts.PropertyName): string | undefined {
	if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) {
		return name.text;
	}

	return undefined;
}

function decoratorName(expression: ts.LeftHandSideExpression): string | undefined {
	if (ts.isIdentifier(expression)) {
		return expression.text;
	}

	if (ts.isPropertyAccessExpression(expression)) {
		return expression.name.text;
	}

	return undefined;
}

/**
 * Inner offset spans of every inline `styles` string in an Angular `@Component`
 * decorator, plus the `${ ... }` interpolation spans inside any template
 * literals.
 *
 * Uses the TypeScript compiler's own parser (`ts.createSourceFile`) rather than
 * a hand-rolled scanner: template literals, nested braces, comments and escaped
 * quotes are all handled correctly for free. `styleUrls`/`styleUrl` are ignored
 * — those point at real `.scss` files the `**\/*.scss` glob already covers.
 */
export function extractStyleRegions(text: string): IStyleRegions {
	const source = ts.createSourceFile('inline.ts', text, ts.ScriptTarget.Latest, /* setParentNodes */ true, ts.ScriptKind.TS);

	const styleSpans: ISpan[] = [];
	const interpolationSpans: ISpan[] = [];

	const collect = (node: ts.Node): void => {
		if (ts.isStringLiteralLike(node)) {
			// getStart() skips leading trivia; +1/-1 strips the surrounding quote/backtick.
			styleSpans.push({ start: node.getStart(source) + 1, end: node.getEnd() - 1 });

			return;
		}

		if (ts.isTemplateExpression(node)) {
			styleSpans.push({ start: node.getStart(source) + 1, end: node.getEnd() - 1 });

			for (const span of node.templateSpans) {
				// `${` is 2 chars before the expression, `}` is 1 char after it.
				interpolationSpans.push({ start: span.expression.getStart(source) - 2, end: span.expression.getEnd() + 1 });
			}

			return;
		}

		if (ts.isArrayLiteralExpression(node)) {
			for (const element of node.elements) {
				collect(element);
			}
		}
	};

	const visit = (node: ts.Node): void => {
		if (ts.isDecorator(node) && ts.isCallExpression(node.expression) && decoratorName(node.expression.expression) === 'Component') {
			const [metadata] = node.expression.arguments;

			if (metadata !== undefined && ts.isObjectLiteralExpression(metadata)) {
				for (const property of metadata.properties) {
					if (ts.isPropertyAssignment(property) && propertyName(property.name) === 'styles') {
						collect(property.initializer);
					}
				}
			}
		}

		ts.forEachChild(node, visit);
	};

	visit(source);

	if (styleSpans.length === 0) {
		return EMPTY;
	}

	return { styleSpans, interpolationSpans };
}
