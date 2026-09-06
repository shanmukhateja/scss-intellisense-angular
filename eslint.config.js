import * as cfg from 'eslint-config-mrmlnc';

export default [
	...cfg.build({}),
	{
		rules: {
			// esbuild bundles every dependency into dist/; nothing but `vscode` is
			// resolved from node_modules at runtime, so the npm-library notion of a
			// "published" import (dependencies vs devDependencies) does not apply.
			'n/no-unpublished-import': 'off'
		}
	},
	{
		ignores: [
			'out/**',
			'src/unsafe/**'
		]
	}
];
