'use strict';

import type { IVariable } from '../types/symbols.js';
import type { ISettings } from '../types/settings.js';
import type StorageService from '../services/storage.js';
import { getCustomPropertyCandidates, type ICustomPropertyCandidate } from './customProperties.js';
import { normalizeColor } from './colorLiteral.js';

/**
 * Applied per candidate kind (variables, custom properties) by callers via
 * `takeCandidates` — bounds both memory and the Quick Fix list size for a
 * workspace with many identical hardcoded colors.
 */
export const MAX_COLOR_CANDIDATES = 25;

export interface IColorVariableCandidate {
	fsPath: string;
	variable: IVariable;
}

/**
 * Workspace-wide (deliberately not import-graph-scoped — the point is to
 * surface variables that aren't in scope yet) scan for `$variables` whose
 * value normalizes to `colorKey`. A generator, not an array-builder:
 * `storage` already holds every parsed document in memory (same as
 * `getCustomPropertyCandidates` below), so this walks it directly rather
 * than materializing an intermediate "all variables" array first — only
 * matches are ever collected, and callers cap consumption via
 * `takeCandidates`. Skips the declaration at
 * `(excludeFsPath, excludeOffset)` so a literal inside `$x: #fff;` itself
 * never offers "replace with $x".
 */
export function* iterateColorVariableCandidates(
	storage: StorageService,
	colorKey: string,
	excludeFsPath?: string,
	excludeOffset?: number
): Generator<IColorVariableCandidate> {
	for (const doc of storage.values()) {
		if (doc.filepath === undefined) {
			continue;
		}

		for (const variable of doc.variables) {
			if (doc.filepath === excludeFsPath && variable.offset === excludeOffset) {
				continue;
			}

			if (normalizeColor(variable.value || '') === colorKey) {
				yield { fsPath: doc.filepath, variable };
			}
		}
	}
}

/**
 * Same idea for CSS custom properties, sourced from the existing
 * `getCustomPropertyCandidates` (already workspace/root-selectors
 * scope-aware per `scss.customProperties.scope`) rather than re-walking
 * `storage` a second, differently-shaped way.
 */
export function* iterateColorCustomPropertyCandidates(
	storage: StorageService,
	settings: ISettings,
	colorKey: string,
	excludeFsPath?: string,
	excludeOffset?: number
): Generator<ICustomPropertyCandidate> {
	for (const candidate of getCustomPropertyCandidates(storage, settings)) {
		if (candidate.fsPath === excludeFsPath && candidate.property.offset === excludeOffset) {
			continue;
		}

		if (normalizeColor(candidate.property.value || '') === colorKey) {
			yield candidate;
		}
	}
}

export function takeCandidates<T>(iterable: Iterable<T>, max: number = MAX_COLOR_CANDIDATES): T[] {
	const result: T[] = [];

	for (const item of iterable) {
		if (result.length >= max) {
			break;
		}

		result.push(item);
	}

	return result;
}
