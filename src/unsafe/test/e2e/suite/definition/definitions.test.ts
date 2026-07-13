import { getDocUri, showFile, position, sleep, sameLineLocation } from '../util.js';
import { testDefinition } from './helper.js';

describe('SCSS Definition Test', () => {
	const docUri = getDocUri('definition/main.scss');

	before(async () => {
		await showFile(docUri);
		await sleep(2000);
	});

	it('should find definition for variables', async () => {
		const expectedDocumentUri = getDocUri('_variables.scss');
		const expectedLocation = sameLineLocation(expectedDocumentUri, 1, 1, 10);

		await testDefinition(docUri, position(5, 13), expectedLocation);
	});

	it('should find definition for functions', async () => {
		const expectedDocumentUri = getDocUri('_functions.scss');
		const expectedLocation = sameLineLocation(expectedDocumentUri, 1, 1, 9);

		await testDefinition(docUri, position(5, 24), expectedLocation);
	});

	it('should find definition for mixins', async () => {
		const expectedDocumentUri = getDocUri('_mixins.scss');
		const expectedLocation = sameLineLocation(expectedDocumentUri, 1, 1, 6);

		await testDefinition(docUri, position(7, 12), expectedLocation);
	});
});
