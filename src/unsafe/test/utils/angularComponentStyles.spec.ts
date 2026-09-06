'use strict';

import * as assert from 'assert';

import { extractStyleRegions, type ISpan } from '../../utils/angularComponentStyles.js';

function slice(text: string, span: ISpan): string {
	return text.slice(span.start, span.end);
}

describe('Utils/AngularComponentStyles', () => {
	describe('extractStyleRegions', () => {
		it('extracts a single template-literal styles string', () => {
			const text = [
				'@Component({',
				'  styles: [`.a { color: #fff; }`]',
				'})',
				'class C {}'
			].join('\n');

			const { styleSpans, interpolationSpans } = extractStyleRegions(text);

			assert.strictEqual(styleSpans.length, 1);
			assert.strictEqual(slice(text, styleSpans[0]!), '.a { color: #fff; }');
			assert.deepStrictEqual(interpolationSpans, []);
		});

		it('extracts a plain single-quoted styles string (Angular 17+ form)', () => {
			const text = "@Component({ styles: '.a{color:red}' }) class C {}";

			const { styleSpans } = extractStyleRegions(text);

			assert.strictEqual(styleSpans.length, 1);
			assert.strictEqual(slice(text, styleSpans[0]!), '.a{color:red}');
		});

		it('extracts every element of a styles array', () => {
			const text = "@Component({ styles: ['.a{}', `.b{}`, \".c{}\"] }) class C {}";

			const { styleSpans } = extractStyleRegions(text);

			assert.deepStrictEqual(styleSpans.map(span => slice(text, span)), ['.a{}', '.b{}', '.c{}']);
		});

		it('reports ${} interpolation spans that sit inside the style span', () => {
			const text = '@Component({ styles: [`.a { width: ${x}px; }`] }) class C {}';

			const { styleSpans, interpolationSpans } = extractStyleRegions(text);

			assert.strictEqual(interpolationSpans.length, 1);
			assert.strictEqual(slice(text, interpolationSpans[0]!), '${x}');
			assert.ok(interpolationSpans[0]!.start >= styleSpans[0]!.start);
			assert.ok(interpolationSpans[0]!.end <= styleSpans[0]!.end);
		});

		it('ignores styleUrls / styleUrl', () => {
			const text = "@Component({ styleUrls: ['./a.scss'], styleUrl: './b.scss' }) class C {}";

			assert.deepStrictEqual(extractStyleRegions(text), { styleSpans: [], interpolationSpans: [] });
		});

		it('ignores a `styles:` occurrence inside a comment', () => {
			const text = [
				"// styles: ['.commented{}']",
				"/* styles: '.block{}' */",
				"@Component({ styles: ['.real{}'] }) class C {}"
			].join('\n');

			const { styleSpans } = extractStyleRegions(text);

			assert.deepStrictEqual(styleSpans.map(span => slice(text, span)), ['.real{}']);
		});

		it('handles multiple @Component decorators in one file', () => {
			const text = [
				"@Component({ styles: ['.one{}'] }) class A {}",
				"@Component({ styles: ['.two{}'] }) class B {}"
			].join('\n');

			const { styleSpans } = extractStyleRegions(text);

			assert.deepStrictEqual(styleSpans.map(span => slice(text, span)), ['.one{}', '.two{}']);
		});

		it('resolves a namespaced decorator (core.Component)', () => {
			const text = "@core.Component({ styles: ['.x{}'] }) class C {}";

			const { styleSpans } = extractStyleRegions(text);

			assert.deepStrictEqual(styleSpans.map(span => slice(text, span)), ['.x{}']);
		});

		it('returns empty for a file with no component styles', () => {
			assert.deepStrictEqual(extractStyleRegions('export const x = 1;'), { styleSpans: [], interpolationSpans: [] });
		});

		it('keeps offsets correct with CRLF line endings', () => {
			const text = '@Component({\r\n  styles: [`.a {\r\n    color: #fff;\r\n  }`]\r\n})\r\nclass C {}';

			const { styleSpans } = extractStyleRegions(text);

			assert.strictEqual(styleSpans.length, 1);
			assert.ok(slice(text, styleSpans[0]!).includes('color: #fff;'));
		});
	});
});
