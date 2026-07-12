'use strict';

export interface ISettings {
	// Scanner
	scannerDepth: number;
	scannerExclude: string[];
	/**
	 * Whether the initial workspace scan eagerly follows `@import`/`@use`/
	 * `@forward` edges to warm the cache with files the `**\/*.scss` glob
	 * might have missed (e.g. reached only via `~`/`includePaths`). Does NOT
	 * control in-scope-ness for completion/hover/goto-def — that's decided
	 * at query time by the import graph, from whatever's already scanned.
	 */
	scanImportedFiles: boolean;

	// Display
	showErrors: boolean;

	// Suggestions
	suggestVariables: boolean;
	suggestMixins: boolean;
	suggestFunctions: boolean;
	suggestFunctionsInStringContextAfterSymbols: string;

	// Angular
	angular: {
		/**
		 * Extra directories (workspace-relative or absolute) to search for
		 * bare-specifier `@use`/`@import`/`@forward` targets, concatenated
		 * after `angular.json`'s own `stylePreprocessorOptions.includePaths`
		 * for the owning project. Entries resolving outside the current
		 * VS Code workspace root are ignored.
		 */
		includePaths: string[];
	};

	// Custom properties (--x)
	customProperties: {
		/**
		 * `workspace`: any `--x` declared anywhere in the workspace is
		 * suggested/resolved everywhere (matches real CSS cascade behavior).
		 * `root-selectors`: only `--x` declared inside a `:root`/`html`/`body`
		 * selector counts as global; component-local `--x` declarations are
		 * excluded from other files' suggestions.
		 */
		scope: 'workspace' | 'root-selectors';
	};
}
