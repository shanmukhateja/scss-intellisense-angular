import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Prints the markers the `esbuild watch` task's problem matcher looks for,
 * plus readable diagnostics, so an F5 rebuild surfaces errors in the editor.
 *
 * @type {import('esbuild').Plugin}
 */
const watchLogPlugin = {
	name: 'watch-log',
	setup(build) {
		build.onStart(() => console.log('[watch] build started'));
		build.onEnd((result) => {
			for (const { text, location } of result.errors) {
				console.error(`✘ [ERROR] ${text}`);
				if (location !== null) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				}
			}

			console.log('[watch] build finished');
		});
	},
};

/**
 * The extension ships two Node entry points: the client that VS Code loads
 * (`main`) and the language server it spawns as a child module. Each is bundled
 * on its own so the server keeps its `./unsafe/server.js` path relative to the
 * client.
 *
 * @type {import('esbuild').BuildOptions}
 */
const shared = {
	bundle: true,
	format: 'esm',
	platform: 'node',
	target: 'es2022',
	// Not bundled:
	//  - vscode: injected by the extension host.
	//  - vscode-css-languageservice: its default (UMD) build lazy-loads parsers
	//    with `require('./parser/*')` calls esbuild can't statically follow, and
	//    its ESM build has no default export (which the source relies on for the
	//    fully-populated module object). Shipped as a runtime dependency instead.
	// Everything else, including @babel/parser, is bundled and tree-shaken in.
	external: ['vscode', 'vscode-css-languageservice'],
	sourcemap: !production,
	minify: production,
	logLevel: production ? 'info' : 'silent',
	plugins: watch ? [watchLogPlugin] : [],
	// The output is ESM (the package is `"type": "module"`), but several bundled
	// deps (vscode-languageserver / vscode-jsonrpc) call `require('node:*')` at
	// load time. Give them a real CJS `require` instead of esbuild's shim, which
	// throws on any dynamic require.
	banner: {
		js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
	},
};

/** @type {import('esbuild').BuildOptions[]} */
const targets = [
	{ entryPoints: ['src/client.ts'], outfile: 'dist/client.js' },
	{ entryPoints: ['src/unsafe/server.ts'], outfile: 'dist/unsafe/server.js' },
];

if (watch) {
	const contexts = await Promise.all(targets.map((target) => esbuild.context({ ...shared, ...target })));
	await Promise.all(contexts.map((context) => context.watch()));
	console.log('[watch] watching for changes…');
} else {
	await Promise.all(targets.map((target) => esbuild.build({ ...shared, ...target })));
}
