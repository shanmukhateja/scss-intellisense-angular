'use strict';

import fs from 'fs';
import * as path from 'path';

import fg from 'fast-glob';

/**
 * True if `candidate` is `root` itself, or a path underneath it. Used to make
 * sure user-configured include paths can't be used to read files from
 * arbitrary filesystem locations outside the opened workspace.
 */
export function isPathWithinRoot(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);

	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function findFiles(pattern: string, options: fg.Options): Promise<string[]> {
	return fg(pattern, {
		...options,
		absolute: true,
		dot: true,
		suppressErrors: true
	});
}

export function fileExists(filepath: string): Promise<boolean> {
	return new Promise(resolve => {
		fs.access(filepath, fs.constants.F_OK, error => {
			return resolve(error === null);
		});
	});
}

export function fileExistsSync(filepath: string): boolean {
	return fs.existsSync(filepath);
}

/**
 * True if `filepath` has a `node_modules` path segment (works for both `/`
 * and `\` separators, so it's safe to call with un-normalized paths). Used
 * to rank vendored symbols (e.g. reached via a `~foo/bar` tilde import)
 * below the current project's own symbols in completion, rather than mixed
 * in alphabetically.
 */
export function isNodeModulesPath(filepath: string): boolean {
	return filepath.replace(/\\/g, '/').split('/').includes('node_modules');
}

/**
 * Read file by specified filepath;
 */
export function readFile(filepath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		fs.readFile(filepath, (err, data) => {
			if (err) {
				return reject(err);
			}

			resolve(data.toString());
		});
	});
}

/**
 * Read file by specified filepath;
 */
export function statFile(filepath: string): Promise<fs.Stats> {
	return new Promise((resolve, reject) => {
		fs.stat(filepath, (err, stat) => {
			if (err) {
				return reject(err);
			}

			resolve(stat);
		});
	});
}
