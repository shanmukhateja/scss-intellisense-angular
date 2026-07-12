'use strict';

import type { Position } from 'vscode-languageserver-textdocument';
import type { INode } from './nodes.js';

export interface IVariable {
	position?: Position;
	mixin?: string;
    name: string;
    value: string | null;
    offset: number;
}

export interface IMixin {
	position?: Position;
	name: string;
    parameters: IVariable[];
    offset: number;
}

export type IFunction = IMixin;

export interface IImport {
	reference?: boolean;
	filepath: string;
    dynamic: boolean;
    css: boolean;
}

export interface IResolvedUse {
	/**
	 * The namespace this `@use` is accessed by (explicit `as <name>`, or inferred from the path).
	 */
	namespace: string;
	/**
	 * True for `@use '...' as *` (members become available unqualified/global-visibility).
	 */
	wildcard: boolean;
	/**
	 * Absolute fs path the target resolved to, if resolution succeeded.
	 */
	resolvedPath?: string;
	/**
	 * The raw, unresolved path string as written in the source (quotes stripped).
	 */
	targetRaw: string;
}

export interface IResolvedForward {
	/**
	 * The `as <prefix>-*` prefix, if present.
	 */
	prefix: string | null;
	/**
	 * Member names from `show a, b, ...`, if present.
	 */
	show: string[] | null;
	/**
	 * Member names from `hide a, b, ...`, if present.
	 */
	hide: string[] | null;
	resolvedPath?: string;
	targetRaw: string;
}

export interface ICustomProperty {
	/**
	 * Includes the leading `--`.
	 */
	name: string;
	value: string | null;
	offset: number;
	position: Position;
	/**
	 * True if declared inside a `:root`/`html`/`body` selector — see
	 * `scss.customProperties.scope`.
	 */
	isRootScope: boolean;
}

export interface IDocumentSymbols extends ISymbols {
	/**
	 * The imported path in the document.
	 */
	document?: string;
	/**
	 * The real path to the file on the file system.
	 */
	filepath?: string;
	/**
	 * `@use` edges out of this document. Graph metadata, not a lookup-by-name
	 * symbol collection, so kept off `ISymbols` (which providers generically
	 * index via `keyof ISymbols` for name/position-shaped symbols).
	 */
	uses: IResolvedUse[];
	/**
	 * `@forward` edges out of this document. See `uses` above.
	 */
	forwards: IResolvedForward[];
	/**
	 * CSS custom property (`--x`) declarations in this document. A distinct
	 * symbol kind from `variables` ($x) — see `ICustomProperty`.
	 */
	customProperties: ICustomProperty[];
}

export interface ISymbols {
	variables: IVariable[];
	mixins: IMixin[];
	functions: IFunction[];
	imports: IImport[];
}

export interface IDocument {
	node: INode | null;
	symbols: IDocumentSymbols;
}
