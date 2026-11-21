import type { SmokeHarness } from './harness.ts';
import assert from 'node:assert/strict';
import { writeFile, rm, readFile, readdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { openCodeActions, openModelFile, enterValue, pickValue, runCommand, installSimulatedCodex } from './helpers.ts';

/** ai scenarios share only the harness values listed here. */
export function createAiScenarios(harness: SmokeHarness) {
	const { launch, extraCleanup, aiLive, evidence } = harness;

	async function checkAiWorkflow() {
		const { fixture, original } = await import('../../ai/test/fixtures.mjs');
		const { readSession } = await import('../../ai/implementation.ts');
		const { runProcess } = await import('../../ai/process.ts');
		const f = await fixture({ after: (callback: () => Promise<void> | void) => extraCleanup.push(callback) });
		const executable = aiLive ? (process.env.ORDITO_AI_EXECUTABLE || 'codex') : path.join(f.directory, 'simulated-codex.mjs');
		const model = aiLive ? process.env.ORDITO_AI_MODEL : 'simulated-m5-model';
		assert.ok(model);
		const resultFile = path.join(evidence, aiLive ? 'm5-live-results.json' : 'm5-native-results.json');
		await rm(resultFile, { force: true });
		if (aiLive) {
			const { readProviderConfig } = await import('../../ai/contracts.ts');
			readProviderConfig({ version: 1, provider: 'codex', connection: 'cli', executable, model, timeoutMs: 180000, maxContextBytes: 262144, maxCalls: 2 });
		}
		const counter = path.join(f.directory, 'calls');
		if (!aiLive) {
			await writeFile(counter, '0');
			await writeFile(executable, `#!${process.execPath}\nimport {readFileSync,writeFileSync,writeSync,existsSync} from 'node:fs';
const args=process.argv.slice(2);
if(args[0]==='login'&&args[1]==='status'){writeSync(1,'Logged in using ChatGPT (simulated)');process.exit(0);}
if(!args.includes('--output-schema')){writeSync(2,'Simulated smoke CLI supports only account status and reviewed requests');process.exit(1);}
const schema=JSON.parse(readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));
const counter=${JSON.stringify(counter)};
writeFileSync(counter,String(Number(readFileSync(counter,'utf8'))+1));
writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(schema.properties.steps?${JSON.stringify(f.plan)}:${JSON.stringify(f.generated)}));
writeSync(1,JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:20}})+'\\n');\n`);
			await chmod(executable, 0o700);
			await installSimulatedCodex(harness, executable);
		}
		let window = await launch();
		await openModelFile(window, path.join(f.snapshot, 'model.ordito.json'));
		await openCodeActions(window);
		await window.locator('.ordito-shell').getByRole('button', { name: 'Update Code', exact: true, disabled: false }).waitFor({ timeout: 90000 });
		await runCommand(window, 'Specsplice: Connect Claude Code or Codex');
		await pickValue(window, 'Choose AI CLI', 'Codex');
		await pickValue(window, 'Codex', 'Choose Model and CLI');
		const widget = window.locator('.quick-input-widget');
		await widget.getByText(/^(Model ID from Your CLI|Choose a Model Available to Your Account)$/).waitFor();
		if (await widget.getByText('Model ID from Your CLI', { exact: true }).isVisible()) {
			await enterValue(window, 'Model ID from Your CLI', model);
		} else if (aiLive) {
			await pickValue(window, 'Choose a Model Available to Your Account', process.env.ORDITO_AI_MODEL_LABEL || model);
		} else { await window.keyboard.press('Enter'); }
		await enterValue(window, 'Original CLI Executable', executable);
		await pickValue(window, 'Agent Run Budget · Provider Usage Is Managed by Its CLI', 'Plan and Implementation');
		if (!aiLive) { assert.equal(Number(await readFile(counter, 'utf8')), 0); }
		await runCommand(window, 'Specsplice: Implement Feature');
		await pickValue(window, 'Implement Feature', 'checkout');
		await enterValue(window, 'Requested Behavior', `For the supported boolean inputs, checkout(false) must return exactly 'declined' and checkout(true) must retain exactly 'paid'. No behavior for non-boolean inputs is requested.`);
		await widget.getByText('Review Source Files to Share · Suggested from Model Evidence', { exact: true }).waitFor();
		await window.keyboard.press('Enter');
		await pickValue(window, 'Review Implementation Context', 'Send Context to Codex');
		console.log('M5: context approved; awaiting the CLI plan.');
		await pickValue(window, 'Review Implementation Plan', 'Generate in Worktree', aiLive ? 200000 : 30000);
		await window.locator('.monaco-editor .view-lines').filter({ hasText: 'Changes Ready for Review' }).last().waitFor({ timeout: aiLive ? 200000 : 30000 });
		console.log('M5: implementation staged; checking independent acceptance.');
		const ids = await readdir(path.join(f.root, '.ordito/collaboration'));
		assert.equal(ids.length, 1);
		const session = await readSession(f.root, ids[0]);
		if (aiLive) { assert.equal(session.prepared.config.model, model); }
		const checkBehavior = async (folder: string) => {
			const result = await runProcess(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict'; import {checkout} from './checkout.mjs'; assert.deepEqual([checkout(false), checkout(true)], ['declined', 'paid']);`], folder);
			assert.equal(result.code, 0, `Independent payment refusal and approval checks must pass: ${result.stderr}`);
		};
		await checkBehavior(session.worktree);
		const returnToModel = async () => {
			await runCommand(window, 'Specsplice: Return to Model');
			return openCodeActions(window);
		};
		let collaboration = await returnToModel();
		await collaboration.getByRole('button', { name: 'Run Tests', exact: true }).waitFor();
		if (!aiLive) { assert.equal(Number(await readFile(counter, 'utf8')), 2); }
		assert.equal(await readFile(path.join(f.root, 'checkout.mjs'), 'utf8'), original);
		await collaboration.getByRole('button', { name: 'Run Tests', exact: true }).click();
		await window.locator('.monaco-dialog-box').getByRole('button', { name: 'Run Tests', exact: true }).click();
		await window.locator('.monaco-editor .view-lines').filter({ hasText: 'Tests Passed · Ready to Apply' }).last().waitFor();
		collaboration = await returnToModel();
		await collaboration.getByRole('button', { name: 'Apply Verified Changes', exact: true }).click();
		await window.locator('.monaco-dialog-box').getByRole('button', { name: 'Apply Changes', exact: true }).click();
		await window.locator('.monaco-editor .view-lines').filter({ hasText: 'Applied · Undo Available' }).last().waitFor();
		for (const file of session.generated.files) {
			if (file.content === null) { await assert.rejects(readFile(path.join(f.root, file.file)), { code: 'ENOENT' }); }
			else { assert.deepEqual(await readFile(path.join(f.root, file.file)), Buffer.from(file.content)); }
		}
		await checkBehavior(f.root);
		await window.screenshot({ path: path.join(evidence, aiLive ? 'm5-live-applied.png' : 'm5-applied.png') });
		await returnToModel();
		await harness.app.close(); harness.app = undefined;
		window = await launch();
		await openCodeActions(window);
		await window.locator('.ordito-shell').getByRole('button', { name: 'Update Code', exact: true, disabled: false }).waitFor({ timeout: 90000 });
		await runCommand(window, 'Specsplice: Resume Implementation');
		await window.locator('.monaco-editor .view-lines').filter({ hasText: 'Applied · Undo Available' }).last().waitFor();
		collaboration = await returnToModel();
		await runCommand(window, 'Specsplice: Undo Implementation');
		await window.locator('.monaco-dialog-box').getByRole('button', { name: 'Undo Implementation', exact: true }).click();
		await window.locator('.monaco-editor .view-lines').filter({ hasText: 'Changes Undone' }).last().waitFor();
		assert.equal(await readFile(path.join(f.root, 'checkout.mjs'), 'utf8'), original);
		if (!aiLive) { assert.equal(Number(await readFile(counter, 'utf8')), 2); }
		for (const before of session.before) {
			if (before.content === null) { await assert.rejects(readFile(path.join(f.root, before.file)), { code: 'ENOENT' }); }
			else { assert.deepEqual(await readFile(path.join(f.root, before.file)), Buffer.from(before.content)); }
		}
		await writeFile(resultFile, JSON.stringify({ kind: aiLive ? 'native-ui-with-live-codex' : 'native-ui-with-simulated-cli', recordedAt: new Date().toISOString(), externalProviderValidated: aiLive, model: session.prepared.config.model, calls: 2, usage: session.usage, passingTests: true, independentAcceptancePassed: true, applied: true, restartResume: true, undone: true, sourcePreserved: true }, null, 2));
		await harness.app.close(); harness.app = undefined;
		console.log(aiLive ? 'PASS: native M5 with live Codex, independent acceptance, apply, restart, resume and exact undo.' : 'PASS: native M5 context disclosure, plan approval, simulated CLI subprocess, independent acceptance, worktree tests, apply, restart, resume and undo; no external provider is validated.');
	}

	return { checkAiWorkflow };
}
