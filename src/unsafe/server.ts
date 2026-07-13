'use strict';

import * as path from 'path';

import {
	createConnection,
	Connection,
	IPCMessageReader,
	IPCMessageWriter,
	TextDocuments,
	InitializeParams,
	InitializeResult,
	TextDocumentSyncKind
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

import type { ISettings } from './types/settings.js';

import ScannerService from './services/scanner.js';
import StorageService from './services/storage.js';
import ImportGraphService from './services/importGraph.js';
import AngularWorkspaceService from './services/angularWorkspace.js';

import { doCompletion } from './providers/completion.js';
import { doHover } from './providers/hover.js';
import { doSignatureHelp } from './providers/signatureHelp.js';
import { goDefinition } from './providers/goDefinition.js';
import { searchWorkspaceSymbol } from './providers/workspaceSymbol.js';
import { doCodeAction } from './providers/codeAction.js';
import { findFiles } from './utils/fs.js';

interface InitializationOption {
	workspace: string;
	settings: ISettings;
}

let workspaceRoot: string;
let settings: ISettings;
let storageService: StorageService;
let scannerService: ScannerService;
let angularWorkspaceService: AngularWorkspaceService;
let importGraphService: ImportGraphService;
let lastAngularJsonFound: boolean | undefined;

// Create a connection for the server
const connection: Connection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

console.log = connection.console.log.bind(connection.console);
console.error = connection.console.error.bind(connection.console);

// Create a simple text document manager. The text document manager
// _supports full document sync only
const documents = new TextDocuments(TextDocument);

// Make the text document manager listen on the connection
// _for open, change and close text document events
documents.listen(connection);

/**
 * Warns once per server session if `angular.json` isn't found (rather than
 * failing silently), and again only if the found/not-found state actually
 * flips (e.g. `angular.json` is added after the workspace was already open).
 */
function notifyAngularJsonStatus(): void {
	const found = angularWorkspaceService.wasFound();
	if (found === lastAngularJsonFound) {
		return;
	}

	lastAngularJsonFound = found;

	if (!found) {
		connection.window.showWarningMessage(
			'angular.json not found in workspace root — Angular-specific includePaths resolution will be unavailable.'
		);
	}
}

// After the server has started the client sends an initilize request. The server receives
// _in the passed params the rootPath of the workspace plus the client capabilites
connection.onInitialize(
	async (params: InitializeParams): Promise<InitializeResult> => {
		const options = params.initializationOptions as InitializationOption;

		workspaceRoot = options.workspace;
		settings = options.settings;

		storageService = new StorageService();
		scannerService = new ScannerService(storageService, settings);

		angularWorkspaceService = new AngularWorkspaceService(workspaceRoot, settings);
		await angularWorkspaceService.load();
		notifyAngularJsonStatus();

		importGraphService = new ImportGraphService(storageService, angularWorkspaceService);

		const files = await findFiles('**/*.scss', {
			cwd: workspaceRoot,
			deep: settings.scannerDepth,
			ignore: settings.scannerExclude
		});

		try {
			await scannerService.scan(files);
		} catch (error) {
			if (settings.showErrors) {
				connection.window.showErrorMessage((error as Error).stack ?? String(error));
			}
		}

		return {
			capabilities: {
				textDocumentSync: TextDocumentSyncKind.Incremental,
				completionProvider: { resolveProvider: false },
				signatureHelpProvider: {
					triggerCharacters: ['(', ',', ';']
				},
				hoverProvider: true,
				definitionProvider: true,
				workspaceSymbolProvider: true,
				codeActionProvider: true
			}
		};
	}
);

connection.onDidChangeConfiguration(params => {
	settings = params.settings.scss;
});

connection.onDidChangeWatchedFiles(async event => {
	const scssFiles: string[] = [];
	let angularJsonChanged = false;

	for (const change of event.changes) {
		const fsPath = URI.parse(change.uri).fsPath;

		if (path.basename(fsPath) === 'angular.json') {
			angularJsonChanged = true;
		} else {
			scssFiles.push(fsPath);
		}
	}

	if (angularJsonChanged) {
		await angularWorkspaceService.reload();
		notifyAngularJsonStatus();
	}

	if (scssFiles.length > 0) {
		await scannerService.scan(scssFiles);
	}
});

connection.onCompletion(textDocumentPosition => {
	const uri = documents.get(textDocumentPosition.textDocument.uri);
	if (uri === undefined) {
		return;
	}

	const offset = uri.offsetAt(textDocumentPosition.position);

	return doCompletion(uri, offset, settings, storageService, importGraphService);
});

connection.onHover(textDocumentPosition => {
	const uri = documents.get(textDocumentPosition.textDocument.uri);
	if (uri === undefined) {
		return;
	}

	const offset = uri.offsetAt(textDocumentPosition.position);

	return doHover(uri, offset, storageService, importGraphService, settings);
});

connection.onSignatureHelp(textDocumentPosition => {
	const uri = documents.get(textDocumentPosition.textDocument.uri);
	if (uri === undefined) {
		return;
	}

	const offset = uri.offsetAt(textDocumentPosition.position);

	return doSignatureHelp(uri, offset, storageService, importGraphService);
});

connection.onDefinition(textDocumentPosition => {
	const uri = documents.get(textDocumentPosition.textDocument.uri);
	if (uri === undefined) {
		return;
	}

	const offset = uri.offsetAt(textDocumentPosition.position);

	return goDefinition(uri, offset, storageService, importGraphService, settings);
});

connection.onWorkspaceSymbol(workspaceSymbolParams => {
	return searchWorkspaceSymbol(workspaceSymbolParams.query, storageService, workspaceRoot);
});

connection.onCodeAction(params => {
	const uri = documents.get(params.textDocument.uri);
	if (uri === undefined) {
		return [];
	}

	return doCodeAction(uri, params.range, storageService, importGraphService, settings);
});

connection.onShutdown(() => {
	storageService.clear();
});

connection.listen();
