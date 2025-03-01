/** @format */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage("Baton SQL Extension Activated");

  vscode.workspace.onDidOpenTextDocument((document) => {
    if (
      document.languageId === "yaml" &&
      document.fileName.match(/baton-sql-.*\.ya?ml$/)
    ) {
      applyBatonSQLSchema(document.fileName);
    }
  });

  const applySchemaCommand = vscode.commands.registerCommand(
    "batonSQL.applySchema",
    () => {
      const document = vscode.window.activeTextEditor?.document;
      if (document && document.languageId === "yaml") {
        applyBatonSQLSchema(document.fileName);
      }
    }
  );

  context.subscriptions.push(applySchemaCommand);
}

async function applyBatonSQLSchema(fileName: string) {
  const schemaPath = path.join(__dirname, "..", "schemas", "baton-schema.json");
  const schemaUri = vscode.Uri.file(schemaPath).toString();

  vscode.window.showInformationMessage(`Schema Path: ${schemaPath}`);

  if (fs.existsSync(schemaPath)) {
    vscode.window.showInformationMessage("Schema file found.");
  } else {
    vscode.window.showErrorMessage("Schema file not found at: " + schemaPath);
    return;
  }

  const config = vscode.workspace.getConfiguration("yaml");
  const currentSchemas =
    config.get<{ [key: string]: string[] }>("schemas") || {};

  currentSchemas[schemaUri] = ["baton-sql-*.yaml", "baton-sql-*.yml", fileName];

  await config.update(
    "schemas",
    currentSchemas,
    vscode.ConfigurationTarget.Workspace
  );

  vscode.window.showInformationMessage(
    `Baton SQL Schema applied to ${fileName}`
  );
}

export function deactivate() {}
