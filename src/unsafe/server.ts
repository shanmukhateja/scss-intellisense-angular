'use strict';

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

import type { ISettings } from './types/settings.js';

import ScannerService from './services/scanner.js';
import StorageService from './services/storage.js';

import { doCompletion } from './providers/completion.js';
import { doHover } from './providers/hover.js';
import { doSignatureHelp } from './providers/signatureHelp.js';
import { goDefinition } from './providers/goDefinition.js';
import { searchWorkspaceSymbol } from './providers/workspaceSymbol.js';
import { findFiles } from './utils/fs.js';
import { getSCSSRegionsDocument } from './utils/vue.js';
import { URI } from 'vscode-uri';

interface InitializationOption {
	workspace: string;
	settings: ISettings;
}

let workspaceRoot: string;
let settings: ISettings;
let storageService: StorageService;
let scannerService: ScannerService;

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

// After the server has started the client sends an initilize request. The server receives
// _in the passed params the rootPath of the workspace plus the client capabilites
connection.onInitialize(
	async (params: InitializeParams): Promise<InitializeResult> => {
		const options = params.initializationOptions as InitializationOption;

		workspaceRoot = options.workspace;
		settings = options.settings;

		storageService = new StorageService();
		scannerService = new ScannerService(storageService, settings);

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
				workspaceSymbolProvider: true
			}
		};
	}
);

connection.onDidChangeConfiguration(params => {
	settings = params.settings.scss;
});

connection.onDidChangeWatchedFiles(event => {
	const files = event.changes.map((file) => URI.parse(file.uri).fsPath);

	return scannerService.scan(files);
});

connection.onCompletion(textDocumentPosition => {
	const uri = documents.get(textDocumentPosition.textDocument.uri);
	if (uri === undefined) {
		return;
	}

	const { document, offset } = getSCSSRegionsDocument(
		uri,
		textDocumentPosition.position
	);
	if (!document) {
		return null;
	}
	return doCompletion(document, offset, settings, storageService);
});

connection.onHover(textDocumentPosition => {
	const uri = documents.get(textDocumentPosition.textDocument.uri);
	if (uri === undefined) {
		return;
	}

	const { document, offset } = getSCSSRegionsDocument(
		uri,
		textDocumentPosition.position
	);
	if (!document) {
		return null;
	}
	return doHover(document, offset, storageService);
});

connection.onSignatureHelp(textDocumentPosition => {
	const uri = documents.get(textDocumentPosition.textDocument.uri);
	if (uri === undefined) {
		return;
	}

	const { document, offset } = getSCSSRegionsDocument(
		uri,
		textDocumentPosition.position
	);
	if (!document) {
		return null;
	}
	return doSignatureHelp(document, offset, storageService);
});

connection.onDefinition(textDocumentPosition => {
	const uri = documents.get(textDocumentPosition.textDocument.uri);
	if (uri === undefined) {
		return;
	}

	const { document, offset } = getSCSSRegionsDocument(
		uri,
		textDocumentPosition.position
	);
	if (!document) {
		return null;
	}
	return goDefinition(document, offset, storageService);
});

connection.onWorkspaceSymbol(workspaceSymbolParams => {
	return searchWorkspaceSymbol(workspaceSymbolParams.query, storageService, workspaceRoot);
});

connection.onShutdown(() => {
	storageService.clear();
});

connection.listen();
