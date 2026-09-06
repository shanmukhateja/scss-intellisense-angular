'use strict';

import * as assert from 'assert';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { resolveStyleDocument, forgetStyleDocument } from '../../services/embeddedStyleDocument.js';

let seq = 0;

function tsDoc(text: string, version = 1): TextDocument {
	// A distinct URI per document keeps the module-level region cache (keyed by
	// {uri, version}) from bleeding between cases.
	return TextDocument.create(`file:///c${seq++}.component.ts`, 'typescript', version, text);
}

describe('Services/EmbeddedStyleDocument', () => {
	describe('resolveStyleDocument', () => {
		it('passes a non-typescript document straight through', () => {
			const doc = TextDocument.create('file:///a.scss', 'scss', 1, '.a { color: red; }');

			const resolved = resolveStyleDocument(doc, { start: 3 });

			assert.strictEqual(resolved?.document, doc);
			assert.strictEqual(resolved?.embedded, false);
		});

		it('returns a blanked scss view when the offset is inside inline styles', () => {
			const text = '@Component({ styles: [`.a { color: #fff; }`] }) class C {}';
			const doc = tsDoc(text);

			const resolved = resolveStyleDocument(doc, { start: text.indexOf('#fff') });

			assert.strictEqual(resolved?.embedded, true);
			assert.strictEqual(resolved?.document.languageId, 'scss');
			assert.strictEqual(resolved?.document.getText().length, text.length);
			assert.ok(resolved?.document.getText().includes('.a { color: #fff; }'));
			assert.ok(!resolved?.document.getText().includes('@Component'));
		});

		it('returns undefined when the offset is outside inline styles', () => {
			const text = '@Component({ styles: [`.a {}`] }) class C {}';
			const doc = tsDoc(text);

			assert.strictEqual(resolveStyleDocument(doc, { start: text.indexOf('class') }), undefined);
		});

		it('returns undefined for a typescript file with no component styles', () => {
			assert.strictEqual(resolveStyleDocument(tsDoc('export const x = 1;'), { start: 5 }), undefined);
		});

		it('re-parses after the document version changes', () => {
			const uri = 'file:///v.component.ts';

			const before = '@Component({ styles: [`.a {}`] }) class C {}';
			assert.strictEqual(
				resolveStyleDocument(TextDocument.create(uri, 'typescript', 1, before), { start: before.indexOf('class') }),
				undefined
			);

			const after = '@Component({ styles: [`.a { color: #000; }`] }) class C {}';
			const resolved = resolveStyleDocument(TextDocument.create(uri, 'typescript', 2, after), { start: after.indexOf('#000') });

			assert.strictEqual(resolved?.embedded, true);

			forgetStyleDocument(uri);
		});
	});
});
