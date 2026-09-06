import { getDocUri, showFile, position, sleep, sameLineLocation } from '../util.js';
import { testHover } from '../hover/helper.js';
import { testDefinition } from '../definition/helper.js';
import { testCodeActionTitles, testNoCodeActionTitleEndingWith } from '../codeAction/helper.js';

describe('SCSS inside an Angular component inline `styles`', () => {
	const docUri = getDocUri('angular-app/src/app/inline.component.ts');

	before(async () => {
		await showFile(docUri);
		await sleep(2000);
	});

	it('hovers a var(--x) reference inside the template literal', async () => {
		await testHover(docUri, position(10, 30), {
			contents: ['```scss\n--inline-accent: #123456;\n```']
		});
	});

	it('goes to the custom property definition declared in the same inline styles', async () => {
		await testDefinition(docUri, position(10, 30), sameLineLocation(docUri, 8, 9, 24));
	});

	it('offers a var(--x) quick fix for a hardcoded color matching a custom property', async () => {
		await testCodeActionTitles(docUri, position(9, 17), ['Replace with var(--inline-accent) (current)']);
	});

	it('never offers an "adds @use" quick fix (a .ts file cannot carry an @use prefix)', async () => {
		await testNoCodeActionTitleEndingWith(docUri, position(9, 17), '(adds @use)');
	});
});
