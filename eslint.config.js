import * as cfg from 'eslint-config-mrmlnc';

export default [
	...cfg.build({
		rules: {
			'import/no-unresolved': [
				'error',
				{
					ignore: ['vscode']
				}
			]
		}
	}),
	{
		ignores: [
			'out/**',
			'src/unsafe/**'
		]
	}
];
