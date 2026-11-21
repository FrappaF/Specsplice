const assert = require('node:assert/strict');
const vscode = require('vscode');

/** Runs only inside the built Specsplice Extension Development Host. */
async function run() {
	assert.ok(vscode.workspace.workspaceFolders?.length, 'The demonstration workspace must open');
	const prototype = vscode.extensions.all.find(extension => extension.packageJSON.name === 'ordito');
	assert.ok(prototype, 'Specsplice prototype must be discovered');
	await prototype.activate();
	const commands = await vscode.commands.getCommands();
	assert.ok(commands.includes('ordito.open'), 'Prototype command must be registered');
	assert.ok(commands.includes('ordito.workbench.open'), 'Native Specsplice command must be registered');
	await vscode.commands.executeCommand('ordito.workbench.open');
	assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab?.label, 'Specsplice Home');
	const example = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'checkout.ordito.json');
	const document = await vscode.workspace.openTextDocument(example);
	assert.equal(JSON.parse(document.getText()).version, 2);
	await vscode.window.showTextDocument(document);
	await vscode.commands.executeCommand('ordito.workbench.open');
	assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab?.label, 'Specsplice Home');
}

module.exports = { run };
