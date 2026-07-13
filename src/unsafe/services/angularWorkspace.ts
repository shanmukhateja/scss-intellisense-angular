'use strict';

import * as path from 'path';

import type { ISettings } from '../types/settings.js';
import { findFiles, readFile, isPathWithinRoot } from '../utils/fs.js';

export interface IAngularProject {
	name: string;
	/**
	 * Absolute fs path to the project's root directory.
	 */
	root: string;
	/**
	 * Absolute fs paths from `stylePreprocessorOptions.includePaths`,
	 * already containment-checked against the workspace root.
	 */
	includePaths: string[];
}

interface IAngularJsonProject {
	root?: string;
	architect?: {
		build?: {
			options?: {
				stylePreprocessorOptions?: {
					includePaths?: string[];
				};
			};
		};
	};
}

interface IAngularJson {
	projects?: Record<string, IAngularJsonProject>;
}

/**
 * Finds and parses `angular.json` for a workspace folder, exposing each
 * project's root directory and `stylePreprocessorOptions.includePaths` for
 * import resolution (see `ImportGraphService`'s includePaths fallback pass).
 *
 * This does NOT drive any "always visible" symbol injection — `angular.json`'s
 * `styles` array (global CSS bundling) is deliberately not consumed here; it
 * has no bearing on which Sass `$variables`/`@mixin`s are compile-visible in
 * a given file (see the plan's "Important correction" note).
 */
export default class AngularWorkspaceService {
	private projects: IAngularProject[] = [];
	private found = false;

	constructor(private readonly workspaceRoot: string, private readonly settings: ISettings) {}

	/**
	 * Whether `angular.json` was found on the last `load()`/`reload()`.
	 */
	public wasFound(): boolean {
		return this.found;
	}

	public async load(): Promise<void> {
		const files = await findFiles('angular.json', { cwd: this.workspaceRoot, deep: 1 });
		const angularJsonPath = files[0];

		if (angularJsonPath === undefined) {
			this.found = false;
			this.projects = [];
			console.log('[AngularWorkspaceService] angular.json not found in workspace root; Angular-specific includePaths resolution will be unavailable.');

			return;
		}

		let parsed: IAngularJson;
		try {
			parsed = JSON.parse(await readFile(angularJsonPath)) as IAngularJson;
		} catch (error) {
			this.found = false;
			this.projects = [];
			console.log(`[AngularWorkspaceService] failed to parse angular.json: ${(error as Error).message}`);

			return;
		}

		this.found = true;
		this.projects = Object.entries(parsed.projects ?? {}).map(([name, project]) => {
			const root = path.resolve(this.workspaceRoot, project.root ?? '');
			const rawIncludePaths = project.architect?.build?.options?.stylePreprocessorOptions?.includePaths ?? [];

			const includePaths = rawIncludePaths
				.map(includePath => path.resolve(this.workspaceRoot, includePath))
				.filter(resolved => isPathWithinRoot(this.workspaceRoot, resolved));

			return { name, root, includePaths };
		});
	}

	public async reload(): Promise<void> {
		return this.load();
	}

	private getOwningProject(documentPath: string): IAngularProject | undefined {
		let owner: IAngularProject | undefined;

		for (const project of this.projects) {
			const isWithinProject = documentPath === project.root || documentPath.startsWith(project.root + path.sep);

			if (isWithinProject && (owner === undefined || project.root.length > owner.root.length)) {
				owner = project;
			}
		}

		return owner;
	}

	/**
	 * `angular.json`'s `stylePreprocessorOptions.includePaths` for the
	 * project owning `documentPath` (longest-prefix match on project root),
	 * plus the user-configured `scss.angular.includePaths` setting. Falls
	 * back to the union of every project's `angular.json` include paths if
	 * no project claims `documentPath` (e.g. a shared lib file outside any
	 * project root).
	 */
	public getIncludePaths(documentPath: string): string[] {
		const owner = this.getOwningProject(documentPath);
		const fromAngularJson = owner !== undefined
			? owner.includePaths
			: this.projects.flatMap(project => project.includePaths);

		const fromSettings = this.settings.angular.includePaths
			.map(includePath => path.resolve(this.workspaceRoot, includePath))
			.filter(resolved => isPathWithinRoot(this.workspaceRoot, resolved));

		return [...fromAngularJson, ...fromSettings];
	}
}
