/** @format */

import * as path from 'path';
import { workspace, ExtensionContext } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  // The server is implemented in node
  const serverModule = context.asAbsolutePath(
    path.join('out', 'server', 'server.js')
  );

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] }
    }
  };

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for YAML documents that match the Baton SQL pattern
    documentSelector: [
      {
        scheme: 'file',
        language: 'yaml',
        pattern: '**/baton-sql-*.{yaml,yml}'
      }
    ],
    synchronize: {
      // Notify the server about file changes to YAML files in the workspace
      fileEvents: workspace.createFileSystemWatcher('**/baton-sql-*.{yaml,yml}')
    }
  };

  // Create the language client and start the client
  client = new LanguageClient(
    'batonSQLLanguageServer',
    'Baton SQL Language Server',
    serverOptions,
    clientOptions
  );

  // Start the client. This will also launch the server
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
