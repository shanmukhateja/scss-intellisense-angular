'use strict';

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { URI } from 'vscode-uri';

import StorageService from '../../services/storage.js';
import ImportGraphService from '../../services/importGraph.js';
import AngularWorkspaceService from '../../services/angularWorkspace.js';
import type { IDocumentSymbols } from '../../types/symbols.js';

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

describe('Services/ImportGraph', () => {
	describe('.getReachableDocuments', () => {
		it('includes the entry document itself', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss');

			const graph = new ImportGraphService(storage);
			const reachable = graph.getReachableDocuments('/proj/component.scss');

			assert.strictEqual(reachable.length, 1);
			assert.strictEqual(reachable[0]?.filepath, '/proj/component.scss');
		});

		it('follows @import edges transitively', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss', {
				imports: [{ filepath: '/proj/_a.scss', dynamic: false, css: false }]
			});
			setDocument(storage, '/proj/_a.scss', {
				imports: [{ filepath: '/proj/_b.scss', dynamic: false, css: false }]
			});
			setDocument(storage, '/proj/_b.scss');

			const graph = new ImportGraphService(storage);
			const reachable = graph.getReachableDocuments('/proj/component.scss').map(doc => doc.filepath);

			assert.deepStrictEqual(reachable.sort(), ['/proj/_a.scss', '/proj/_b.scss', '/proj/component.scss'].sort());
		});

		it('does not follow dynamic or css imports', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss', {
				imports: [
					{ filepath: '/proj/dynamic/*.scss', dynamic: true, css: false },
					{ filepath: '/proj/plain.css', dynamic: false, css: true }
				]
			});

			const graph = new ImportGraphService(storage);
			const reachable = graph.getReachableDocuments('/proj/component.scss');

			assert.strictEqual(reachable.length, 1);
		});

		it('follows @use ... as * (wildcard) edges', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss', {
				uses: [{ namespace: 'globals', wildcard: true, resolvedPath: '/proj/_globals.scss', targetRaw: 'globals' }]
			});
			setDocument(storage, '/proj/_globals.scss');

			const graph = new ImportGraphService(storage);
			const reachable = graph.getReachableDocuments('/proj/component.scss').map(doc => doc.filepath);

			assert.deepStrictEqual(reachable.sort(), ['/proj/_globals.scss', '/proj/component.scss'].sort());
		});

		it('does not follow a plain (non-wildcard) @use edge into the bare-name scope', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss', {
				uses: [{ namespace: 'vars', wildcard: false, resolvedPath: '/proj/_vars.scss', targetRaw: 'vars' }]
			});
			setDocument(storage, '/proj/_vars.scss');

			const graph = new ImportGraphService(storage);
			const reachable = graph.getReachableDocuments('/proj/component.scss');

			assert.strictEqual(reachable.length, 1);
			assert.strictEqual(reachable[0]?.filepath, '/proj/component.scss');
		});

		it('does not follow @forward edges into the bare-name scope', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/_index.scss', {
				forwards: [{ prefix: null, show: null, hide: null, resolvedPath: '/proj/_buttons.scss', targetRaw: 'buttons' }]
			});
			setDocument(storage, '/proj/_buttons.scss');

			const graph = new ImportGraphService(storage);
			const reachable = graph.getReachableDocuments('/proj/_index.scss');

			assert.strictEqual(reachable.length, 1);
			assert.strictEqual(reachable[0]?.filepath, '/proj/_index.scss');
		});

		it('does not loop forever on circular @import edges', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/a.scss', {
				imports: [{ filepath: '/proj/b.scss', dynamic: false, css: false }]
			});
			setDocument(storage, '/proj/b.scss', {
				imports: [{ filepath: '/proj/a.scss', dynamic: false, css: false }]
			});

			const graph = new ImportGraphService(storage);
			const reachable = graph.getReachableDocuments('/proj/a.scss');

			assert.strictEqual(reachable.length, 2);
		});
	});

	describe('.resolveNamespace', () => {
		it('resolves an explicit namespace to its target document', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss', {
				uses: [{ namespace: 'vars', wildcard: false, resolvedPath: '/proj/_vars.scss', targetRaw: 'vars' }]
			});

			const graph = new ImportGraphService(storage);

			assert.strictEqual(graph.resolveNamespace('/proj/component.scss', 'vars'), '/proj/_vars.scss');
		});

		it('returns undefined for an unknown namespace', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss');

			const graph = new ImportGraphService(storage);

			assert.strictEqual(graph.resolveNamespace('/proj/component.scss', 'nope'), undefined);
		});

		it('does not resolve a wildcard use as a namespace', () => {
			const storage = new StorageService();
			setDocument(storage, '/proj/component.scss', {
				uses: [{ namespace: 'globals', wildcard: true, resolvedPath: '/proj/_globals.scss', targetRaw: 'globals' }]
			});

			const graph = new ImportGraphService(storage);

			assert.strictEqual(graph.resolveNamespace('/proj/component.scss', 'globals'), undefined);
		});
	});

	describe('.resolveEdgeTarget (includePaths fallback)', () => {
		function makeAngularWorkspace(includePaths: string[]) {
			return {
				getIncludePaths: () => includePaths
			} as unknown as AngularWorkspaceService;
		}

		it('uses the already-resolved path when present, without touching includePaths', () => {
			const storage = new StorageService();
			const graph = new ImportGraphService(storage, makeAngularWorkspace(['/should/not/be/used']));

			const resolved = graph.resolveEdgeTarget('/proj/component.scss', {
				namespace: 'vars', wildcard: false, resolvedPath: '/proj/_vars.scss', targetRaw: 'vars'
			});

			assert.strictEqual(resolved, '/proj/_vars.scss');
		});

		it('falls back to probing includePaths for a bare specifier the standard resolver could not place', () => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-scss-importgraph-'));
			fs.mkdirSync(path.join(root, 'styles'));
			fs.writeFileSync(path.join(root, 'styles', '_variables.scss'), '$primary: blue;');

			const storage = new StorageService();
			const graph = new ImportGraphService(storage, makeAngularWorkspace([path.join(root, 'styles')]));

			const resolved = graph.resolveEdgeTarget('/proj/component.scss', {
				namespace: 'vars', wildcard: false, resolvedPath: undefined, targetRaw: 'variables'
			});

			assert.strictEqual(resolved, path.join(root, 'styles', '_variables.scss'));

			fs.rmSync(root, { recursive: true, force: true });
		});

		it('returns undefined when no includePath candidate exists on disk', () => {
			const storage = new StorageService();
			const graph = new ImportGraphService(storage, makeAngularWorkspace(['/nonexistent/path']));

			const resolved = graph.resolveEdgeTarget('/proj/component.scss', {
				namespace: 'vars', wildcard: false, resolvedPath: undefined, targetRaw: 'variables'
			});

			assert.strictEqual(resolved, undefined);
		});

		it('returns undefined without an AngularWorkspaceService and no pre-resolved path', () => {
			const storage = new StorageService();
			const graph = new ImportGraphService(storage);

			const resolved = graph.resolveEdgeTarget('/proj/component.scss', {
				namespace: 'vars', wildcard: false, resolvedPath: undefined, targetRaw: 'variables'
			});

			assert.strictEqual(resolved, undefined);
		});
	});
});
