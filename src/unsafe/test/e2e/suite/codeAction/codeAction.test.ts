import { getDocUri, showFile, position, sleep } from '../util.js';
import { testCodeActionTitles } from './helper.js';

describe('SCSS Code Action Test', () => {
	const docUri = getDocUri('codeAction/main.scss');

	before(async () => {
		await showFile(docUri);
		await sleep(2000);
	});

	it('Offers a $variable replacement for a matching same-file color literal', async () => {
		await testCodeActionTitles(docUri, position(3, 15), ['Replace with $brand (current)']);
	});

	it('Offers a var(--x) replacement for a matching custom property', async () => {
		await testCodeActionTitles(docUri, position(5, 15), ['Replace with var(--accent) (current)']);
	});

	it('Offers a whole-call replacement for var(--undeclared, #fallback)', async () => {
		await testCodeActionTitles(docUri, position(4, 20), ['Replace with var(--accent) (current)']);
	});
});
