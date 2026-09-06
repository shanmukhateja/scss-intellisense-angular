'use strict';

import * as path from 'path';

import { URI } from 'vscode-uri';

import type { IDocumentSymbols, IResolvedForward, IResolvedUse } from '../types/symbols.js';
import type StorageService from './storage.js';
import type AngularWorkspaceService from './angularWorkspace.js';
import { fileExistsSync } from '../utils/fs.js';

export default class ImportGraphService {
	constructor(
		private readonly storage: StorageService,
		private readonly angularWorkspace?: AngularWorkspaceService
	) {}

	/**
	 * Looks up a document's symbols by fs path (storage is keyed by URI).
	 */
	public getDocument(fsPath: string): IDocumentSymbols | undefined {
		return this.storage.get(URI.file(fsPath).toString());
	}

	/**
	 * Resolves a `@use`/`@forward` edge to an fs path. Prefers the path already
	 * resolved by `vscode-css-languageservice` at parse time (relative/`~`/
	 * underscore-partial resolution) when it points at a file that exists —
	 * that wins over the load path, matching Sass. `findDocumentLinks2` hands
	 * back a document-relative guess for *every* target though, so a bare
	 * `@use 'tokens'` (resolvable only through the load path) arrives with a
	 * bogus non-existent sibling path; when the pre-resolved path is missing
	 * or not on disk, probe each of `fromDocumentPath`'s Angular include paths
	 * (`angular.json`'s `stylePreprocessorOptions.includePaths` plus
	 * `scss.angular.includePaths`) in declared order, first match wins. If
	 * nothing on the load path matches either, the (possibly unstattable)
	 * pre-resolved path is returned as-is.
	 *
	 * `@import` edges aren't covered here (`IImport` only carries an
	 * already-resolved `filepath`, no raw target to retry) — acceptable since
	 * `@import` is the legacy construct this fork isn't optimizing for.
	 */
	public resolveEdgeTarget(fromDocumentPath: string, edge: IResolvedUse | IResolvedForward): string | undefined {
		const preResolved = edge.resolvedPath;

		// A pre-resolved path that points at a real file is authoritative
		// (relative/`~`/underscore-partial resolution, and it wins over the
		// load path, matching Sass).
		if (preResolved !== undefined && fileExistsSync(preResolved)) {
			return preResolved;
		}

		// Otherwise try the Angular load path. `findDocumentLinks2` resolves a
		// bare `@use 'tokens'` to a bogus sibling path that never exists, so
		// reaching this branch on a non-existent `preResolved` is exactly the
		// includePaths case.
		if (this.angularWorkspace !== undefined) {
			const dir = path.dirname(edge.targetRaw);
			const dirPrefix = dir === '.' ? '' : dir;
			const base = path.basename(edge.targetRaw);

			for (const includePath of this.angularWorkspace.getIncludePaths(fromDocumentPath)) {
				const candidates = [
					path.join(includePath, dirPrefix, base),
					path.join(includePath, dirPrefix, `${base}.scss`),
					path.join(includePath, dirPrefix, `_${base}.scss`),
					path.join(includePath, dirPrefix, `_${base}`)
				];

				const match = candidates.find(candidate => fileExistsSync(candidate));
				if (match !== undefined) {
					return match;
				}
			}
		}

		// No load-path hit: fall back to whatever the standard resolver gave
		// us, even if we couldn't stat it (in-memory documents, and callers
		// that only need the path to key storage).
		return preResolved;
	}

	/**
	 * The transitive set of documents whose bare-name (`$x`, `mixin-name(...)`,
	 * `function-name(...)`) symbols are visible from `entryPath`: the entry
	 * document itself, plus every file reachable through `@import` (legacy,
	 * unscoped) or `@use ... as *` (wildcard, explicitly global-visibility)
	 * edges.
	 *
	 * Plain `@use '...' as ns` targets are namespace-only and are deliberately
	 * NOT included here — see `resolveNamespace`. `@forward` targets are also
	 * excluded — a forwarding file's re-exports only become visible to a
	 * *consumer* that `@use`s the forwarding file, resolved via
	 * `resolveNamespace`/the forward-chain walk in `scssModules.ts`, not via
	 * bare-name access from the forwarding file itself.
	 */
	public getReachableDocuments(entryPath: string): IDocumentSymbols[] {
		const visited = new Set<string>();
		const queue: string[] = [entryPath];
		const result: IDocumentSymbols[] = [];

		while (queue.length > 0) {
			const current = queue.shift() as string;
			if (visited.has(current)) {
				continue;
			}

			visited.add(current);

			const doc = this.getDocument(current);
			if (doc === undefined) {
				continue;
			}

			result.push(doc);

			for (const imported of doc.imports) {
				if (!imported.dynamic && !imported.css) {
					queue.push(imported.filepath);
				}
			}

			for (const use of doc.uses) {
				if (!use.wildcard) {
					continue;
				}

				const resolved = this.resolveEdgeTarget(current, use);
				if (resolved !== undefined) {
					queue.push(resolved);
				}
			}
		}

		return result;
	}

	/**
	 * Resolves `namespace` as used from `entryPath` to the document it refers
	 * to, per that entry document's own `@use '...' as <namespace>` edge.
	 * Returns `undefined` if there's no such edge, or it didn't resolve to a
	 * file on disk.
	 */
	public resolveNamespace(entryPath: string, namespace: string): string | undefined {
		const entry = this.getDocument(entryPath);
		if (entry === undefined) {
			return undefined;
		}

		const use = entry.uses.find(candidate => !candidate.wildcard && candidate.namespace === namespace);
		if (use === undefined) {
			return undefined;
		}

		return this.resolveEdgeTarget(entryPath, use);
	}
}
