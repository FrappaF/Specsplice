import assert from 'assert';
import { notationNodeSize } from '../../common/diagramLayout.js';
import { messagingFixture } from '../common/messagingFixture.js';
import { blueprintFixture } from '../common/blueprintFixture.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IQuickInputService, type IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { runOrditoDiagramCommand } from '../../browser/orditoEditingDiagram.js';
import { type OrditoEditingContext } from '../../browser/orditoEditingContext.js';
import { OrditoProjectService } from '../../browser/orditoProjectService.js';
import { emptyFoundation } from '../../common/modelFoundation.js';
import { type SemanticModel, type ModelView, type SemanticModelV5 } from '../../common/modelTypes.js';
import { applyVisualEdit } from '../../common/visualEditing.js';
import { type VisualEdit } from '../../common/visualEditTypes.js';
import { validateSemanticModel } from '../../common/modelValidation.js';

suite('Specsplice project diagram creation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	let parent: HTMLElement;
	setup(() => { parent = document.body.appendChild(document.createElement('div')); });
	teardown(() => { parent.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true })); parent.remove(); });
	const field = (label: string) => {
		const row = [...parent.querySelectorAll('label')].find(row => row.querySelector('span')?.textContent === label);
		const input = row?.querySelector<HTMLInputElement | HTMLSelectElement>('input, select'); assert.ok(input, `Missing field ${label}`); return input;
	};
	const fill = (label: string, value: string) => { const input = field(label); input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); };
	const create = () => { const button = parent.querySelector<HTMLButtonElement>('button[type="submit"]'); assert.ok(button); button.click(); };
	test('a new class in a scoped contract diagram is declared context and keeps the contract intact', async () => {
		const model = structuredClone(blueprintFixture), view = model.views.find(view => view.kind === 'class')!, contracts = structuredClone(model.foundation.blueprint);
		const project = Object.assign(new (mock<OrditoProjectService>())(), { model, selectedId: '', activeView: view, selectElement: (id: string) => { project.selectedId = id; } });
		const ui = Object.assign(new (mock<OrditoEditingContext>())(), { container: parent, project, quickInput: Object.assign(new (mock<IQuickInputService>())(), { pick: async (items: (IQuickPickItem & { kind?: string })[]) => items.find(item => item.kind === 'class') }), name: async () => 'QA Class', edit: (edit: VisualEdit) => { project.model = applyVisualEdit(project.model, edit) as typeof model; } });
		const pending = runOrditoDiagramCommand(ui, 'addElement'); fill('Name', 'QA Class'); fill('Element Type', 'class'); create(); await pending; assert.deepStrictEqual(validateSemanticModel(project.model), []);
		assert.ok(project.model.views.find(candidate => candidate.id === view.id)!.contextIds?.includes(project.selectedId)); assert.deepStrictEqual(project.model.foundation.blueprint, contracts);
	});

	test('including an existing sibling container declares context without changing its ownership', async () => {
		const model = structuredClone(blueprintFixture), owners = structuredClone(model.foundation.ownership);
		const project = Object.assign(new (mock<OrditoProjectService>())(), { model, selectedId: '', activeView: model.views.find(view => view.id === 'c4.l3'), selectElement: (id: string) => { project.selectedId = id; } });
		const before = structuredClone(project.activeView!.nodes);
		const ui = Object.assign(new (mock<OrditoEditingContext>())(), { container: parent, project, quickInput: Object.assign(new (mock<IQuickInputService>())(), { pick: async (items: (IQuickPickItem & { element?: { id: string } })[]) => items.find(item => item.element?.id === 'container.store') }), edit: (edit: VisualEdit) => { project.model = applyVisualEdit(project.model, edit) as typeof model; } });
		await runOrditoDiagramCommand(ui, 'addExisting');
		assert.deepStrictEqual(validateSemanticModel(project.model), []); assert.deepStrictEqual(project.model.foundation.ownership, owners);
		const view = project.model.views.find(view => view.id === 'c4.l3')!; assert.ok(view.contextIds?.includes('container.store'));
		assert.deepStrictEqual(view.nodes.filter(node => node.elementId !== 'container.store'), before);
	});

	test('including a shared participant and creating a message edits the scenario behind both generated diagrams', async () => {
		const nodes = ['client', 'server'].map((elementId, index) => ({ elementId, x: index * 260, y: 0 }));
		const model: SemanticModelV5 = {
			version: 5, id: 'project', name: 'Mercato',
			semantics: { elements: [{ id: 'client', name: 'Client', kind: 'actor' }, { id: 'server', name: 'Server', kind: 'component' }, { id: 'outbox', name: 'Outbox', kind: 'resource' }], relations: [] },
			views: (['sequence', 'activity'] as const).map(kind => ({ id: kind, name: 'Read Events', kind, nodes, relationIds: [], interactionId: 'read' })),
			foundation: { ...emptyFoundation(), interactions: [{ id: 'read', profile: 'descriptive', occurrenceIds: [], frameIds: [], description: { trigger: 'Read events', scope: 'HTTP request', participantIds: ['client', 'server'], evidenceIds: [], order: [] } }] },
			codeMappings: [], verifications: []
		};
		const project = Object.assign(new (mock<OrditoProjectService>())(), { model, selectedId: 'server', activeView: model.views[0], selectElement: (id: string) => { project.selectedId = id; } });
		const ui = Object.assign(new (mock<OrditoEditingContext>())(), {
			container: parent, project,
			quickInput: Object.assign(new (mock<IQuickInputService>())(), { pick: async (items: (IQuickPickItem & { element?: { id: string } })[]) => items.find(item => item.element?.id === 'outbox') }),
			edit: (change: VisualEdit) => { project.model = applyVisualEdit(project.model, change) as SemanticModelV5; project.activeView = project.model.views[0]; }
		});
		await runOrditoDiagramCommand(ui, 'addExisting');
		const pending = runOrditoDiagramCommand(ui, 'connect', 'server');
		fill('Name', 'List events'); fill('To', 'outbox'); create(); await pending;
		const scenario = project.model.foundation.interactions[0];
		assert.deepStrictEqual({
			participants: scenario.description?.participantIds,
			authored: scenario.authored,
			linkedViews: project.model.views.map(view => view.nodes.map(node => node.elementId)),
			occurrence: project.model.foundation.occurrences.find(occurrence => occurrence.id === project.selectedId),
			errors: validateSemanticModel(project.model).filter(diagnostic => diagnostic.severity === 'error')
		}, {
			participants: ['client', 'server', 'outbox'],
			authored: true,
			linkedViews: [['client', 'server', 'outbox'], ['client', 'server', 'outbox']],
			occurrence: { id: project.selectedId, profile: 'descriptive', name: 'List events', from: 'server', to: 'outbox', evidenceIds: [] }, errors: []
		});
	});

	test('a new wide card avoids existing geometry without rearranging authored positions', () => {
		const model = structuredClone(messagingFixture), before = structuredClone(model.views[0].nodes);
		const next = applyVisualEdit(model, { kind: 'element', id: 'wide', viewId: model.views[0].id, name: 'A deliberately long container name that needs the widest supported card', elementKind: 'container' });
		const view = next.views[0], node = view.nodes.find(node => node.elementId === 'wide')!, size = notationNodeSize(next.semantics.elements.find(element => element.id === 'wide')!);
		assert.deepStrictEqual(view.nodes.filter(node => node.elementId !== 'wide'), before);
		for (const previous of before) { const box = { ...previous, ...notationNodeSize(next.semantics.elements.find(element => element.id === previous.elementId)!) }; assert.ok(node.x >= box.x + box.width || node.x + size.width <= box.x || node.y >= box.y + box.height || node.y + size.height <= box.y, previous.elementId); }
	});
	for (const [viewId, kind, ownerId] of [['c4.l2', 'container', 'system.shop'], ['c4.l2', 'resource', 'system.shop'], ['c4.l2', 'dataStore', 'system.shop'], ['c4.l3', 'container', 'system.shop'], ['c4.l3', 'component', 'container.api'], ['c4.l1', 'actor', undefined], ['c4.l1', 'system', undefined], ['c4.l2', 'actor', undefined]] as const) {
		test(`adding ${kind} to ${viewId} keeps the scoped architecture usable`, async () => {
			const model = structuredClone(blueprintFixture);
			const project = Object.assign(new (mock<OrditoProjectService>())(), { model, selectedId: '', activeView: model.views.find(view => view.id === viewId), selectElement: (id: string) => { project.selectedId = id; } });
			const ui = Object.assign(new (mock<OrditoEditingContext>())(), { container: parent, project, quickInput: Object.assign(new (mock<IQuickInputService>())(), { pick: async (items: (IQuickPickItem & { kind?: string })[]) => items.find(item => item.kind === kind) }), name: async () => 'QA Scoped Element', edit: (edit: VisualEdit) => { project.model = applyVisualEdit(project.model, edit) as typeof model; } });
			const pending = runOrditoDiagramCommand(ui, 'addElement'); fill('Name', 'QA Scoped Element'); fill('Element Type', kind); create(); await pending;
			assert.deepStrictEqual(validateSemanticModel(project.model), []);
			const element = project.model.semantics.elements.find(element => element.id === project.selectedId)!;
			assert.strictEqual(element.kind, kind);
			assert.strictEqual(project.model.foundation.ownership.find(entry => entry.elementId === element.id)?.ownerId, ownerId);
			if (!ownerId || viewId === 'c4.l3' && kind === 'container') { assert.ok(project.model.views.find(view => view.id === viewId)!.contextIds?.includes(element.id)); if (kind === 'system') { assert.strictEqual(element.scope, 'external'); } }
		});
	}
	for (const kind of ['structure', 'state'] as const) {
		test(`an empty project can create a ${kind} diagram without requiring a preexisting feature`, async () => {
			const model: SemanticModel = { version: 5, id: 'project', name: 'Project', semantics: { elements: [], relations: [] }, views: [], foundation: emptyFoundation(), codeMappings: [], verifications: [] };
			const project = Object.assign(new (mock<OrditoProjectService>())(), { model: model as SemanticModel, selectedId: '', activeView: undefined as ModelView | undefined, showDiagram: (id: string) => { Object.assign(project, { activeView: project.model.views.find(view => view.id === id) }); } });
			const edits: VisualEdit[] = [];
			const ui = Object.assign(new (mock<OrditoEditingContext>())(), {
				container: parent, project,
				quickInput: Object.assign(new (mock<IQuickInputService>())(), { pick: async (items: (IQuickPickItem & { kind?: string })[]) => items.find(item => item.kind === kind) ?? items[0] }),
				feature: async () => { assert.fail('the empty project must not open an empty feature picker'); },
				name: async () => 'New Diagram',
				edit: (value: VisualEdit | VisualEdit[]) => { const batch = Array.isArray(value) ? value : [value]; edits.push(...batch); for (const edit of batch) { project.model = applyVisualEdit(project.model, edit); } }
			});
			const pending = runOrditoDiagramCommand(ui, 'addDiagram'); fill('Name', 'New Diagram'); fill('Diagram Type', kind); if (kind === 'state') { fill('Resource Name', 'New Diagram'); } create(); await pending;
			assert.deepStrictEqual({ kind: project.activeView?.kind, name: project.activeView?.name, featureId: project.activeView?.featureId, features: project.model.semantics.elements.filter(element => element.kind === 'feature'), valid: validateSemanticModel(project.model), batches: edits.map(edit => edit.kind), original: model.views }, { kind, name: 'New Diagram', featureId: undefined, features: [], valid: [], batches: kind === 'state' ? ['resource', 'stateDiagram'] : ['diagram'], original: [] });
		});
	}

	test('canceling a state diagram discards its resource draft', async () => {
		const model: SemanticModel = { version: 5, id: 'project', name: 'Project', semantics: { elements: [], relations: [] }, views: [], foundation: emptyFoundation(), codeMappings: [], verifications: [] };
		const project = Object.assign(new (mock<OrditoProjectService>())(), { model });
		const ui = Object.assign(new (mock<OrditoEditingContext>())(), { container: parent, project, edit: () => assert.fail('Canceled drafts must not be applied') });
		const pending = runOrditoDiagramCommand(ui, 'addDiagram');
		fill('Name', 'Lifecycle'); fill('Diagram Type', 'state'); fill('Resource Name', 'Order');
		parent.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
		await pending;
		assert.deepStrictEqual([model.views, model.semantics.elements], [[], []]);
	});
});
