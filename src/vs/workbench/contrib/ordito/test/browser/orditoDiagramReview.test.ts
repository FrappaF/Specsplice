import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OrditoControls } from '../../browser/orditoControls.js';
import { IOrditoAiService, type OrditoDiagramLiveProgress, type OrditoDiagramReview } from '../../browser/orditoAiService.js';
import { renderOrditoDiagramReview } from '../../browser/orditoDiagramReview.js';
import { OrditoEditor } from '../../browser/orditoEditor.js';
import { OrditoWorkflowContent } from '../../browser/orditoWorkflowContent.js';
import { IOrditoProjectService, OrditoProjectService } from '../../browser/orditoProjectService.js';
import { IOrditoCodeService } from '../../browser/orditoCodeService.js';
import { type IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { type ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { type SemanticModel } from '../../common/modelTypes.js';
import { canonicalJson, semanticContent } from '../../common/modelSerialization.js';
import type { CodeContext, CodeDiagramExploration } from '../../common/codeBridge.js';
import { diagramCheckpointTimeoutSetting, diagramExplorationBudgetSetting } from '../../common/diagramExplorationSettings.js';

suite('Specsplice imported diagram review', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	setup(() => { root = dom.append(document.body, dom.$('section.ordito-shell')); });
	teardown(() => root.remove());

	function fixture() {
		const called: string[] = [];
		const review: OrditoDiagramReview = { id: 'draft', sessionId: 'session', root: '/project', modelUri: 'file:///project/model.json', semanticRevision: 'revision', proposal: { id: 'draft', status: 'ready', diagnostics: [], views: [{ id: 'overview', name: 'Overview', kind: 'structure', nodes: [], relationIds: [] }] }, changes: [{ collection: 'elements', id: 'api', before: null, after: { name: 'HTTP API' } }], sources: [{ file: 'src/api.ts', revision: 'revision', start: 0, end: 40 }], images: [], contents: '{}' };
		const actions = { busy: false, current: true, apply: () => called.push('apply'), refresh: () => called.push('refresh'), close: () => called.push('close'), technical: () => called.push('technical') };
		const controls = store.add(new OrditoControls());
		const render = () => controls.render(root, () => { root.textContent = ''; renderOrditoDiagramReview(root, review, controls, actions); });
		return { review, actions, called, render };
	}

	test('one surface explains local effects, evidence and limits before explicit application', () => {
		const f = fixture(); f.render();
		assert.deepStrictEqual(f.called, []);
		assert.deepStrictEqual([root.querySelector('details')!.open, !!root.querySelector('details .ordito-draft-changes'), root.querySelector('figure')!.parentElement?.className], [false, true, 'ordito-review-body']);
		for (const text of ['HTTP API', 'src/api.ts', 'complete coverage', 'Git', 'Other drafts remain available']) { assert.ok(root.textContent?.includes(text), text); }
		root.querySelector('button')!.click();
		assert.deepStrictEqual(f.called, ['apply']);
	});

	test('the import journey keeps four stable steps, a single next action and secondary details', () => {
		const exploration: CodeDiagramExploration = {
			sessionId: 'session', model: 'test', workflow: 'project', phase: 'discovery', tasks: [], proposals: [],
			budget: { maxToolCalls: 10, maxReadBytes: 1000, maxDurationMs: 1000, maxModelTurns: 10 },
			usage: { toolCalls: 2, readBytes: 100, modelTurns: [], turnsObservable: false, inputTokens: null, outputTokens: null }
		};
		const calls: string[] = [];
		const ai = Object.assign(new (mock<IOrditoAiService>())(), {
			available: true, busy: false, generatingDiagrams: false, diagramExploration: undefined as CodeDiagramExploration | undefined,
			diagramLiveProgress: { state: 'tool', startedAt: 1, updatedAt: 2, activeTool: 'ordito_source_read' } as OrditoDiagramLiveProgress,
			diagramActivity: [{ requestId: 'turn', kind: 'message' as const, text: 'Found the checkout module.' }],
			resumeDiagrams: async () => { calls.push('start'); }, stopDiagramExploration: () => { calls.push('stop'); },
			reviewDiagramProposal: async () => { calls.push('review'); }
		});
		const context: CodeContext = {
			diagramState: 'index', snapshot: 'snapshot', model: '/project/model.json', sourceRoot: '/project', revision: 'revision',
			scope: { include: [], exclude: [], excludedDirectories: [], respectGitignore: true, languageOverrides: {} },
			files: [{ path: 'src/checkout.mjs', language: 'JavaScript', status: 'parsed', diagnostics: [] }],
			declarations: [{ id: 'checkout', sourceId: 'checkout-source', name: 'checkout', kind: 'function', evidence: { file: 'src/checkout.mjs', revision: 'revision', start: 0, end: 24, line: 1, endLine: 1 } }],
			dependencies: [], providers: [], diagnostics: []
		};
		const code = Object.assign(new (mock<IOrditoCodeService>())(), { context, inspect: async () => { calls.push('inspect'); } });
		const model: SemanticModel = { version: 3, id: 'code:imported', name: 'Imported Project', semantics: { elements: [], relations: [] }, views: [], codeMappings: [], verifications: [] };
		const project = Object.assign(new (mock<OrditoProjectService>())(), { model, modelUri: URI.file(context.model) });
		const controls = store.add(new OrditoControls());
		const workflow = new OrditoWorkflowContent({
			root,
			paragraph: (parent, text) => { dom.append(parent, dom.$('p')).textContent = text; },
			button: (parent, label, action, id) => controls.button(parent, label, action, id),
			documentStatus: () => '',
			showReview: () => {}
		}, controls, project, ai, new TestConfigurationService(), new TestNotificationService(), code, new (mock<ICommandService>())());
		const draw = () => controls.render(root, () => { dom.clearNode(root); workflow.renderWorkflow(root, 'import'); });
		const journey = () => root.querySelector<HTMLElement>('.ordito-explore')!;
		const steps = () => [...journey().querySelectorAll('.ordito-explore-steps li')];
		const stepNames = () => steps().map(step => ['Inventory', 'Features', 'Diagrams', 'Review'].find(name => step.textContent?.trim().startsWith(name)));
		const currentStep = () => steps().findIndex(step => step.getAttribute('aria-current') === 'step');
		const mainActions = () => [...journey().querySelectorAll<HTMLButtonElement>('.ordito-primary-action')];
		const button = (name: string) => [...journey().querySelectorAll('button')].find(button => button.textContent === name)!;
		const disclosure = (name: string) => [...journey().querySelectorAll('details')].find(details => details.querySelector('summary .ordito-explore-detail-label')?.textContent === name)!;
		draw();
		assert.deepStrictEqual([...root.querySelectorAll('h1')].map(heading => heading.textContent), ['Explore Your Codebase']);
		assert.match(journey().querySelector('.ordito-explore-heading p')?.textContent ?? '', /1 indexed declaration$/);
		assert.deepStrictEqual(stepNames(), ['Inventory', 'Features', 'Diagrams', 'Review']);
		assert.deepStrictEqual(steps().map(step => step.getAttribute('data-state')), ['complete', 'current', 'pending', 'pending']);
		assert.deepStrictEqual(mainActions().map(action => action.textContent), ['Explore Architecture']);
		button('Inspect Code Evidence').click();
		button('Explore Architecture').click();

		ai.diagramExploration = exploration; ai.busy = true; ai.generatingDiagrams = true;
		draw();
		assert.equal(currentStep(), 1);
		const announcement = journey().querySelector('.ordito-explore-live[role="status"]')?.textContent ?? '';
		assert.match(announcement, /identif.*features/i);
		assert.ok(announcement.includes('Read source evidence') && !announcement.includes('Found the checkout module.'));
		const progress = journey().querySelector('progress.ordito-explore-progress');
		assert.ok(progress && !progress.hasAttribute('value'));
		const activity = disclosure('Activity Details');
		assert.ok(activity.textContent?.includes('Found the checkout module.'));
		assert.equal(activity.open, false);
		const log = activity.querySelector<HTMLOListElement>('ol.ordito-explore-log')!;
		assert.deepStrictEqual([log.tabIndex, log.getAttribute('aria-label')], [0, 'Recent activity']);
		activity.open = true;
		activity.querySelector('summary')!.focus();
		draw();
		assert.equal(disclosure('Activity Details').open, true);
		assert.equal(document.activeElement, disclosure('Activity Details').querySelector('summary'));
		disclosure('Activity Details').querySelector('summary')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		assert.equal(disclosure('Activity Details').open, false);
		assert.deepStrictEqual(calls, ['inspect', 'start']);
		assert.ok(mainActions().length <= 1);
		ai.diagramLiveProgress = { ...ai.diagramLiveProgress, retrying: true };
		draw();
		assert.ok(journey().querySelector('.ordito-explore-live')?.textContent?.includes('Resuming the saved step after the AI provider timed out.'));
		button('Stop Generation').click();
		ai.diagramLiveProgress = { ...ai.diagramLiveProgress, state: 'stopping', activeTool: undefined };
		draw();
		assert.ok(button('Stopping…').disabled);
		assert.ok(journey().querySelector('.ordito-explore-live')?.textContent?.includes('Keeping the progress already saved.'));

		exploration.featureCatalog = { revision: 'catalog', features: [{ id: 'purchase', name: 'Checkout', description: 'Confirm an order', evidenceIds: ['evidence'], dependsOn: [] }] };
		exploration.plan = { revision: 'plan', items: [
			{ id: 'overview', name: 'Order Overview', viewKind: 'structure', intent: 'Responsibilities', rationale: 'Sets boundaries', featureId: 'purchase', dependsOn: [] },
			{ id: 'activity', name: 'Order Flow', viewKind: 'activity', intent: 'Steps', rationale: 'Explains checkout', featureId: 'purchase', dependsOn: ['overview'] }
		] };
		exploration.featurePlans = [{ gaps: [] }, { featureId: 'purchase', gaps: [] }];
		exploration.tasks = [{ id: 'overview', status: 'ready', intent: 'Responsibilities', gaps: [] }, { id: 'activity', status: 'running', intent: 'Steps', gaps: [] }];
		exploration.nextFeatureId = 'purchase'; exploration.nextTaskId = 'activity'; exploration.phase = 'diagrams';
		ai.diagramLiveProgress = { ...ai.diagramLiveProgress, state: 'tool', retrying: false, activeTool: 'ordito_model_propose' };
		root.style.width = '460px'; root.classList.add('ordito-narrow', 'ordito-compact');
		draw();
		assert.equal(currentStep(), 2);
		const stage = journey().querySelector('.ordito-explore-stage')!;
		assert.ok(stage.textContent?.includes('Checkout') && stage.textContent.includes('Order Flow'));
		const measured = journey().querySelector<HTMLProgressElement>('progress.ordito-explore-progress')!;
		assert.deepStrictEqual([measured.value, measured.max], [1, 2]);
		const plan = disclosure('Features and Diagram Plan');
		assert.equal(plan.open, false);
		plan.open = true;
		assert.ok(plan.textContent?.includes('Checkout') && plan.textContent.includes('Order Flow'));
		assert.ok(root.scrollWidth <= root.clientWidth, `journey overflows at narrow width: ${root.scrollWidth}/${root.clientWidth}`);

		exploration.nextTaskId = undefined;
		for (const task of exploration.tasks) { task.status = 'ready'; task.proposalId = task.id; }
		exploration.proposals = exploration.plan.items.map(item => ({ id: item.id, status: 'ready', diagnostics: [], views: [{ id: item.id, name: item.name, kind: item.viewKind, nodes: [], relationIds: [] }] }));
		for (const [phase, title, tool] of [
			['audit', 'Checking diagrams against the codebase', 'ordito_audit_inventory'],
			['repair', 'Correcting diagrams from the audit', 'ordito_audit_repair']
		] as const) {
			exploration.phase = phase;
			ai.diagramLiveProgress = { ...ai.diagramLiveProgress, activeTool: tool };
			draw();
			assert.deepStrictEqual([currentStep(), journey().querySelector('.ordito-explore-live h2')?.textContent, button('Review All Changes')], [2, title, undefined]);
		}

		ai.busy = false; ai.generatingDiagrams = false;
		exploration.phase = 'review';
		draw();
		assert.equal(currentStep(), 3);
		assert.deepStrictEqual(mainActions().map(action => action.textContent), ['Review All Changes']);
		button('Review All Changes').click();
		assert.deepStrictEqual(calls, ['inspect', 'start', 'stop', 'review']);
	});

	test('the project review groups previews by canonical feature ID and retains feature exclusions', () => {
		const f = fixture();
		f.review.projectReviewId = 'batch';
		f.review.proposal.views[0].featureId = 'checkout-element';
		f.review.proposal.views.push({ id: 'returns', name: 'Returns', kind: 'structure', featureId: 'returns-element', nodes: [], relationIds: [] });
		f.review.featureCatalog = { revision: 'catalog', features: [
			{ id: 'purchase', elementId: 'checkout-element', name: 'Checkout', description: 'Confirm an order', evidenceIds: ['evidence'], dependsOn: [] },
			{ id: 'return', elementId: 'returns-element', name: 'Returns', description: 'Return an order', evidenceIds: ['evidence'], dependsOn: ['purchase'] }
		] };
		f.review.plan = { revision: 'plan', items: [] };
		f.review.featurePlans = [{ featureId: 'return', gaps: ['Refund settlement is outside the imported source.'] }];
		f.render();
		assert.deepStrictEqual([...root.querySelectorAll('.ordito-review-feature')].map(section => [section.querySelector('h3')?.textContent, section.querySelector('figcaption')?.textContent]), [['Checkout', 'Overview'], ['Returns', 'Returns']]);
		assert.ok(root.textContent?.includes('Returns · Refund settlement is outside the imported source.'));
	});

	test('the independent audit report shows the corrections and their source before applying', () => {
		const f = fixture();
		f.review.projectReviewId = 'batch';
		f.review.sources[0].id = 'source-api';
		f.review.auditReport = { summary: 'Compared API behavior and diagrams.', findings: [
			{ id: 'shared-archive', category: 'inconsistent', summary: 'The archive is shared.', recommendation: 'Reuse the same archive element in Overview.', viewIds: ['overview'], evidenceIds: ['source-api'], resolution: 'Reused the existing archive ID.' }
		] };
		f.render();
		const report = root.querySelector('.ordito-review-coverage')!;
		assert.deepStrictEqual([...report.querySelectorAll('h3, summary, strong, p')].map(node => node.textContent), [
			'Codebase Audit Report', 'Compared API behavior and diagrams.', 'Audit Findings (1)', 'Inconsistency · The archive is shared.', 'Reuse the same archive element in Overview.', 'Draft correction · Reused the existing archive ID.', 'Diagrams · Overview', 'Sources · src/api.ts'
		]);
		assert.deepStrictEqual(f.called, []);
	});

	for (const projectWorkflow of [false, true]) {
	test(`${projectWorkflow ? 'Review All Changes' : 'Review Draft'} opens an actionable review from the imported project Home and returns to exploration`, async () => {
		const f = fixture();
		const configuration = new TestConfigurationService();
		const instantiation = workbenchInstantiationService({ configurationService: () => configuration }, store);
		const changed = store.add(new Emitter<void>());
		const model: SemanticModel = { version: 3, id: 'code:imported', name: 'Imported Project', semantics: { elements: [], relations: [] }, views: [], codeMappings: [], verifications: [] };
		if (projectWorkflow) {
			f.review.projectReviewId = 'project-seal'; f.review.proposal.views.push({ ...f.review.proposal.views[0], id: 'details', name: 'Details' });
			f.review.plan = { revision: 'plan', items: f.review.proposal.views.map(view => ({ id: view.id, name: view.name, viewKind: view.kind, intent: 'Explain this scope', rationale: 'Relevant to the project', dependsOn: view.id === 'details' ? ['overview'] : [] })) };
			f.review.tasks = f.review.plan.items.map(item => ({ id: item.id, intent: item.intent, status: 'ready', gaps: [] }));
		}
		f.review.semanticRevision = canonicalJson(semanticContent(model));
		const project = Object.assign(new (mock<OrditoProjectService>())(), { model, modelUri: URI.parse(f.review.modelUri), section: 'home', selectedId: '', diagnostics: [], onDidChange: Event.None, restore: async () => {} });
		const exploration: CodeDiagramExploration = { ...(projectWorkflow ? { workflow: 'project' as const, batch: { blockers: [] } } : {}), sessionId: 'session', model: 'test', proposals: [f.review.proposal], plan: f.review.plan, tasks: f.review.tasks ?? [], usage: { toolCalls: 1, readBytes: 100, modelTurns: [], turnsObservable: false, inputTokens: null, outputTokens: null }, budget: { maxToolCalls: 80, maxReadBytes: 1048576, maxDurationMs: 1800000, maxModelTurns: 8 } };
		let timeoutSettingsOpened = 0;
		let budgetSettingsOpened = 0;
		const ai = Object.assign(new (mock<IOrditoAiService>())(), {
			available: true, onDidChange: changed.event, diagramReview: undefined as OrditoDiagramReview | undefined,
			diagramExploration: exploration as CodeDiagramExploration | undefined,
			configureDiagramCheckpointTimeout: async () => { timeoutSettingsOpened++; },
			configureDefaultDiagramBudget: async () => { budgetSettingsOpened++; },
			refreshConnection: async () => {},
			reviewDiagramProposal: async () => { ai.diagramReview = f.review; changed.fire(); },
			applyDiagramReview: async () => { f.called.push('apply'); },
			closeDiagramReview: () => { ai.diagramReview = undefined; changed.fire(); }
		});
		instantiation.stub(IOrditoProjectService, project);
		instantiation.stub(IOrditoAiService, ai);
		const code = Object.assign(new (mock<IOrditoCodeService>())(), { onDidChange: Event.None, context: { diagramState: 'index' } });
		instantiation.stub(IOrditoCodeService, code);
		const editor = store.add(instantiation.createInstance(OrditoEditor, Object.assign(new (mock<IEditorGroup>())(), { id: 1, windowId: 1 })));
		editor.create(root);
		const button = (name: string) => [...root.querySelectorAll('button')].find(button => button.textContent === name)!;
		const reviewLabel = projectWorkflow ? 'Review All Changes' : 'Review Draft', applyLabel = projectWorkflow ? 'Apply All Changes' : 'Apply to Project';
		if (projectWorkflow) { assert.equal(button('Review Draft'), undefined); assert.ok(root.textContent?.includes('Diagram Plan')); }
		button(reviewLabel).click();
		assert.ok(root.querySelector('.ordito-review-mode'), 'the ready review must replace the import landing page');
		assert.equal(button(applyLabel).disabled, false);
		assert.equal(root.querySelectorAll('figure.ordito-review-preview').length, projectWorkflow ? 2 : 1);
		assert.ok(editor.describeCurrentContext().includes('Overview'));
		assert.deepStrictEqual(f.called, []);
		button(applyLabel).click();
		assert.deepStrictEqual(f.called, ['apply']);
		button('Return to Exploration').click();
		assert.deepStrictEqual([!!button(reviewLabel), project.section, project.model], [true, 'home', model]);
		button('Project Settings').click();
		assert.ok(root.textContent?.includes('Open and Save'));
		assert.equal(root.querySelector('.ordito-tools'), null, 'settings do not duplicate document status');
		editor.showWorkspace(); assert.ok(button(reviewLabel), 'explicit diagram navigation returns from project settings');
		button('AI Settings').click();
		assert.deepStrictEqual([...root.querySelectorAll('.ordito-action-group h2')].map(node => node.textContent), ['Account and Model', 'AI Requests', 'Diagram Generation']);
		assert.ok(button('Configure AI Request Budget'));
		ai.diagramExploration = undefined; changed.fire();
		const timeoutSettings = button('Set Diagram Attempt Time Limit');
		const generationSettings = timeoutSettings.closest('.ordito-action-group');
		assert.deepStrictEqual([generationSettings?.querySelector('h2')?.textContent, timeoutSettings.disabled, generationSettings?.textContent?.includes('20 minutes per attempt')], ['Diagram Generation', false, true]);
		timeoutSettings.click();
		assert.equal(timeoutSettingsOpened, 1);
		const budgetSettings = button('Set Default Exploration Budget');
		assert.deepStrictEqual([budgetSettings.disabled, generationSettings?.textContent?.includes('800 local tool calls'), button('Add Exploration Budget').disabled], [false, true, true]);
		budgetSettings.click();
		assert.equal(budgetSettingsOpened, 1);
		await configuration.setUserConfiguration(diagramCheckpointTimeoutSetting, 35);
		await configuration.setUserConfiguration(diagramExplorationBudgetSetting, { maxToolCalls: 900, maxReadBytes: 20 * 1024 * 1024, maxDurationMs: 240 * 60_000, maxModelTurns: 70 });
		const keys = [diagramCheckpointTimeoutSetting, diagramExplorationBudgetSetting];
		configuration.onDidChangeConfigurationEmitter.fire({
			source: ConfigurationTarget.USER,
			affectedKeys: new Set(keys),
			change: { keys, overrides: [] },
			affectsConfiguration: key => keys.includes(key)
		});
		const updatedText = button('Set Diagram Attempt Time Limit').closest('.ordito-action-group')?.textContent ?? '';
		assert.deepStrictEqual([updatedText.includes('35 minutes per attempt'), updatedText.includes('20 minutes per attempt')], [true, false]);
		assert.ok(updatedText.includes('900 local tool calls'));
		ai.diagramExploration = exploration; changed.fire();
		editor.showWorkspace();
		assert.ok(button(reviewLabel), 'returning to the workspace preserves the saved review');

		// Applying the saved review must leave the diagram usable, including after reopening the editor.
		model.id = 'semantic:imported';
		model.semantics.elements.push({ id: 'api', name: 'HTTP API', kind: 'component' });
		const view = { ...f.review.proposal.views[0], nodes: [{ elementId: 'api', x: 0, y: 0 }] };
		model.views.push(view);
		Object.assign(project, { section: 'diagram', activeView: view });
		code.context.diagramState = 'diagrams';
		const apply = () => { for (const proposal of exploration.proposals) { proposal.status = 'applied'; } for (const task of exploration.tasks) { task.status = 'applied'; } };
		apply(); changed.fire();
		const assertAppliedCanvas = () => {
			assert.ok(root.querySelector('.ordito-canvas-mode .ordito-node'), 'the applied diagram remains on the canvas');
			assert.equal(root.querySelector('.ordito-workflow, .ordito-floating-workflow, .ordito-explore'), null, 'generation history never overlays the diagram');
			assert.equal(root.querySelector('.ordito-floating-menu .ordito-primary-action'), null, 'applied work does not request more generation');
			assert.equal(button('Continue Exploration'), undefined); assert.equal(button('Continue Generation'), undefined);
			assert.ok(button('Code'), 'code workflows have their own destination');
		};
		assertAppliedCanvas();
		button('Code').click();
		assert.ok(root.textContent?.includes('All Diagram Changes Applied'));
		assert.equal(button('Review All Changes'), undefined, 'a completed review does not leave a disabled review action');
		if (projectWorkflow) {
			const plan = [...root.querySelectorAll('details')].find(details => details.querySelector('summary .ordito-explore-detail-label')?.textContent === 'Diagram Plan')!;
			assert.equal(plan.open, false); plan.open = true;
			assert.deepStrictEqual([...plan.querySelector('.ordito-explore-view')!.children].map(element => element.textContent).filter(Boolean), ['Overview', 'Structure', 'Applied']);
		}
		editor.showWorkspace(); assertAppliedCanvas();
		Object.assign(code, { changed: true }); changed.fire(); button('Code').click();
		assert.ok(button('Update Diagrams').classList.contains('ordito-primary-action'), 'source changes have a specific action');
		Object.assign(code, { changed: false });
		exploration.proposals[0].status = 'invalid';
		if (projectWorkflow) { exploration.batch!.blockers = ['invalidDraft:draft']; exploration.tasks[0].status = 'running'; }
		changed.fire();
		assert.ok(button(projectWorkflow ? 'Continue Generation' : 'Continue Exploration').classList.contains('ordito-primary-action'));
		editor.showWorkspace(); assert.equal(root.querySelector('.ordito-workflow, .ordito-explore'), null, 'unfinished work also keeps the canvas clear');
		exploration.proposals[0].status = 'ready';
		if (projectWorkflow) { exploration.batch!.blockers = []; exploration.tasks[0].status = 'ready'; }
		changed.fire(); button('Code').click();
		assert.ok(button(reviewLabel).classList.contains('ordito-primary-action'), 'prepared drafts lead directly to review');
		apply(); editor.dispose(); root.textContent = '';
		const restored = store.add(instantiation.createInstance(OrditoEditor, Object.assign(new (mock<IEditorGroup>())(), { id: 1, windowId: 1 })));
		restored.create(root); assertAppliedCanvas();
	});

	}

	test('invalid or stale drafts cannot apply and their review remains consultable', () => {
		const f = fixture();
		for (const state of ['invalid', 'stale', 'problem'] as const) {
			f.review.proposal.status = state === 'invalid' ? 'invalid' : 'ready';
			f.actions.current = state !== 'stale'; f.review.problem = state === 'problem' ? 'staleEvidenceRevision' : undefined;
			f.render(); root.querySelector('button')!.click();
			assert.deepStrictEqual([root.querySelector('button')!.disabled, f.called, !!root.querySelector('[role="alert"]'), root.querySelector('details')!.open], [true, [], true, false]);
		}
	});

	test('nested source-staleness failures show one readable reason without evidence identifiers', () => {
		const f = fixture();
		f.review.problem = 'projectNotReady:staleEvidence:evidence:opaque-hash';
		f.review.proposal.status = 'invalid';
		f.review.proposal.diagnostics = [{ code: 'contract', path: '/review', args: ['staleEvidence:evidence:opaque-hash'] }];
		f.render();
		const alert = root.querySelector('[role="alert"]')!;
		const explanation = alert.querySelector('dd')?.textContent ?? '';
		assert.ok(explanation.includes('Source Files Changed After Analysis'));
		assert.ok(!explanation.includes('opaque-hash'));
		assert.ok(!explanation.includes('projectNotReady'));
		assert.deepStrictEqual([alert.querySelectorAll('dd').length, alert.querySelector('details')?.open, alert.querySelector('pre')?.textContent], [2, false, f.review.problem]);
	});

	test('hostile review labels remain text; busy operations disable mutation and refresh', () => {
		const f = fixture(); f.review.changes[0].after!.name = '<script>bad()</script>'; f.actions.busy = true; f.render();
		assert.deepStrictEqual([root.querySelector('script'), [...root.querySelectorAll('button')].every(button => button.disabled)], [null, true]);
	});

	test('application blockers name the incomplete planned diagram beside the disabled button', () => {
		const f = fixture();
		f.review.projectReviewId = 'batch';
		f.review.plan = { revision: 'plan', items: [{ id: 'data', name: 'Todo Data Model', viewKind: 'structure', rationale: 'Persistence responsibilities', intent: 'Storage', dependsOn: [] }] };
		f.review.proposal.status = 'invalid'; f.review.proposal.diagnostics = [{ code: 'contract', path: '/project', args: ['plannedDiagramIncomplete:data'] }];
		f.render();
		const reason = root.querySelector('.ordito-review-blockers')!;
		assert.deepStrictEqual([root.querySelector('button')!.disabled, reason.closest('details'), reason.textContent?.includes('Todo Data Model Is Not Ready'), root.querySelector('button')!.getAttribute('aria-describedby')], [true, null, true, reason.id]);
	});
});
