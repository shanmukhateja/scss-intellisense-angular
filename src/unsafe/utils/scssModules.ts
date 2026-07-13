'use strict';

import type { DocumentLink } from 'vscode-languageserver-types';
import type { TextDocument } from 'vscode-languageserver-textdocument';

import { INode, NodeType } from '../types/nodes.js';
import type { IFunction, IMixin, IResolvedForward, IResolvedUse, IVariable } from '../types/symbols.js';
import type ImportGraphService from '../services/importGraph.js';

const reAsWildcard = /^\s*as\s+\*/;
const reQuotes = /^['"]|['"]$/g;
const reTrailingHyphen = /-$/;

function stripQuotes(text: string): string {
	return text.replace(reQuotes, '');
}

/**
 * The path literal is always a `StringLiteral` child. Its position isn't fixed:
 * when an `as <name>` clause is present, the parser splices the identifier node
 * into `children[0]` (via `setNode(field, node, 0)`), pushing the path to index 1.
 * So look it up by type, not position.
 */
function getPathNode(node: INode): INode | undefined {
	return node.getChildren().find(child => child.type === NodeType.StringLiteral);
}

/**
 * Per Sass's default-namespace rule: the last path segment, without a leading
 * partial underscore or `.scss` extension.
 */
export function inferDefaultNamespace(targetRaw: string): string {
	const segment = targetRaw.split('/').pop() ?? targetRaw;

	return segment.replace(/^_/, '').replace(/\.scss$/i, '');
}

/**
 * Finds the resolved fs path for a node by matching its start position against
 * the document links already computed for this document (same AST pass, so the
 * link for a given `@use`/`@forward` path literal has the same start position).
 */
function findResolvedPath(document: TextDocument, links: DocumentLink[], pathNode: INode): string | undefined {
	const start = document.positionAt(pathNode.offset);

	const match = links.find(link =>
		link.range.start.line === start.line && link.range.start.character === start.character
	);

	return match?.target;
}

export function collectUseForwardNodes(
	document: TextDocument,
	ast: INode,
	links: DocumentLink[]
): { uses: IResolvedUse[]; forwards: IResolvedForward[]; consumedLinkOffsets: Set<number> } {
	const uses: IResolvedUse[] = [];
	const forwards: IResolvedForward[] = [];
	// Offsets of `@use`/`@forward` path nodes that were matched against a
	// document link — `parser.ts` excludes these from `imports`, since
	// `findDocumentLinks2` returns a link for every `@use`/`@forward`/`@import`
	// target alike, and only `@import` should feed bare-name reachability
	// (`ImportGraphService.getReachableDocuments`).
	const consumedLinkOffsets = new Set<number>();

	ast.accept(node => {
		if (node.type === NodeType.Use) {
			const pathNode = getPathNode(node);
			if (pathNode === undefined) {
				return true;
			}

			consumedLinkOffsets.add(pathNode.offset);

			const targetRaw = stripQuotes(pathNode.getText());
			const identifier = node.getIdentifier();
			const wildcard = identifier === undefined || identifier === null
				? reAsWildcard.test(document.getText().slice(pathNode.end, node.end))
				: false;

			uses.push({
				namespace: identifier ? identifier.getText() : inferDefaultNamespace(targetRaw),
				wildcard,
				resolvedPath: findResolvedPath(document, links, pathNode),
				targetRaw
			});
		} else if (node.type === NodeType.Forward) {
			const pathNode = getPathNode(node);
			if (pathNode === undefined) {
				return true;
			}

			consumedLinkOffsets.add(pathNode.offset);

			const targetRaw = stripQuotes(pathNode.getText());
			const identifier = node.getIdentifier();

			let show: string[] | null = null;
			let hide: string[] | null = null;

			const visibilityNode = node.getChildren().find(child => child.type === NodeType.ForwardVisibility);
			if (visibilityNode) {
				const visibilityIdentifier = visibilityNode.getIdentifier();
				const kind = visibilityIdentifier?.getText();
				// The `show`/`hide` keyword identifier is itself spliced into this
				// node's own children (same `setNode(field, node, 0)` quirk as
				// above), so exclude it by reference to get just the member list.
				const members = visibilityNode.getChildren()
					.filter(child => child !== visibilityIdentifier)
					.map(child => child.getText());

				if (kind === 'show') {
					show = members;
				} else if (kind === 'hide') {
					hide = members;
				}
			}

			forwards.push({
				// `as <prefix>-*` tokenizes the prefix with its trailing hyphen
				// attached (e.g. "btn-"); the `*` itself is consumed separately
				// and never appears in the identifier text.
				prefix: identifier ? identifier.getText().replace(reTrailingHyphen, '') : null,
				show,
				hide,
				resolvedPath: findResolvedPath(document, links, pathNode),
				targetRaw
			});
		}

		return true;
	});

	return { uses, forwards, consumedLinkOffsets };
}

export type ModuleMemberType = 'variables' | 'mixins' | 'functions';

export interface IModuleAccess {
	namespace: string;
	memberType: ModuleMemberType;
	memberName: string;
}

/**
 * Detects whether an AST node under the cursor is a `namespace.member` access
 * and, if so, extracts the namespace and member. The parser represents this
 * three different ways depending on context (all confirmed empirically, not
 * just read from source — the exact child/parent shape is easy to get wrong):
 *
 * - Variable (`ns.$x`, in an expression): `node.type === VariableName`, whose
 *   direct parent is a `Module` node (`Module.getIdentifier()` = namespace).
 * - Function (`ns.fn()`, in an expression): `node.type === Identifier`, whose
 *   parent is a `Function` node, whose OWN parent is the `Module` node.
 * - Mixin (`@include ns.mixin()`): `node.type === Identifier`, whose parent is
 *   a `MixinReference` — but here `Module` is a nested CHILD of the
 *   `MixinReference` (holding just the namespace), not an ancestor of `node`.
 */
export function detectModuleAccess(node: INode): IModuleAccess | null {
	if (node.type === NodeType.VariableName) {
		const parent = node.getParent();
		if (parent.type === NodeType.Module) {
			return { namespace: parent.getIdentifier().getText(), memberType: 'variables', memberName: node.getName() };
		}

		return null;
	}

	if (node.type === NodeType.Identifier) {
		const parent = node.getParent();

		if (parent.type === NodeType.Function) {
			const grandparent = parent.getParent();
			if (grandparent.type === NodeType.Module) {
				return { namespace: grandparent.getIdentifier().getText(), memberType: 'functions', memberName: parent.getName() };
			}

			return null;
		}

		if (parent.type === NodeType.MixinReference) {
			const moduleChild = parent.getChildren().find(child => child.type === NodeType.Module);
			if (moduleChild !== undefined) {
				return { namespace: moduleChild.getIdentifier().getText(), memberType: 'mixins', memberName: parent.getName() };
			}

			return null;
		}
	}

	return null;
}

const MAX_FORWARD_DEPTH = 10;

/**
 * `@forward '...' as <prefix>-*` exposes a member under a consumer-facing
 * name with `prefix` inserted. For variables the prefix goes right after the
 * `$` sigil (`$x` forwarded as `list-*` becomes `$list-x`, not `list-$x`);
 * for mixins/functions it's a plain string prefix. Given the consumer-typed
 * name, returns the original (un-prefixed) name declared in the forwarded
 * file, or `null` if `memberName` doesn't actually carry this prefix.
 */
function stripForwardPrefix(memberName: string, prefix: string): string | null {
	if (memberName.startsWith('$')) {
		const rest = memberName.slice(1);

		return rest.startsWith(prefix) ? `$${rest.slice(prefix.length)}` : null;
	}

	return memberName.startsWith(prefix) ? memberName.slice(prefix.length) : null;
}

export interface IResolvedModuleSymbol {
	symbol: IVariable | IMixin | IFunction;
	documentPath: string;
}

function resolveMemberInDocument(
	graph: ImportGraphService,
	documentPath: string,
	memberName: string,
	memberType: ModuleMemberType,
	visited: Set<string>,
	depth: number
): IResolvedModuleSymbol | null {
	if (depth > MAX_FORWARD_DEPTH || visited.has(documentPath)) {
		return null;
	}

	visited.add(documentPath);

	const doc = graph.getDocument(documentPath);
	if (doc === undefined) {
		return null;
	}

	const direct = doc[memberType].find(item => item.name === memberName);
	if (direct !== undefined) {
		return { symbol: direct, documentPath };
	}

	// Not declared directly — this document might re-export it via @forward.
	for (const forward of doc.forwards) {
		const resolvedPath = graph.resolveEdgeTarget(documentPath, forward);
		if (resolvedPath === undefined) {
			continue;
		}

		let localName = memberName;
		if (forward.prefix !== null) {
			const stripped = stripForwardPrefix(memberName, forward.prefix);
			if (stripped === null) {
				continue;
			}

			localName = stripped;
		}

		if (forward.hide !== null && forward.hide.includes(localName)) {
			continue;
		}

		if (forward.show !== null && !forward.show.includes(localName)) {
			continue;
		}

		const result = resolveMemberInDocument(graph, resolvedPath, localName, memberType, visited, depth + 1);
		if (result !== null) {
			return result;
		}
	}

	return null;
}

/**
 * Resolves a `namespace.memberName` access as seen from `entryPath`: follows
 * that entry document's own `@use ... as <namespace>` edge to a target
 * document, then looks up `memberName` there — recursing into `@forward`
 * re-exports (with prefix/show/hide handling) if it's not declared directly.
 */
export function resolveNamespacedSymbol(
	graph: ImportGraphService,
	entryPath: string,
	namespace: string,
	memberName: string,
	memberType: ModuleMemberType
): IResolvedModuleSymbol | null {
	const targetPath = graph.resolveNamespace(entryPath, namespace);
	if (targetPath === undefined) {
		return null;
	}

	return resolveMemberInDocument(graph, targetPath, memberName, memberType, new Set(), 0);
}

/**
 * `applyForwardPrefix('$x', 'list-')` → `'$list-x'` (prefix goes after the
 * `$` sigil); `applyForwardPrefix('remove', 'list-')` → `'list-remove'`.
 * Mirrors `stripForwardPrefix`'s rule in reverse.
 */
function applyForwardPrefix(name: string, prefix: string): string {
	if (name.startsWith('$')) {
		return `$${prefix}${name.slice(1)}`;
	}

	return `${prefix}${name}`;
}

function collectMembersInDocument(
	graph: ImportGraphService,
	documentPath: string,
	memberType: ModuleMemberType,
	visited: Set<string>,
	depth: number,
	inheritedPrefix: string,
	show: string[] | null,
	hide: string[] | null
): IResolvedModuleSymbol[] {
	if (depth > MAX_FORWARD_DEPTH || visited.has(documentPath)) {
		return [];
	}

	visited.add(documentPath);

	const doc = graph.getDocument(documentPath);
	if (doc === undefined) {
		return [];
	}

	const result: IResolvedModuleSymbol[] = [];

	for (const item of doc[memberType]) {
		if (hide !== null && hide.includes(item.name)) {
			continue;
		}

		if (show !== null && !show.includes(item.name)) {
			continue;
		}

		const publicName = inheritedPrefix === '' ? item.name : applyForwardPrefix(item.name, inheritedPrefix);
		result.push({ symbol: { ...item, name: publicName }, documentPath });
	}

	for (const forward of doc.forwards) {
		const resolvedPath = graph.resolveEdgeTarget(documentPath, forward);
		if (resolvedPath === undefined) {
			continue;
		}

		const combinedPrefix = inheritedPrefix + (forward.prefix ?? '');
		result.push(...collectMembersInDocument(graph, resolvedPath, memberType, visited, depth + 1, combinedPrefix, forward.show, forward.hide));
	}

	return result;
}

/**
 * Lists every member of `memberType` visible through `namespace` as used from
 * `entryPath` — the `@use` target's own declarations plus everything it
 * re-exports via `@forward` (recursively, with prefix/show/hide applied at
 * each hop). Used for `ns.`-triggered completion, where (unlike hover/
 * goto-def) the exact member name isn't known yet.
 */
export function resolveNamespaceMembers(
	graph: ImportGraphService,
	entryPath: string,
	namespace: string,
	memberType: ModuleMemberType
): IResolvedModuleSymbol[] {
	const targetPath = graph.resolveNamespace(entryPath, namespace);
	if (targetPath === undefined) {
		return [];
	}

	return collectMembersInDocument(graph, targetPath, memberType, new Set(), 0, '', null, null);
}
