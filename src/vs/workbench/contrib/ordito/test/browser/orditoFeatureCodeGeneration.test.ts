import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { type FeatureCodeGenerationRequest, type FeatureCodeGenerationRun, featureCodeProfiles } from '../../common/featureCodeGeneration.js';
import { type SemanticModel } from '../../common/modelTypes.js';
import { IOrditoAiService } from '../../browser/orditoAiService.js';
import { IOrditoCodeService } from '../../browser/orditoCodeService.js';
import { OrditoControls } from '../../browser/orditoControls.js';
import { OrditoEditor } from '../../browser/orditoEditor.js';
import { OrditoFeatureCodeGeneration } from '../../browser/orditoFeatureCodeGeneration.js';
import { IOrditoProjectService, type OrditoProjectService } from '../../browser/orditoProjectService.js';
import { type IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';

suite('Specsplice. AI code generation', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	setup(() => { root = dom.append(document.body, dom.$('section.ordito-shell')); });
	teardown(() => root.remove());

	const model: SemanticModel = {
		version: 3, id: 'store', name: 'Store',
		semantics: { elements: [{ id: 'checkout', kind: 'feature', name: 'Checkout' }, { id: 'returns', kind: 'feature', name: 'Returns' }], relations: [] },
		views: [{ id: 'return-flow', name: 'Return Processing', kind: 'activity', nodes: [], relationIds: [] }], codeMappings: [], verifications: []
	};

	function createUi(overrides: Partial<IOrditoAiService>) {
		const project = Object.assign(new (mock<OrditoProjectService>())(), { model, modelUri: URI.file('/store/.ordito/model.json'), projectRoot: URI.file('/store'), documentVersion: '1' });
		const ai = Object.assign(new (mock<IOrditoAiService>())(), overrides);
		return store.add(new OrditoFeatureCodeGeneration(project, ai, () => root));
	}

	function button(label: string): HTMLButtonElement {
		const result = Array.from(root.querySelectorAll('button')).find(button => button.textContent === label || button.getAttribute('aria-label') === label);
		assert.ok(result, `Missing button ${label}`);
		return result;
	}

	function until(ready: () => boolean): Promise<void> {
		if (ready()) { return Promise.resolve(); }
		return new Promise(resolve => {
			const observer = new MutationObserver(() => { if (ready()) { observer.disconnect(); resolve(); } });
			store.add(toDisposable(() => observer.disconnect()));
			observer.observe(root, { subtree: true, childList: true, characterData: true });
		});
	}

	test('a source-less project launches only after an explicit stack and feature review', async () => {
		const requests: FeatureCodeGenerationRequest[] = [];
		const ui = createUi({ inspectCodeGeneration: async () => ({ mode: 'create', profiles: featureCodeProfiles, defaultProfileId: 'node.esm' }), prepareCodeGeneration: async request => { requests.push(request); } });
		const pending = ui.configure();
		const page = (label: string) => until(() => root.querySelector('h3')?.textContent === label);
		await page('Choose Stack');
		assert.ok(root.querySelector('dialog')?.textContent?.includes('JavaScript · Node.js 24.22.1 · No Framework'));
		button('Next').click(); await page('Select Features');
		const choices = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
		for (const choice of choices) { choice.click(); }
		button('Next').click(); await until(() => !!root.querySelector('.ordito-error-notice'));
		choices[1].click();
		button('Next').click(); await page('Implementation Notes');
		root.querySelector<HTMLInputElement>('input[type="text"]')!.value = 'Preserve refund amounts.';
		button('Next').click(); await page('Independent Verification Cases');
		const cases = [{ id: 'refund', featureId: 'returns', input: { amount: 25 }, expected: { refund: 25 } }];
		root.querySelector('textarea')!.value = JSON.stringify({ version: 1, cases });
		button('Next').click(); await page('Review Code Generation');
		assert.deepStrictEqual(requests, []);
		button('Prepare Code Changes').click(); await pending;
		assert.deepStrictEqual(requests, [{ featureIds: ['returns'], profileId: 'node.esm', intent: 'Preserve refund amounts.', cases }]);
		assert.equal(root.querySelector('dialog'), null);
	});

	test('review groups features and blocks application until verification passes', () => {
		const calls: string[] = [];
		const ui = createUi({
			openCodeGenerationDiff: async path => { calls.push(path); }, verifyCodeGeneration: async () => { calls.push('verify'); },
			applyCodeGeneration: async () => { calls.push('apply'); }, cancelCodeGeneration: async () => { calls.push('stop'); },
			resumeCodeGeneration: async () => { calls.push('repair'); }
		});
		const run: FeatureCodeGenerationRun = {
			id: 'run', root: '/store', mode: 'create', profileId: 'node.esm', status: 'generating', featureIds: ['checkout', 'returns'],
			tasks: [{ id: 'checkout', name: 'Checkout', status: 'ready', gaps: [] }, { id: 'returns', name: 'Returns', status: 'running', gaps: [], diagramIds: ['return-flow'], criterionIds: ['approved-order'] }],
			files: [{ file: 'package.json', kind: 'create' }, { file: 'src/returns.mjs', kind: 'create', featureId: 'returns' }]
		};
		const controls = store.add(new OrditoControls());
		ui.renderProgress(root, run, controls, true);
		assert.deepStrictEqual([root.querySelector('[role=status]')?.textContent, root.querySelector('details')?.open], ['Preparing Code · Returns', false]);
		button('Stop Generation').click();
		run.status = 'ready'; run.reviewId = 'review'; run.tasks[1].status = 'ready';
		const draw = () => controls.render(root, () => { dom.clearNode(root); ui.renderReview(root, run, controls, false, () => {}); });
		draw();
		assert.ok(root.textContent?.includes('Return Processing') && root.textContent.includes('approved-order') && root.textContent.includes('Shared Project Files'));
		assert.ok(button('Apply to Project').disabled);
		button('Apply to Project').click(); button('Open Diff for src/returns.mjs').click(); button('Run Verification').click();
		run.status = 'failed'; run.verification = { passed: false, cases: [{ id: 'refund', featureId: 'returns', passed: false, message: 'Unexpected amount' }] };
		draw();
		assert.ok(button('Apply to Project').disabled);
		const verificationCase = () => root.querySelector('.ordito-feature-code-cases li');
		assert.deepStrictEqual([
			verificationCase()?.querySelector('code')?.textContent,
			verificationCase()?.querySelector('.ordito-explore-tag')?.textContent,
			verificationCase()?.querySelector('p')?.textContent
		], ['refund', 'Failed', 'Unexpected amount']);
		button('Repair Failing Features').click();
		run.status = 'verified'; run.verification = { passed: true, cases: [{ id: 'refund', featureId: 'returns', passed: true }], output: 'One independent case passed' };
		draw();
		assert.equal(button('Apply to Project').disabled, false);
		assert.equal(verificationCase()?.querySelector('.ordito-explore-tag')?.textContent, 'Passed');
		button('Apply to Project').click();
		assert.deepStrictEqual(calls, ['stop', 'src/returns.mjs', 'verify', 'repair', 'apply']);
		run.files = [];
		draw();
		assert.deepStrictEqual(Array.from(root.querySelectorAll('[role=status] > *'), element => element.textContent), ['Verification Passed', 'No file changes to apply.']);
		assert.ok(!Array.from(root.querySelectorAll('button')).some(button => button.textContent === 'Apply to Project'));
	});

	test('the reviewed code command opens a saved review and permits fresh preparation from Code', async () => {
		const instantiation = workbenchInstantiationService(undefined, store);
		const run: FeatureCodeGenerationRun = { id: 'run', root: '/store', mode: 'create', profileId: 'node.esm', status: 'ready', reviewId: 'review', featureIds: ['returns'], tasks: [{ id: 'returns', name: 'Returns', status: 'ready', gaps: [] }], files: [] };
		const project = Object.assign(new (mock<OrditoProjectService>())(), { model, modelUri: URI.file('/store/.ordito/model.json'), projectRoot: URI.file('/store'), editable: true, section: 'home', selectedId: '', onDidChange: Event.None, restore: async () => {} });
		const ai = Object.assign(new (mock<IOrditoAiService>())(), { available: true, codeGeneration: run, codeGenerationProblem: 'The saved model has changed.', inspectCodeGeneration: async () => ({ mode: 'create' as const, profiles: featureCodeProfiles }), onDidChange: Event.None, refreshConnection: async () => {} });
		instantiation.stub(IOrditoProjectService, project);
		instantiation.stub(IOrditoAiService, ai);
		instantiation.stub(IOrditoCodeService, Object.assign(new (mock<IOrditoCodeService>())(), { onDidChange: Event.None }));
		const editor = store.add(instantiation.createInstance(OrditoEditor, Object.assign(new (mock<IEditorGroup>())(), { id: 1, windowId: 1 })));
		editor.create(root);
		button('Code').click();
		await editor.prepareReviewedCodeFromDiagrams();
		assert.ok(root.querySelector('.ordito-review-mode'));
		assert.ok(editor.describeCurrentContext().includes('AI Code Review'));
		button('Back to Code').click();
		assert.equal(document.activeElement, button('Review AI Code Changes'));
		button('Prepare New Code Changes').click();
		await until(() => root.querySelector('dialog h3')?.textContent === 'Choose Stack');
		button('Cancel').click();
		await until(() => !root.querySelector('dialog'));
		assert.equal(button('Review AI Code Changes').disabled, false);
	});
});
