"use strict";
/** @format */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
function activate(context) {
    vscode.window.showInformationMessage("Baton SQL Extension Activated");
    vscode.workspace.onDidOpenTextDocument((document) => {
        if (document.languageId === "yaml" &&
            document.fileName.match(/baton-sql-.*\.ya?ml$/)) {
            applyBatonSQLSchema(document.fileName);
        }
    });
    const applySchemaCommand = vscode.commands.registerCommand("batonSQL.applySchema", () => {
        var _a;
        const document = (_a = vscode.window.activeTextEditor) === null || _a === void 0 ? void 0 : _a.document;
        if (document && document.languageId === "yaml") {
            applyBatonSQLSchema(document.fileName);
        }
    });
    context.subscriptions.push(applySchemaCommand);
}
exports.activate = activate;
function applyBatonSQLSchema(fileName) {
    return __awaiter(this, void 0, void 0, function* () {
        const schemaPath = path.join(__dirname, "..", "schemas", "baton-schema.json");
        const schemaUri = vscode.Uri.file(schemaPath).toString();
        vscode.window.showInformationMessage(`Schema Path: ${schemaPath}`);
        if (fs.existsSync(schemaPath)) {
            vscode.window.showInformationMessage("Schema file found.");
        }
        else {
            vscode.window.showErrorMessage("Schema file not found at: " + schemaPath);
            return;
        }
        const config = vscode.workspace.getConfiguration("yaml");
        const currentSchemas = config.get("schemas") || {};
        currentSchemas[schemaUri] = ["baton-sql-*.yaml", "baton-sql-*.yml", fileName];
        yield config.update("schemas", currentSchemas, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Baton SQL Schema applied to ${fileName}`);
    });
}
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map