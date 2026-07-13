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
	 * Resolves a `@use`/`@forward` edge to an fs path. Uses the path already
	 * resolved by `vscode-css-languageservice` at parse time (relative/`~`/
	 * underscore-partial resolution) if available. Otherwise — a bare
	 * specifier with no relative/`~` prefix that the standard resolver
	 * couldn't place — falls back to probing each of `fromDocumentPath`'s
	 * Angular include paths (`angular.json`'s `stylePreprocessorOptions
	 * .includePaths` plus `scss.angular.includePaths`), mirroring Sass's own
	 * load-path search order: declared order, first match wins.
	 *
	 * `@import` edges aren't covered here (`IImport` only carries an
	 * already-resolved `filepath`, no raw target to retry) — acceptable since
	 * `@import` is the legacy construct this fork isn't optimizing for.
	 */
	public resolveEdgeTarget(fromDocumentPath: string, edge: IResolvedUse | IResolvedForward): string | undefined {
		if (edge.resolvedPath !== undefined) {
			return edge.resolvedPath;
		}

		if (this.angularWorkspace === undefined) {
			return undefined;
		}

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

		return undefined;
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
