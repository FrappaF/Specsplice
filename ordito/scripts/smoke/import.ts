import type { ModelView, SemanticElement } from '../../../src/vs/workbench/contrib/ordito/common/modelTypes.ts';
import type { IndexedFile, CodeDeclaration } from '../../code-import/importCode.ts';
import type { SmokeHarness } from './harness.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm, copyFile, readFile, chmod, realpath } from 'node:fs/promises';
import path from 'node:path';
import { enterValue, pickValue, chooseFolder, runCommand, codeAction, chooseOrditoDiagram, clickOrditoButton, installSimulatedCodex } from './helpers.ts';

/** import scenarios share only the harness values listed here. */
export function createImportScenarios(harness: SmokeHarness) {
	const { launch, root, workspace, directory, evidence, launchEnv, args, workflowOnly, validateSemanticModel, userData } = harness;

	async function useLegacyDiagramProtocol() {
		const settingsFile = path.join(userData, 'User/settings.json');
		const settings = JSON.parse(await readFile(settingsFile, 'utf8'));
		await writeFile(settingsFile, JSON.stringify({ ...settings, 'ordito.diagramImport.incremental': false }));
	}

	async function checkSemanticTodo() {
		const { todoFile, todoSource, todoFiles } = await import('../../code-import/test/todo-semantic-fixture.mjs');
		const recordsPath = path.join(root, 'ordito/code-import/test/fixtures/real-diagrams/planned-terra.json');
		const record = JSON.parse(await readFile(recordsPath, 'utf8')).find((item: { case: string }) => item.case === 'todo-rails');
		const sourceRoot = path.join(workspace, 'todo-with-ordito');
		for (const [file, content] of Object.entries({ [todoFile]: todoSource, ...todoFiles })) { await mkdir(path.dirname(path.join(sourceRoot, file)), { recursive: true }); assert.ok(typeof content === 'string'); await writeFile(path.join(sourceRoot, file), content); }
		const bin = path.join(directory, 'bin'), counter = path.join(directory, 'semantic-calls');
		await mkdir(bin);
		await writeFile(counter, '0');
		await writeFile(path.join(bin, 'codex'), `#!${process.execPath}\nimport {readFileSync,writeFileSync,writeSync} from 'node:fs';
const record=JSON.parse(readFileSync(${JSON.stringify(recordsPath)},'utf8')).find(item=>item.case==='todo-rails');
const args=process.argv.slice(2);
if(args[0]==='login'&&args[1]==='status'){writeSync(1,'Logged in using ChatGPT (simulated)');process.exit(0);}
if(args[0]!=='exec'){process.exit(1);}
const input=readFileSync(0,'utf8'), context=JSON.parse(input.slice(input.indexOf('\\n')+1));
if(context.step!=='diagram'){writeFileSync(${JSON.stringify(path.join(evidence, 'semantic-todo-context.json'))},JSON.stringify(context));}
writeFileSync(${JSON.stringify(counter)},String(Number(readFileSync(${JSON.stringify(counter)},'utf8'))+1));
writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({...context.step!=='diagram'?{notation:{elements:[],relations:[]}}:{},...record.calls.find(item=>item.step===context.step&&item.diagramKey===(context.diagram?.key??null)).response}));
writeSync(1,JSON.stringify({type:'turn.completed',usage:{input_tokens:500,output_tokens:200}})+'\\n');
`);
		await chmod(path.join(bin, 'codex'), 0o700);
		launchEnv.PATH = bin + path.delimiter + process.env.PATH; args.push('--force-disable-user-env');
		await useLegacyDiagramProtocol();
		const window = await launch(), shell = window.locator('.ordito-shell');
		await shell.getByRole('button', { name: 'Import Codebase', exact: true }).click();
		const widget = window.locator('.quick-input-widget');
		await widget.getByText('Import Codebase', { exact: true }).waitFor();
		await widget.locator('input:visible').fill(sourceRoot + path.sep);
		await widget.getByRole('button', { name: 'OK', exact: true }).click();
		const entered = window.waitForEvent('domcontentloaded', { timeout: 90000 });
		await pickValue(window, 'Import Codebase', 'Structure and Available Semantic Analysis');
		await entered; args[1] = sourceRoot;
		await shell.getByRole('heading', { name: 'Explore Your Codebase', exact: true }).waitFor({ timeout: 90000 });
		assert.equal(await shell.locator('.ordito-node, .ordito-atlas-node').count(), 0);
		await runCommand(window, 'Specsplice: Show Diagram Navigation');
		const sidebar = window.locator('.ordito-sidebar');
		await shell.getByText('Source Evidence Ready · Create Capability and Flow Diagrams with AI', { exact: true }).waitFor();
		assert.equal(await sidebar.getByRole('button', { name: /\.(?:rb|erb|yml)$/ }).count(), 0);
		await shell.getByRole('button', { name: 'Build Diagrams with AI', exact: true, disabled: false }).waitFor();
		await window.screenshot({ path: path.join(evidence, 'semantic-import-ready.png') });
		await shell.getByRole('button', { name: 'Build Diagrams with AI', exact: true }).click();
		await widget.getByText('Model for Diagrams', { exact: true }).waitFor();
		if (await widget.locator('.quick-input-list-row .label-name').first().isVisible()) { await window.keyboard.press('Enter'); } else { await enterValue(window, 'Model for Diagrams', 'economical-todo-model'); }
		await window.locator('.monaco-dialog-box').getByRole('button', { name: 'Propose Diagrams', exact: true }).click();
		const generate = window.locator('.monaco-dialog-box').getByRole('button', { name: 'Generate 4 Diagrams', exact: true });
		await generate.waitFor({ timeout: 90000 });
		await window.screenshot({ path: path.join(evidence, 'diagram-plan-review.png') });
		await window.locator('.monaco-dialog-box').getByRole('button', { name: 'Cancel', exact: true }).click();
		assert.equal(await readFile(counter, 'utf8'), '1', 'declining the plan makes no view request');
		assert.equal(await shell.locator('.ordito-node').count(), 0);
		await shell.getByRole('button', { name: 'Review Diagram Plan', exact: true, disabled: false }).click();
		await generate.click();
		await shell.getByRole('region', { name: `Diagram: ${record.calls[0].response.plan[0].name}`, exact: true }).waitFor({ timeout: 90000 });
		await (await codeAction(window, 'Update Code', false)).waitFor();
		assert.equal(await readFile(counter, 'utf8'), String(record.calls.length));
		const pointer = JSON.parse(await readFile(path.join(sourceRoot, '.ordito/code-project.json'), 'utf8'));
		const model = JSON.parse(await readFile(path.join(sourceRoot, '.ordito/imports', pointer.active, 'model.ordito.json'), 'utf8'));
		assert.deepEqual(model.views.map((view: ModelView) => view.kind), ['structure', 'activity', 'sequence', 'state']);
		assert.ok(model.views.every((view: ModelView) => view.nodes.length >= 2 && view.relationIds.length));
		for (const view of model.views) {
			await chooseOrditoDiagram(window, view.name);
			await shell.getByRole('button', { name: 'Fit Diagram', exact: true }).click();
			assert.equal(await shell.locator('.ordito-node').count(), view.nodes.length);
			assert.equal(await shell.locator('svg path[data-relation-id]:not(.ordito-connection-hit)').count(), view.relationIds.length);
			await window.screenshot({ path: path.join(evidence, `planned-${view.kind}.png`) });
		}
		await writeFile(path.join(evidence, 'semantic-todo-results.json'), JSON.stringify({ provider: 'replay-recorded-real-cli-output', paidCalls: 0, replayedCalls: record.calls.length, planReviewedBeforeViews: true, declinedPlanResumed: true, types: model.views.map((view: ModelView) => view.kind), allApprovedViewsPresent: true }, null, 2));
		await harness.app.close(); harness.app = undefined;
		console.log('PASS: recorded real model proposal is reviewed before generation, cancel/resume preserves the plan, all four approved diagram types render in the desktop canvas.');
	}

	async function checkGeneratedDiagrams() {
		const resource = process.env.ORDITO_GENERATED_MODEL;
		if (!resource) { throw new Error('--generated-diagrams requires ORDITO_GENERATED_MODEL from a completed real generation'); }
		const document = JSON.parse(await readFile(resource, 'utf8'));
		args[1] = path.dirname(path.dirname(path.dirname(path.dirname(resource))));
		const window = await launch(), shell = window.locator('.ordito-shell');
		await shell.locator('.ordito-node').first().waitFor({ timeout: 90000 });
		await shell.getByRole('button', { name: 'Update Diagrams', exact: true }).waitFor();
		for (const [index, view] of document.views.entries()) {
			await shell.getByRole('button', { name: 'Diagrams', exact: true }).click();
			await pickValue(window, 'Choose Diagram', view.name);
			await shell.getByRole('button', { name: 'Fit Diagram', exact: true }).click();
			assert.equal(await shell.locator('.ordito-node').count(), view.nodes.length);
			assert.equal(await shell.locator('svg path[data-relation-id]:not(.ordito-connection-hit)').count(), view.relationIds.length);
			await window.screenshot({ path: path.join(evidence, `live-generated-${index}.png`) });
		}
		await harness.app.close(); harness.app = undefined;
		console.log('PASS: model generated by the authenticated real CLI opens with visible nodes and connected views in the desktop canvas.');
	}

	async function checkCodeBridge() {
		// Exercise the real original-CLI protocol without claiming a live-model benchmark.
		const simulatedCli = path.join(directory, 'm6-simulated-codex.mjs');
		const execCounter = path.join(directory, 'codex-exec-count');
		await writeFile(execCounter, '0');
		await writeFile(simulatedCli, `#!${process.execPath}\nimport {readFileSync,writeFileSync,writeSync,existsSync} from 'node:fs';
const {expandDiagramContext,compactDiagramReply,plannedDiagramReply}=await import(${JSON.stringify(path.join(root, 'ordito/code-import/test/compact-diagram-fixture.mjs'))});
const args=process.argv.slice(2);
if(args[0]==='login'&&args[1]==='status'){writeSync(1,'Logged in using ChatGPT (simulated)');process.exit(0);}
if(args[0]!=='exec'){process.exit(2);}
const execCounter=${JSON.stringify(execCounter)};
writeFileSync(execCounter,String(Number(readFileSync(execCounter,'utf8'))+1));
const input=readFileSync(0,'utf8');
if(!args.includes('--output-schema')){
const counter=${JSON.stringify(path.join(directory, 'codex-chat-starts.txt'))};
writeFileSync(counter,String((existsSync(counter)?Number(readFileSync(counter,'utf8')):0)+1));
const messages=JSON.parse(input.slice(input.indexOf('Conversation:')+'Conversation:'.length));
if(messages.some(message=>message.role==='user'&&message.text.includes('change-code'))){const file=process.cwd()+'/gateway.ts';writeFileSync(file,readFileSync(file,'utf8').replace('amount > 0','amount >= 0'));}
writeFileSync(args[args.indexOf('--output-last-message')+1],'SIMULATED_CODEX_CHANGE_COMPLETE');
writeSync(1,JSON.stringify({type:'turn.completed'})+'\\n');process.exit(0);
}
const rawContext=JSON.parse(input.slice(input.indexOf('\\n')+1));
const context=expandDiagramContext(rawContext);
if(context.step&&existsSync(${JSON.stringify(path.join(directory, 'fail-diagrams'))})){writeSync(2,'Simulated provider unavailable');process.exit(1);}
let value;
if(context.step==='diagram'){value=plannedDiagramReply(context);}
else if(context.step){
const overview=context.step==='overview';
const edges=context.dependencies.filter(edge=>context.required.some(item=>item.ref===edge.from)&&context.required.some(item=>item.ref===edge.to));
const relations=edges.map((edge,i)=>({key:'interaction-'+context.batch+'-'+i,kind:'dependency',from:edge.from,to:edge.to,name:'Uses payment processing',condition:null,evidence:[edge.from,edge.to],classification:'inferred'}));
value={summary:'Purchase responsibilities',questions:[],omissions:[],features:[{key:'purchasing',name:'Purchasing',description:'Coordinate checkout and payment.'}],elements:context.required.filter(item=>item.indexed).map(item=>({symbol:item.ref,kind:'action',name:context.symbols.find(symbol=>symbol.ref===item.ref).name==='charge'&&context.symbols.find(symbol=>symbol.ref===item.ref).content.includes('amount >= 0')?'Accept Non-Negative Payments':context.symbols.find(symbol=>symbol.ref===item.ref).name,description:'Purchase responsibility',feature:'purchasing',parent:null})),concepts:context.required.filter(item=>!item.indexed).map(item=>({key:'concept-'+item.ref,kind:'component',name:'External Integration',description:'Extracted responsibility',feature:'purchasing',parent:null,source:item.ref})),relations,diagrams:[{key:overview?'overview':'purchase-flow-'+context.batch,name:overview?'Purchasing Overview':'Purchase Flow',kind:'activity',feature:overview?null:'purchasing',nodes:overview?['f:purchasing']:context.required.map(item=>item.indexed?item.ref:'c:concept-'+item.ref),relations:relations.map(item=>item.key),intent:'Inferred purchase responsibilities'}]};
if(context.step==='project'){value.diagrams.unshift({...value.diagrams[0],key:'overview',name:'Purchasing Overview',kind:'structure',feature:null});}
}else{
value={summary:'Reconcile observed source changes',questions:[],sourceEdits:[],bindings:[],modelEdits:[
...context.changes.elements.filter(item=>item.indexed!==false).map(item=>({collection:'elements',id:item.id,value:item.code?{...item.model,...item.code,parentId:item.model?.parentId}:null})),
...context.changes.relations.map(item=>({collection:'relations',id:item.id,value:item.code?{...item.model,...item.code}:null}))]};
if(context.direction==='model'){
const item=context.changes.elements.find(item=>item.model&&item.code&&item.model.name!==item.code.name);
const fact=context.facts.flatMap(file=>file.declarations).find(fact=>fact.id===item.id);
const source=context.sources.find(source=>source.file===fact.evidence.file);
value={summary:'Reconcile the diagram rename',questions:[],modelEdits:[],sourceEdits:[{file:source.file,revision:source.revision,search:'function '+item.code.name+'(',replacement:'function '+item.model.name+'('}],bindings:[{elementId:item.id,file:source.file,name:item.model.name,syntaxKind:fact.syntaxKind}]};
}
}
writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(context.step&&context.step!=='diagram'?compactDiagramReply(context,value):value));
writeSync(1,JSON.stringify({type:'turn.completed',usage:{input_tokens:100,output_tokens:50}})+'\\n');\n`);
		await chmod(simulatedCli, 0o700);
		await installSimulatedCodex(harness, simulatedCli);
		if (workflowOnly) {
			const bin = path.join(directory, 'bin'); await mkdir(bin); await copyFile(simulatedCli, path.join(bin, 'codex')); await chmod(path.join(bin, 'codex'), 0o700);
			launchEnv.PATH = bin + path.delimiter + process.env.PATH; args.push('--force-disable-user-env');
		}
		const sourceDirectory = path.join(workspace, 'codebase');
		await mkdir(sourceDirectory);
		const sourceRoot = await realpath(sourceDirectory);
		await writeFile(path.join(sourceRoot, 'gateway.ts'), 'export function charge(amount: number): boolean { return amount > 0; }');
		await writeFile(path.join(sourceRoot, 'checkout.ts'), 'import {charge as pay} from "./gateway"; export function checkout(amount: number): boolean { return pay(amount); }');
		await writeFile(path.join(sourceRoot, 'obsolete.py'), 'def obsolete():\n    return 1\n');
		await writeFile(path.join(sourceRoot, 'unsupported.vb'), 'Class Unsupported\nEnd Class\n');
		let window = await launch();
		let shell = window.locator('.ordito-shell');
		await shell.getByRole('button', { name: 'Import Codebase', exact: true }).click();
		const widget = window.locator('.quick-input-widget');
		await widget.locator('input:visible').fill(sourceRoot + path.sep);
		await widget.getByRole('button', { name: 'OK', exact: true }).click();
		// Import enters a different native workspace after the initial analysis finishes.
		// Await that navigation before sending keyboard commands to the restored window.
		const enteredWorkspace = window.waitForEvent('domcontentloaded', { timeout: 90000 });
		await pickValue(window, 'Import Codebase', 'Structure and Available Semantic Analysis');
		await enteredWorkspace;
		await shell.getByRole('heading', { name: 'Explore Your Codebase', exact: true }).waitFor({ timeout: 90000 });
		await shell.getByRole('region', { name: 'Architecture Exploration', exact: true }).waitFor();
		await shell.getByRole('button', { name: 'Explore Architecture', exact: true, disabled: false }).waitFor();
		assert.equal(await shell.locator('.ordito-node, .ordito-atlas-node').count(), 0, 'The index is never presented as finished diagrams');
		await shell.locator('.ordito-workspace-bar').getByRole('button', { name: 'Code', exact: true }).click();
		const codePage = shell.locator('.ordito-code-page');
		await codePage.getByRole('button', { name: 'Code Evidence', exact: true }).waitFor();
		assert.equal(await codePage.getByRole('button', { name: 'Update Code', exact: true }).count(), 0, 'The unreviewed source index does not expose legacy model-to-code synchronization');
		await runCommand(window, 'Specsplice: Return to Model');
		await shell.getByRole('button', { name: 'Inspect Code Evidence', exact: true }).click();
		await widget.getByRole('option', { name: /checkout.*Extracted declaration/i }).waitFor();
		await widget.getByRole('option', { name: /checkout.*Extracted declaration/i }).click();
		await window.locator('.monaco-editor .view-lines').filter({ hasText: 'checkout' }).first().waitFor();
		await window.getByRole('tab', { name: /Create Diagrams: codebase/ }).click();
		assert.equal(await readFile(execCounter, 'utf8'), '0', 'Inspecting the default import and code actions sends no inference request');
		await useLegacyDiagramProtocol();
		console.log('PASS: default import exposes Architecture Exploration; continuing the explicitly selected legacy CLI protocol.');
		const configurationDeadline = Date.now() + 10000;
		while (!await shell.getByText('Source Evidence Ready · Create Capability and Flow Diagrams with AI', { exact: true }).isVisible() && Date.now() < configurationDeadline) {
			await runCommand(window, 'Specsplice: Return to Model');
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		const snapshot = async () => {
			const pointer = JSON.parse(await readFile(path.join(sourceRoot, '.ordito/code-project.json'), 'utf8'));
			const folder = path.join(sourceRoot, '.ordito/imports', pointer.active);
			return { folder, state: JSON.parse(await readFile(path.join(folder, 'import-state.json'), 'utf8')), model: JSON.parse(await readFile(path.join(folder, 'model.ordito.json'), 'utf8')) };
		};
		await shell.getByText('Source Evidence Ready · Create Capability and Flow Diagrams with AI', { exact: true }).waitFor({ timeout: 90000 });
		args[1] = sourceRoot; // Restart in the workspace entered by Import Codebase, without a second asynchronous folder switch.
		if (!workflowOnly) {
			await runCommand(window, 'Specsplice: Connect Claude Code or Codex');
			await pickValue(window, 'Choose AI CLI', 'Codex');
			await pickValue(window, 'Codex', 'Choose Model and CLI');
			await widget.getByText(/^(Model ID from Your CLI|Choose a Model Available to Your Account)$/).waitFor();
			if (await widget.getByText('Model ID from Your CLI', { exact: true }).isVisible()) { await enterValue(window, 'Model ID from Your CLI', 'simulated-m6-model'); }
			else { await window.keyboard.press('Enter'); }
			await enterValue(window, 'Original CLI Executable', simulatedCli);
			await pickValue(window, 'Agent Run Budget · Provider Usage Is Managed by Its CLI', 'Plan or Reconciliation');
		}
		if (workflowOnly) {
			await shell.getByRole('button', { name: 'Build Diagrams with AI', exact: true }).click();
			await widget.getByText(/^(Model for Diagrams)$/).waitFor();
			await window.screenshot({ path: path.join(evidence, 'ux-first-setup.png') });
			if (await widget.locator('.quick-input-list-row .label-name').first().isVisible()) { await window.keyboard.press('Enter'); } else { await enterValue(window, 'Model for Diagrams', 'simulated-economical-model'); }
			await window.locator('.monaco-dialog-box').getByRole('button', { name: 'Propose Diagrams', exact: true }).waitFor();
			await window.screenshot({ path: path.join(evidence, 'ux-diagram-review.png') });
			const original = (await snapshot()).folder;
			await window.locator('.monaco-dialog-box').getByRole('button', { name: 'Cancel', exact: true }).click();
			await shell.getByRole('button', { name: 'Build Diagrams with AI', exact: true, disabled: false }).waitFor();
			assert.equal(await readFile(execCounter, 'utf8'), '0', 'Canceling before inference sends no exec request');
			assert.equal((await snapshot()).folder, original);
			await shell.getByRole('button', { name: 'Build Diagrams with AI', exact: true }).click();
			await window.locator('.monaco-dialog-box').getByRole('button', { name: 'Propose Diagrams', exact: true }).click();
			await window.locator('.monaco-dialog-box').getByRole('button', { name: 'Generate 2 Diagrams', exact: true }).click();
			await shell.getByRole('region', { name: 'Diagram: Purchasing Overview', exact: true }).waitFor({ timeout: 90000 });
			assert.equal(await shell.locator('.ordito-properties').count(), 0);
			assert.equal(await (await codeAction(window, 'Chat with Codex')).isEnabled(), true);
			assert.equal(await shell.getByRole('button', { name: 'Implement Feature', exact: true }).isVisible(), false);
			const generated = await snapshot();
			assert.equal(generated.model.views.length, 2);
			assert.ok(generated.model.semantics.elements.some((item: SemanticElement) => item.kind === 'feature'));
			await chooseOrditoDiagram(window, 'Purchase Flow');
			await shell.locator('.ordito-canvas').getByRole('button', { name: 'checkout', exact: true }).click();
			await clickOrditoButton(window, 'Rename Element');
			await enterValue(window, 'Name', 'reviewedPurchase');
			await shell.getByRole('button', { name: 'Close Properties', exact: true }).click();
			await (await codeAction(window, 'Update Code')).click();
			await pickValue(window, 'Review Sync Context', 'Request Sync Proposal');
			await pickValue(window, 'Review Code Changes', 'Apply Code Changes', 90000);
			await (await codeAction(window, 'Update Code', false)).waitFor({ timeout: 90000 });
			assert.ok((await readFile(path.join(sourceRoot, 'checkout.ts'), 'utf8')).includes('function reviewedPurchase('));
			await (await codeAction(window, 'Chat with Codex')).click();
			const assistant = window.getByRole('dialog', { name: 'Specsplice Assistant', exact: true });
			await assistant.waitFor();
			await window.screenshot({ path: path.join(evidence, 'ux-codex-chat.png') });
			await assistant.getByRole('textbox', { name: 'Message the Assistant', exact: true }).fill('change-code');
			await assistant.getByRole('button', { name: 'Send', exact: true }).click();
			await assistant.getByText('SIMULATED_CODEX_CHANGE_COMPLETE', { exact: true }).waitFor();
			await assistant.getByRole('button', { name: 'Close', exact: true }).click();
			await shell.getByText('Code Has Changed. Choose Update Diagrams to Reflect the Changes Here.', { exact: true }).waitFor();
			assert.equal(await (await codeAction(window, 'Update Diagrams from Codebase')).isEnabled(), true);
			await shell.locator('.ordito-document-state').getByText('Code Changed · Review Diagram Evidence', { exact: true }).waitFor();
			await window.screenshot({ path: path.join(evidence, 'ux-code-changes.png') });
			await (await codeAction(window, 'Chat with Codex')).click();
			await assistant.waitFor();
			assert.equal(await assistant.locator('article').count(), 0, 'closing the assistant resets its conversation');
			assert.equal(await readFile(path.join(directory, 'codex-chat-starts.txt'), 'utf8'), '1');
			await assistant.getByRole('button', { name: 'Close', exact: true }).click();
			await writeFile(path.join(directory, 'fail-diagrams'), 'offline');
			await (await codeAction(window, 'Update Diagrams from Codebase')).click();
			await window.locator('.monaco-dialog-box').getByRole('button', { name: 'Propose Diagrams', exact: true }).click(); await shell.getByRole('button', { name: 'Resume Diagrams', exact: true, disabled: false }).waitFor({ timeout: 90000 });
			await window.screenshot({ path: path.join(evidence, 'ux-diagrams-paused.png') });
			await rm(path.join(directory, 'fail-diagrams'));
			await shell.getByRole('button', { name: 'Resume Diagrams', exact: true }).click();
			await window.locator('.monaco-dialog-box').getByRole('button', { name: 'Propose Diagrams', exact: true }).click();

			await window.locator('.monaco-dialog-box').getByRole('button', { name: 'Generate 2 Diagrams', exact: true }).click();
			await shell.getByRole('region', { name: 'Diagram: Purchase Flow', exact: true }).waitFor({ timeout: 90000 });
			await (await codeAction(window, 'Update Diagrams from Codebase', false)).waitFor({ timeout: 90000 });
			await shell.locator('.ordito-workflow').waitFor({ state: 'hidden' });
			await chooseOrditoDiagram(window, 'Purchase Flow');
			assert.equal(await shell.locator('.ordito-node[aria-pressed="true"]').textContent(), 'reviewedPurchase');
			await shell.locator('.ordito-node').getByText('Accept Non-Negative Payments', { exact: true }).waitFor();
			await window.screenshot({ path: path.join(evidence, 'diagram-workflow.png') });
			const final = await snapshot();
			assert.equal(final.model.views.length, 2);
			assert.equal(validateSemanticModel(final.model).filter(item => item.severity === 'error').length, 0);
			assert.ok(final.model.semantics.elements.some((item: SemanticElement) => item.name === 'reviewedPurchase'));
			await writeFile(path.join(evidence, 'diagram-workflow-results.json'), JSON.stringify({ importSteps: 2, diagrams: final.model.views.length, primaryActions: ['Diagram Picker', 'Code: Update Code', 'Code: Chat with Codex', 'Code: Update Diagrams from Codebase'], inspectorInitiallyHidden: true, directFirstSetup: true, codexModalReset: true, automaticRefresh: true, activeDiagramPreserved: true, cancelledBeforeInference: true, failedGenerationResumed: true, modelToCode: true, codeToModel: true, codeToModelVisibleChange: true, provider: 'simulated-original-cli', diagramProtocol: 'legacy', defaultExplorationUiVerified: true, incrementalEndToEnd: false }, null, 2));
			await harness.app.close(); harness.app = undefined;
			window = await launch(); shell = window.locator('.ordito-shell');
			await (await codeAction(window, 'Update Code', false)).waitFor({ timeout: 90000 });
			assert.equal(await (await codeAction(window, 'Update Diagrams from Codebase')).isEnabled(), true);
			await harness.app.close(); harness.app = undefined;
			console.log('PASS: semantic import, clean canvas, contextual editing, guided code update, diagram refresh and restart (simulated provider).');
			return;
		}
		await shell.getByRole('button', { name: 'Build Diagrams with AI', exact: true }).click();
		await widget.getByText('Model for Diagrams', { exact: true }).waitFor();
		if (await widget.locator('.quick-input-list-row .label-name').first().isVisible()) { await window.keyboard.press('Enter'); }
		else { await enterValue(window, 'Model for Diagrams', 'simulated-economical-model'); }
		await window.locator('.monaco-dialog-box').getByRole('button', { name: 'Propose Diagrams', exact: true }).click();
		await window.locator('.monaco-dialog-box').getByRole('button', { name: 'Generate 2 Diagrams', exact: true }).click();
		await shell.getByRole('region', { name: 'Diagram: Purchasing Overview', exact: true }).waitFor({ timeout: 90000 });
		const initial = await snapshot();
		assert.ok(initial.state.semantic.dependencies.length >= 1);
		assert.equal(initial.state.files.find((file: IndexedFile) => file.file === 'unsupported.vb').status, 'unsupported');
		const previous = initial.state.files.flatMap((file: IndexedFile) => file.declarations).find((item: CodeDeclaration) => item.name === 'checkout');
		await writeFile(path.join(sourceRoot, 'checkout.ts'), 'import {charge as pay} from "./gateway"; export function purchase(amount: number, tag: string): boolean { return pay(amount); }');
		await rm(path.join(sourceRoot, 'obsolete.py'));
		await runCommand(window, 'Specsplice: Sync Project');
		await pickValue(window, 'Sync Preview', 'Confirm a Symbol Rename');
		await pickValue(window, 'Choose the Previous Declaration', 'checkout');
		await pickValue(window, 'Choose the Renamed Declaration', 'purchase');
		await pickValue(window, 'Sync Preview', 'Review Sync Context');
		await widget.getByText('Review Source Files for Bidirectional Sync', { exact: true }).waitFor();
		await window.keyboard.press('Enter');
		await pickValue(window, 'Review Sync Context', 'Request Sync Proposal');
		await pickValue(window, 'Sync Preview', 'Apply Sync');
		await window.waitForFunction(() => {
			// UI state is exposed through the rendered, accessible system map.
			return document.querySelector('.ordito-shell')?.textContent.includes('purchase');
		});
		const updated = await snapshot();
		assert.notEqual(updated.folder, initial.folder);
		assert.ok(updated.state.files.flatMap((file: IndexedFile) => file.declarations).some((item: CodeDeclaration) => item.id === previous.id && item.name === 'purchase'));
		assert.deepEqual(updated.state.analysis.parsed, ['checkout.ts']);
		assert.ok(updated.state.analysis.reused.includes('gateway.ts'));
		assert.ok(!updated.state.files.some((file: IndexedFile) => file.file === 'obsolete.py'));
		await (await codeAction(window, 'Update Code', false)).waitFor();
		await runCommand(window, 'Specsplice: Inspect Code Evidence');
		await widget.locator('input:visible').fill('purchase');
		await window.keyboard.press('Enter');
		await window.locator('.monaco-editor .view-lines').filter({ hasText: 'purchase' }).first().waitFor();
		await runCommand(window, 'Specsplice: Return to Model');
		await window.screenshot({ path: path.join(evidence, 'm4-code-sync.png') });
		await chooseOrditoDiagram(window, 'Purchase Flow');
		await shell.locator('.ordito-canvas').getByRole('button', { name: 'purchase', exact: true }).click();
		await clickOrditoButton(window, 'Rename Element');
		await enterValue(window, 'Name', 'reviewedPurchase');
		await shell.getByRole('button', { name: 'Save', exact: true }).click();
		await runCommand(window, 'Specsplice: Sync Project');
		await pickValue(window, 'Sync Preview', 'Review Sync Context');
		await widget.getByText('Review Source Files for Bidirectional Sync', { exact: true }).waitFor();
		await window.keyboard.press('Enter');
		await pickValue(window, 'Review Sync Context', 'Request Sync Proposal');
		await pickValue(window, 'Sync Preview', 'Apply Sync');
		await shell.getByText('reviewedPurchase', { exact: true }).first().waitFor();
		assert.ok((await readFile(path.join(sourceRoot, 'checkout.ts'), 'utf8')).includes('function reviewedPurchase('));
		await window.screenshot({ path: path.join(evidence, 'm6-model-to-code.png') });
		await runCommand(window, 'Specsplice: Undo Last Sync');
		await pickValue(window, 'Undo Last Sync', 'Undo Model and Source Changes');
		await (await codeAction(window, 'Update Code', false)).waitFor();
		assert.equal((await snapshot()).folder, updated.folder);
		assert.ok((await readFile(path.join(sourceRoot, 'checkout.ts'), 'utf8')).includes('function purchase('));
		await harness.app.close(); harness.app = undefined;
		window = await launch(); shell = window.locator('.ordito-shell');
		await (await codeAction(window, 'Update Code', false)).waitFor({ timeout: 90000 });
		await clickOrditoButton(window, 'Home');
		const projectMenu = shell.locator('.ordito-project-menu');
		await projectMenu.locator(':scope > summary').click();
		await projectMenu.getByRole('button', { name: 'Open Project', exact: true }).click();
		await chooseFolder(window, sourceRoot);
		await (await codeAction(window, 'Update Code', false)).waitFor();
		await runCommand(window, 'Specsplice: Restore Code Model Snapshot');
		await window.locator('.quick-input-widget').getByText(initial.folder, { exact: true }).click();
		await shell.locator('.ordito-canvas').getByRole('button', { name: 'checkout', exact: true }).waitFor();
		assert.equal((await snapshot()).folder, initial.folder);
		assert.ok((await readFile(path.join(sourceRoot, 'checkout.ts'), 'utf8')).includes('purchase'));
		await writeFile(path.join(evidence, 'm4-code-results.json'), JSON.stringify({ imported: initial.state.files.length, dependencyCount: initial.state.semantic.dependencies.length, renamedId: previous.id, parsed: updated.state.analysis.parsed, reused: updated.state.analysis.reused, recovery: true, aiReviewed: true, modelToCode: true, pairedUndo: true, diagramProtocol: 'legacy', defaultExplorationUiVerified: true, incrementalEndToEnd: false }, null, 2));
		await harness.app.close(); harness.app = undefined;
		console.log('PASS: native code import, compiler references, AI-reviewed contract/rename/delete Sync, source navigation, restart and recovery (simulated provider).');
	}

	return { checkSemanticTodo, checkGeneratedDiagrams, checkCodeBridge };
}
