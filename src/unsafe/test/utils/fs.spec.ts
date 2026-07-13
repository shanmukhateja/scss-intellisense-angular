'use strict';

import * as assert from 'assert';

import { isNodeModulesPath } from '../../utils/fs.js';

describe('Utils/Fs', () => {
	describe('isNodeModulesPath', () => {
		it('detects a node_modules segment with posix separators', () => {
			assert.strictEqual(isNodeModulesPath('/proj/node_modules/foo/bar.scss'), true);
		});

		it('detects a node_modules segment with windows separators', () => {
			assert.strictEqual(isNodeModulesPath('C:\\proj\\node_modules\\foo\\bar.scss'), true);
		});

		it('returns false for a path with no node_modules segment', () => {
			assert.strictEqual(isNodeModulesPath('/proj/src/styles/_colors.scss'), false);
		});

		it('does not false-positive on a segment that merely starts with node_modules', () => {
			assert.strictEqual(isNodeModulesPath('/proj/node_modules_backup/foo.scss'), false);
		});
	});
});
