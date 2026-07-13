import { getDocUri, showFile, position, sleep } from '../util.js';
import { testHover } from './helper.js';

describe('SCSS Hover Test', () => {
	const docUri = getDocUri('hover/main.scss');

	before(async () => {
		await showFile(docUri);
		await sleep(2000);
	});

	it('shows hover for variables', async () => {
		await testHover(docUri, position(5, 13), {
			contents: ['```scss\n$variable: \'value\';\n@import "../_variables.scss"\n```']
		});
	});

	it('shows hover for functions', async () => {
		await testHover(docUri, position(5, 24), {
			contents: ['```scss\n@function function() {…}\n@import "../_functions.scss"\n```']
		});
	});

	it('shows hover for mixins', async () => {
		await testHover(docUri, position(7, 12), {
			contents: ['```scss\n@mixin mixin() {…}\n@import "../_mixins.scss"\n```']
		});
	});
});
