'use strict';

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import AngularWorkspaceService from '../../services/angularWorkspace.js';
import * as helpers from '../helpers.js';

function makeWorkspace(angularJson: unknown): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-scss-angular-'));

	if (angularJson !== undefined) {
		fs.writeFileSync(path.join(root, 'angular.json'), JSON.stringify(angularJson));
	}

	fs.mkdirSync(path.join(root, 'apps', 'app-one', 'src'), { recursive: true });
	fs.mkdirSync(path.join(root, 'apps', 'app-two', 'src'), { recursive: true });
	fs.mkdirSync(path.join(root, 'libs', 'shared-styles'), { recursive: true });

	return root;
}

describe('Services/AngularWorkspace', () => {
	it('reports not found when there is no angular.json', async () => {
		const root = makeWorkspace(undefined);
		const service = new AngularWorkspaceService(root, helpers.makeSettings());

		await service.load();

		assert.strictEqual(service.wasFound(), false);
		assert.deepStrictEqual(service.getIncludePaths(path.join(root, 'apps/app-one/src/component.scss')), []);
	});

	it('reads includePaths for the owning project (longest-prefix match)', async () => {
		const root = makeWorkspace({
			projects: {
				'app-one': {
					root: 'apps/app-one',
					architect: { build: { options: { stylePreprocessorOptions: { includePaths: ['apps/app-one/src'] } } } }
				},
				'app-two': {
					root: 'apps/app-two',
					architect: { build: { options: { stylePreprocessorOptions: { includePaths: ['apps/app-two/src'] } } } }
				}
			}
		});
		const service = new AngularWorkspaceService(root, helpers.makeSettings());

		await service.load();

		assert.strictEqual(service.wasFound(), true);
		assert.deepStrictEqual(
			service.getIncludePaths(path.join(root, 'apps/app-one/src/component.scss')),
			[path.join(root, 'apps/app-one/src')]
		);
		assert.deepStrictEqual(
			service.getIncludePaths(path.join(root, 'apps/app-two/src/component.scss')),
			[path.join(root, 'apps/app-two/src')]
		);
	});

	it('falls back to the union of every project\'s includePaths for a file outside any project root', async () => {
		const root = makeWorkspace({
			projects: {
				'app-one': {
					root: 'apps/app-one',
					architect: { build: { options: { stylePreprocessorOptions: { includePaths: ['apps/app-one/src'] } } } }
				},
				'app-two': {
					root: 'apps/app-two',
					architect: { build: { options: { stylePreprocessorOptions: { includePaths: ['apps/app-two/src'] } } } }
				}
			}
		});
		const service = new AngularWorkspaceService(root, helpers.makeSettings());

		await service.load();

		const result = service.getIncludePaths(path.join(root, 'libs/shared-styles/tokens.scss'));

		assert.deepStrictEqual(result.sort(), [
			path.join(root, 'apps/app-one/src'),
			path.join(root, 'apps/app-two/src')
		].sort());
	});

	it('concatenates the scss.angular.includePaths setting after angular.json includePaths', async () => {
		const root = makeWorkspace({
			projects: {
				'app-one': {
					root: 'apps/app-one',
					architect: { build: { options: { stylePreprocessorOptions: { includePaths: ['apps/app-one/src'] } } } }
				}
			}
		});
		const service = new AngularWorkspaceService(root, helpers.makeSettings({
			angular: { includePaths: ['libs/shared-styles'] }
		}));

		await service.load();

		assert.deepStrictEqual(
			service.getIncludePaths(path.join(root, 'apps/app-one/src/component.scss')),
			[path.join(root, 'apps/app-one/src'), path.join(root, 'libs/shared-styles')]
		);
	});

	it('drops includePaths (from angular.json or settings) that resolve outside the workspace root', async () => {
		const root = makeWorkspace({
			projects: {
				'app-one': {
					root: 'apps/app-one',
					architect: { build: { options: { stylePreprocessorOptions: { includePaths: ['../../../etc'] } } } }
				}
			}
		});
		const service = new AngularWorkspaceService(root, helpers.makeSettings({
			angular: { includePaths: ['/etc'] }
		}));

		await service.load();

		assert.deepStrictEqual(service.getIncludePaths(path.join(root, 'apps/app-one/src/component.scss')), []);
	});

	it('reload() picks up a since-added angular.json', async () => {
		const root = makeWorkspace(undefined);
		const service = new AngularWorkspaceService(root, helpers.makeSettings());

		await service.load();
		assert.strictEqual(service.wasFound(), false);

		fs.writeFileSync(path.join(root, 'angular.json'), JSON.stringify({
			projects: {
				'app-one': {
					root: 'apps/app-one',
					architect: { build: { options: { stylePreprocessorOptions: { includePaths: ['apps/app-one/src'] } } } }
				}
			}
		}));

		await service.reload();

		assert.strictEqual(service.wasFound(), true);
		assert.deepStrictEqual(
			service.getIncludePaths(path.join(root, 'apps/app-one/src/component.scss')),
			[path.join(root, 'apps/app-one/src')]
		);
	});
});
