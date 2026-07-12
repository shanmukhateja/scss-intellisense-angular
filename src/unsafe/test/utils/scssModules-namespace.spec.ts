'use strict';

import * as assert from 'assert';

import { URI } from 'vscode-uri';

import { detectModuleAccess, resolveNamespacedSymbol, resolveNamespaceMembers } from '../../utils/scssModules.js';
import { getNodeAtOffset } from '../../utils/ast.js';
import * as helpers from '../helpers.js';
import StorageService from '../../services/storage.js';
import ImportGraphService from '../../services/importGraph.js';
import type { IDocumentSymbols } from '../../types/symbols.js';

function findNode(source: string) {
	const offset = source.indexOf('|');
	const clean = source.replace('|', '');
	const ast = helpers.makeAst(clean.split('\n'));

	return getNodeAtOffset(ast, offset);
}

function makeSymbols(fsPath: string, overrides: Partial<IDocumentSymbols> = {}): IDocumentSymbols {
	return {
		document: fsPath,
		filepath: fsPath,
		variables: [],
		mixins: [],
		functions: [],
		imports: [],
		uses: [],
		forwards: [],
		customProperties: [],
		...overrides
	};
}

function setDocument(storage: StorageService, fsPath: string, overrides: Partial<IDocumentSymbols> = {}): void {
	storage.set(URI.file(fsPath).toString(), makeSymbols(fsPath, overrides));
}

