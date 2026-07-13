# scss-intellisense-angular

> SCSS IntelliSense (Variables, Mixins and Functions) for Angular projects.

## Install

Plugin installation is performed in several stages:

* Press <kbd>F1</kbd> and select `Extensions: Install Extensions`.
* Search and choose `scss-intellisense-angular`.

See the [extension installation guide](https://code.visualstudio.com/docs/editor/extension-gallery) for details.

## Usage

Just install the plugin and use it.

## Supported features

* Code Completion Proposals (variables, mixins, functions) — [description](http://code.visualstudio.com/docs/extensions/language-support#_show-code-completion-proposals)
* Hover (variables, mixins, functions) — [description](http://code.visualstudio.com/docs/extensions/language-support#_show-hovers)
* Signature Help (mixins, functions) — [description](http://code.visualstudio.com/docs/extensions/language-support#_help-with-function-and-method-signatures)
* Go to (variables, mixins, functions) — [description](http://code.visualstudio.com/docs/extensions/language-support#_show-definitions-of-a-symbol)
* Show all All Symbol Definitions in Folder (variables, mixin, functions) — [description](http://code.visualstudio.com/docs/extensions/language-support#_show-all-all-symbol-definitions-in-folder)
* Import files by `@import "filepath";` from anywhere. Even outside of the open workspace.
* Import-graph-scoped resolution: completion/hover/goto-def for a component's `.scss` file only see symbols from its own `@use`/`@import`/`@forward` chain — not every other component's local variables.
* Namespace-aware `@use ... as ns` / `@forward` support: `ns.$variable`, `ns.mixin-name()`, `ns.function-name()` resolve through the actual namespace (including through `@forward` re-export chains with `show`/`hide`/prefix), not by bare-name guessing.
* Angular `stylePreprocessorOptions.includePaths` (from `angular.json`, plus the `scss.angular.includePaths` setting) are used to resolve bare-specifier `@use`/`@import`/`@forward` targets — no more `../../../` relative-path spaghetti.
* CSS custom properties (`--x`) are treated as a separate, workspace-global symbol kind: `var(--primary)` gets completion, hover (with the declared value), and goto-def to the declaration, with zero `@use` required — matching how custom properties actually cascade at runtime.

## Supported settings

#### scss.scannerDepth

* Type: `number`
* Default: `30`

The maximum number of nested directories to scan.

#### scss.scannerExclude

* Type: `string[]`
* Default: `["**/.git", "**/node_modules", "**/bower_components"]`

List of glob patterns for directories that are excluded when scanning.

#### scss.scanImportedFiles

* Type: `boolean`
* Default: `true`

Eagerly follows `@import`/`@use`/`@forward` edges during the initial workspace scan, to warm the cache with files the `scannerDepth`/`scannerExclude`-bounded glob might have missed. Does not control which symbols are suggested for a given file — that's decided by its own `@use`/`@import` chain (plus `scss.customProperties.scope` for CSS custom properties).

#### scss.angular.includePaths

* Type: `string[]`
* Default: `[]`

Extra directories (workspace-relative or absolute) to search for bare-specifier `@use`/`@import`/`@forward` targets, concatenated after `angular.json`'s own `stylePreprocessorOptions.includePaths` for the owning project. Entries resolving outside the current workspace folder are ignored.

#### scss.customProperties.scope

* Type: `"workspace" | "root-selectors"`
* Default: `"workspace"`

Controls which CSS custom properties (`--x`) are suggested/resolved across files. `"workspace"` (default): any `--x` declared anywhere is available everywhere, matching real CSS cascade behavior. `"root-selectors"`: only `--x` declared inside a `:root`/`html`/`body` selector counts as global; component-local declarations (e.g. `.btn { --local: 2px }`) are excluded from other files' suggestions.

#### scss.showErrors

* Type: `boolean`
* Default: `false`

Allows to display errors.

#### scss.suggestVariables

* Type: `boolean`
* Default: `true`

Allows prompt Variables.

#### scss.suggestMixins

* Type: `boolean`
* Default: `true`

Allows prompt Mixins.

#### scss.suggestFunctions

* Type: `boolean`
* Default: `true`

Allows prompt Functions.

#### scss.suggestFunctionsInStringContextAfterSymbols

* Type: `boolean`
* Default: ` (+-*%`

Allows prompt Functions in String context after specified symbols. For example, if you add the `/` symbol, then `background: url(images/he|)` will be suggest `hello()` function if it is defined.

#### scss.dev.serverPort

* Type: `number`
* Default: `-1`

Launches the SCSS IntelliSense server at a specific port for debugging and profiling.

## Questions

**I don't see suggestions in the SCSS files.**

You must perform several steps:

* Set `scss.showErrors` option in settings of Editor.
* Restart VS Code.
* Try to reproduce your problem.
* Open `Help -> Toggle Developer Tools` and copy errors.
* Create Issue on GitHub.

## Changelog

See the [Releases section of our GitHub project](https://github.com/shanmukhateja/scss-intellisense-angular/releases) for changelogs for each release version.

## License

This software is released under the terms of the MIT license.
