import { getDocUri, showFile, position, sleep, sameLineLocation } from '../util.js';
import { testCompletion } from '../completion/helper.js';
import { testDefinition } from '../definition/helper.js';

describe('SCSS Angular includePaths Test', () => {
	const docUri = getDocUri('angular-app/src/main.scss');

	before(async () => {
		await showFile(docUri);
		await sleep(2000);
	});

	it('resolves a bare @use specifier through angular.json stylePreprocessorOptions.includePaths', async () => {
		await testCompletion(docUri, position(12, 17), ['$spacing-unit']);
	});

	it('finds the definition of a namespaced variable resolved via includePaths', async () => {
		const expectedDocumentUri = getDocUri('angular-app/styles/_tokens.scss');
		const expectedLocation = sameLineLocation(expectedDocumentUri, 1, 1, 14);

		await testDefinition(docUri, position(4, 21), expectedLocation);
	});

	it('finds the definition of a namespaced mixin resolved via includePaths', async () => {
		const expectedDocumentUri = getDocUri('angular-app/styles/_tokens.scss');
		const expectedLocation = sameLineLocation(expectedDocumentUri, 3, 8, 19);

		await testDefinition(docUri, position(8, 21), expectedLocation);
	});
});