describe('Utils/ScssModules - namespace access', () => {
	describe('detectModuleAccess', () => {
		it('detects a namespaced variable', () => {
			const node = findNode('.a { color: colors.$pri|mary; }');
			const access = detectModuleAccess(node!);

			assert.deepStrictEqual(access, { namespace: 'colors', memberType: 'variables', memberName: '$primary' });
		});

		it('detects a namespaced function', () => {
			const node = findNode('.a { color: colors.get-sh|ade(1); }');
			const access = detectModuleAccess(node!);

			assert.deepStrictEqual(access, { namespace: 'colors', memberType: 'functions', memberName: 'get-shade' });
		});

		it('detects a namespaced mixin include', () => {
			const node = findNode('.a { @include ns.mi|xin-name(); }');
			const access = detectModuleAccess(node!);

			assert.deepStrictEqual(access, { namespace: 'ns', memberType: 'mixins', memberName: 'mixin-name' });
		});

		it('returns null for a bare (non-namespaced) variable', () => {
			const node = findNode('.a { color: $pri|mary; }');
			const access = detectModuleAccess(node!);

			assert.strictEqual(access, null);
		});

		it('returns null for a bare (non-namespaced) mixin include', () => {
			const node = findNode('.a { @include mi|xin-name(); }');
			const access = detectModuleAccess(node!);

			assert.strictEqual(access, null);
		});
	});

	describe('resolveNamespacedSymbol', () => {
		it('resolves a member declared directly in the @use target', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss', {
				uses: [{ namespace: 'vars', wildcard: false, resolvedPath: '/proj/_vars.scss', targetRaw: 'vars' }]
			});
			setDocument(storage, '/proj/_vars.scss', {
				variables: [{ name: '$primary', value: 'blue', offset: 0, position: { line: 0, character: 0 } }]
			});

			const graph = new ImportGraphService(storage);
			const result = resolveNamespacedSymbol(graph, '/proj/component.scss', 'vars', '$primary', 'variables');

			assert.strictEqual(result?.documentPath, '/proj/_vars.scss');
			assert.strictEqual(result?.symbol.name, '$primary');
		});

		it('returns null for an unknown namespace', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss');

			const graph = new ImportGraphService(storage);
			const result = resolveNamespacedSymbol(graph, '/proj/component.scss', 'nope', '$x', 'variables');

			assert.strictEqual(result, null);
		});

		it('follows a @forward re-export one hop', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss', {
				uses: [{ namespace: 'ui', wildcard: false, resolvedPath: '/proj/_index.scss', targetRaw: 'index' }]
			});
			setDocument(storage, '/proj/_index.scss', {
				forwards: [{ prefix: null, show: null, hide: null, resolvedPath: '/proj/_buttons.scss', targetRaw: 'buttons' }]
			});
			setDocument(storage, '/proj/_buttons.scss', {
				mixins: [{ name: 'reset', parameters: [], offset: 0, position: { line: 0, character: 0 } }]
			});

			const graph = new ImportGraphService(storage);
			const result = resolveNamespacedSymbol(graph, '/proj/component.scss', 'ui', 'reset', 'mixins');

			assert.strictEqual(result?.documentPath, '/proj/_buttons.scss');
			assert.strictEqual(result?.symbol.name, 'reset');
		});

		it('resolves a prefixed forward (as <prefix>-*) by stripping the prefix from the consumer name', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss', {
				uses: [{ namespace: 'ui', wildcard: false, resolvedPath: '/proj/_index.scss', targetRaw: 'index' }]
			});
			setDocument(storage, '/proj/_index.scss', {
				forwards: [{ prefix: 'btn-', show: null, hide: null, resolvedPath: '/proj/_buttons.scss', targetRaw: 'buttons' }]
			});
			setDocument(storage, '/proj/_buttons.scss', {
				variables: [{ name: '$color', value: 'red', offset: 0, position: { line: 0, character: 0 } }],
				mixins: [{ name: 'reset', parameters: [], offset: 0, position: { line: 0, character: 0 } }]
			});

			const graph = new ImportGraphService(storage);

			// variable: prefix goes after the `$` sigil → ui.$btn-color
			const variableResult = resolveNamespacedSymbol(graph, '/proj/component.scss', 'ui', '$btn-color', 'variables');
			assert.strictEqual(variableResult?.symbol.name, '$color');

			// mixin: prefix goes at the start → ui.btn-reset
			const mixinResult = resolveNamespacedSymbol(graph, '/proj/component.scss', 'ui', 'btn-reset', 'mixins');
			assert.strictEqual(mixinResult?.symbol.name, 'reset');
		});

		it('respects a `hide` list on the forward', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss', {
				uses: [{ namespace: 'ui', wildcard: false, resolvedPath: '/proj/_index.scss', targetRaw: 'index' }]
			});
			setDocument(storage, '/proj/_index.scss', {
				forwards: [{ prefix: null, show: null, hide: ['$internal'], resolvedPath: '/proj/_buttons.scss', targetRaw: 'buttons' }]
			});
			setDocument(storage, '/proj/_buttons.scss', {
				variables: [{ name: '$internal', value: 'red', offset: 0, position: { line: 0, character: 0 } }]
			});

			const graph = new ImportGraphService(storage);
			const result = resolveNamespacedSymbol(graph, '/proj/component.scss', 'ui', '$internal', 'variables');

			assert.strictEqual(result, null);
		});

		it('respects a `show` list on the forward (excludes names not listed)', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss', {
				uses: [{ namespace: 'ui', wildcard: false, resolvedPath: '/proj/_index.scss', targetRaw: 'index' }]
			});
			setDocument(storage, '/proj/_index.scss', {
				forwards: [{ prefix: null, show: ['$public'], hide: null, resolvedPath: '/proj/_buttons.scss', targetRaw: 'buttons' }]
			});
			setDocument(storage, '/proj/_buttons.scss', {
				variables: [
					{ name: '$public', value: 'red', offset: 0, position: { line: 0, character: 0 } },
					{ name: '$private', value: 'blue', offset: 0, position: { line: 0, character: 0 } }
				]
			});

			const graph = new ImportGraphService(storage);

			assert.strictEqual(resolveNamespacedSymbol(graph, '/proj/component.scss', 'ui', '$public', 'variables')?.symbol.name, '$public');
			assert.strictEqual(resolveNamespacedSymbol(graph, '/proj/component.scss', 'ui', '$private', 'variables'), null);
		});

		it('does not infinite-loop on a circular @forward chain', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss', {
				uses: [{ namespace: 'a', wildcard: false, resolvedPath: '/proj/_a.scss', targetRaw: 'a' }]
			});
			setDocument(storage, '/proj/_a.scss', {
				forwards: [{ prefix: null, show: null, hide: null, resolvedPath: '/proj/_b.scss', targetRaw: 'b' }]
			});
			setDocument(storage, '/proj/_b.scss', {
				forwards: [{ prefix: null, show: null, hide: null, resolvedPath: '/proj/_a.scss', targetRaw: 'a' }]
			});

			const graph = new ImportGraphService(storage);
			const result = resolveNamespacedSymbol(graph, '/proj/component.scss', 'a', '$missing', 'variables');

			assert.strictEqual(result, null);
		});
	});

	describe('resolveNamespaceMembers', () => {
		it('lists members declared directly in the @use target', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss', {
				uses: [{ namespace: 'vars', wildcard: false, resolvedPath: '/proj/_vars.scss', targetRaw: 'vars' }]
			});
			setDocument(storage, '/proj/_vars.scss', {
				variables: [
					{ name: '$a', value: '1', offset: 0, position: { line: 0, character: 0 } },
					{ name: '$b', value: '2', offset: 0, position: { line: 0, character: 0 } }
				]
			});

			const graph = new ImportGraphService(storage);
			const members = resolveNamespaceMembers(graph, '/proj/component.scss', 'vars', 'variables').map(m => m.symbol.name);

			assert.deepStrictEqual(members.sort(), ['$a', '$b']);
		});

		it('includes forwarded members with the prefix applied, alongside direct ones', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss', {
				uses: [{ namespace: 'ui', wildcard: false, resolvedPath: '/proj/_index.scss', targetRaw: 'index' }]
			});
			setDocument(storage, '/proj/_index.scss', {
				mixins: [{ name: 'own-mixin', parameters: [], offset: 0, position: { line: 0, character: 0 } }],
				forwards: [{ prefix: 'btn-', show: null, hide: null, resolvedPath: '/proj/_buttons.scss', targetRaw: 'buttons' }]
			});
			setDocument(storage, '/proj/_buttons.scss', {
				mixins: [{ name: 'reset', parameters: [], offset: 0, position: { line: 0, character: 0 } }]
			});

			const graph = new ImportGraphService(storage);
			const members = resolveNamespaceMembers(graph, '/proj/component.scss', 'ui', 'mixins').map(m => m.symbol.name);

			assert.deepStrictEqual(members.sort(), ['btn-reset', 'own-mixin']);
		});

		it('compounds prefixes across a two-level @forward chain', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss', {
				uses: [{ namespace: 'ui', wildcard: false, resolvedPath: '/proj/_index.scss', targetRaw: 'index' }]
			});
			setDocument(storage, '/proj/_index.scss', {
				forwards: [{ prefix: 'btn-', show: null, hide: null, resolvedPath: '/proj/_buttons.scss', targetRaw: 'buttons' }]
			});
			setDocument(storage, '/proj/_buttons.scss', {
				forwards: [{ prefix: 'core-', show: null, hide: null, resolvedPath: '/proj/_core.scss', targetRaw: 'core' }]
			});
			setDocument(storage, '/proj/_core.scss', {
				variables: [{ name: '$x', value: '1', offset: 0, position: { line: 0, character: 0 } }]
			});

			const graph = new ImportGraphService(storage);
			const members = resolveNamespaceMembers(graph, '/proj/component.scss', 'ui', 'variables').map(m => m.symbol.name);

			assert.deepStrictEqual(members, ['$btn-core-x']);
		});

		it('returns an empty list for an unknown namespace', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss');

			const graph = new ImportGraphService(storage);

			assert.deepStrictEqual(resolveNamespaceMembers(graph, '/proj/component.scss', 'nope', 'variables'), []);
		});
	});
});
