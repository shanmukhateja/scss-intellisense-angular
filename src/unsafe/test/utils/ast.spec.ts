'use strict';

import * as assert from 'assert';

import { NodeType } from '../../types/nodes.js';
import {
	getNodeAtOffset,
	getParentNodeByType
} from '../../utils/ast.js';
import * as helpers from '../helpers.js';

describe('Utils/Ast', () => {
	it('getNodeAtOffset', () => {
		const ast = helpers.makeAst([
			'.a {}'
		]);

		const node = getNodeAtOffset(ast, 4);

		assert.strictEqual(node?.type, NodeType.Declarations);
		assert.strictEqual(node?.getText(), '{}');
	});

	it('getParentNodeByType', () => {
		const ast = helpers.makeAst([
			'.a {}'
		]);

		const node = getNodeAtOffset(ast, 4);
		const parentNode = getParentNodeByType(node, NodeType.Ruleset);

		assert.strictEqual(parentNode?.type, NodeType.Ruleset);
		assert.strictEqual(parentNode?.getText(), '.a {}');
	});
});
