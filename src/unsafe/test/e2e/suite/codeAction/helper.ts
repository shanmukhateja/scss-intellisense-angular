import * as assert from 'assert';

import * as vscode from 'vscode';
import { showFile } from '../util.js';

export async function testCodeActionTitles(
	docUri: vscode.Uri,
	position: vscode.Position,
	expectedTitles: string[]
) {
	await showFile(docUri);

	const result = (await vscode.commands.executeCommand(
		'vscode.executeCodeActionProvider',
		docUri,
		new vscode.Range(position, position)
	)) as (vscode.CodeAction | vscode.Command)[];

	const titles = result
		.filter((item): item is vscode.CodeAction => 'title' in item)
		.map(item => item.title);

	expectedTitles.forEach(title => {
		assert.ok(titles.includes(title), `Expected a code action titled "${title}", got: ${JSON.stringify(titles)}`);
	});
}
