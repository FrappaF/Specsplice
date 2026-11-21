import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { type IAction, toAction } from '../../../../../base/common/actions.js';
import { type ThemeIcon } from '../../../../../base/common/themables.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { OrditoCanvasController } from '../../browser/orditoCanvasController.js';
import { OrditoCanvasSurface } from '../../browser/orditoCanvasSurface.js';
import { IOrditoCodeService } from '../../browser/orditoCodeService.js';
import { OrditoControls } from '../../browser/orditoControls.js';
import { OrditoInspector } from '../../browser/orditoInspector.js';
import { OrditoProjectService } from '../../browser/orditoProjectService.js';
import { checkoutModel } from '../../common/checkoutModel.js';
import { type ModelView, type SemanticModel, viewKinds } from '../../common/modelTypes.js';
import { blueprintFixture } from '../common/blueprintFixture.js';
import { interactionFixture } from '../common/interactionFixture.js';

suite('Specsplice canvas action menus', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	setup(() => { root = dom.append(document.body, dom.$('section.ordito-shell')); });
	teardown(() => root.remove());

	function fixture(options: { model?: SemanticModel; viewKind?: ModelView['kind']; view?: ModelView; editable?: boolean; toolbar?: boolean; inspector?: boolean; projectRoot?: URI } = {}) {
		const model = structuredClone(options.model ?? blueprintFixture);
		const view = options.view ?? (options.viewKind ? model.views.find(view => view.kind === options.viewKind)! : model.views[2]);
		const project = Object.assign(new (mock<OrditoProjectService>())(), {
			model, activeView: view, selectedId: view.nodes[0]?.elementId ?? '', section: 'diagram', editable: options.editable ?? true, projectRoot: options.projectRoot,
			selectElement: (id: string) => { project.selectedId = id; }, readiness: () => ({ diagnostics: [] })
		});
		const controls = store.add(new OrditoControls());
		const canvas = store.add(new OrditoCanvasController({ root }, controls, project, store.add(new InMemoryStorageService())));
		const commands: { command: string; args: (string | undefined)[] }[] = [];
		const context = { actions: [] as IAction[] };
		const commandService = Object.assign(new (mock<ICommandService>())(), { executeCommand: async (command: string, ...args: (string | undefined)[]) => { commands.push({ command, args }); } });
		const contextMenus = Object.assign(new (mock<IContextMenuService>())(), { showContextMenu: (delegate: Parameters<IContextMenuService['showContextMenu']>[0]) => { context.actions = [...delegate.getActions?.() ?? []]; } });
		const render = () => controls.render(root, () => {
			dom.clearNode(root);
			if (options.toolbar) { surface.renderEditingToolbar(root); } else { surface.renderCanvasMenus(root, project.activeView!); }
			if (options.inspector && surface.inspectorOpen) {
				const detail = dom.append(root, dom.$('aside.ordito-properties'));
				if (surface.relationSelection) { inspector.renderRelationProperties(detail, surface.relationSelection); } else { inspector.renderProperties(detail, model, view); }
			}
		});
		const host = Object.assign(new (mock<ConstructorParameters<typeof OrditoCanvasSurface>[0]>())(), {
			root, render,
			button: (parent: HTMLElement, label: string, action: () => void, id?: string) => controls.button(parent, label, action, id),
			iconButton: (parent: HTMLElement, label: string, _icon: ThemeIcon, action: () => void, id?: string) => controls.button(parent, label, action, id),
			paragraph: (parent: HTMLElement, text: string) => { dom.append(parent, dom.$('p')).textContent = text; }
		});
		const surface = new OrditoCanvasSurface(host, canvas, controls, project, commandService, new (mock<IQuickInputService>())(), contextMenus, new (mock<INotificationService>())());
		const inspector = new OrditoInspector({ ...host, revealElement: () => {}, relationMenu: (id, x, y) => surface.relationMenu(id, x, y) }, controls, project, new (mock<IOrditoCodeService>())(), commandService);
		render();
		return { surface, project, controls, commands, context, render };
	}

	const palette = () => root.querySelector<HTMLElement>('.ordito-diagram-menu')!;
	const button = (label: string, parent: ParentNode = root) => {
		const button = [...parent.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent) === label);
		assert.ok(button, `Missing button: ${label}`); return button;
	};
	const disclosure = (label: string) => {
		const summary = [...root.querySelectorAll('summary')].find(summary => (summary.getAttribute('aria-label') ?? summary.textContent) === label);
		assert.ok(summary, `Missing disclosure: ${label}`); return summary.parentElement as HTMLDetailsElement;
	};
	const tab = (label: string) => {
		const tab = [...palette().querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === label);
		assert.ok(tab, `Missing tab: ${label}`); return tab;
	};
	const panel = (label: string) => document.getElementById(tab(label).getAttribute('aria-controls')!)!;
	const run = (label: string, parent?: ParentNode) => {
		const action = button(label, parent);
		const panel = action.closest<HTMLElement>('[role="tabpanel"]');
		if (panel) { document.getElementById(panel.getAttribute('aria-labelledby')!)?.click(); }
		let details = action.closest('details');
		while (details) { details.open = true; details = details.parentElement?.closest('details') ?? null; }
		action.click();
	};

	for (const kind of viewKinds) {
		for (const toolbar of [false, true]) {
			test(`${kind} ${toolbar ? 'toolbar' : 'canvas'} uses the same three tabs and starts with content actions`, () => {
				fixture({ model: checkoutModel, toolbar, view: { id: `view:${kind}`, name: kind, kind, nodes: [], relationIds: [] } });
				assert.deepStrictEqual({ tabs: [...palette().querySelectorAll('[role="tab"]')].map(tab => tab.textContent), selected: tab('Contents').getAttribute('aria-selected'), panels: [...palette().querySelectorAll<HTMLElement>('[role="tabpanel"]')].map(panel => panel.hidden), first: panel('Contents').firstElementChild?.classList.contains('ordito-menu-action'), facts: panel('Contents').querySelector('.ordito-menu-fact') }, { tabs: ['Contents', 'Layout and Display', 'Information'], selected: 'true', panels: [false, true, true], first: true, facts: null });
				assert.strictEqual(button('Delete Diagram').closest('details'), disclosure('Manage Diagram'));
			});
		}
	}

	test('content actions, information and final management retain their original commands', () => {
		const { commands, project } = fixture();
		assert.strictEqual(palette().querySelector('h2')?.textContent, project.activeView!.name);
		assert.strictEqual(palette().lastElementChild, disclosure('Manage Diagram'));
		assert.ok(button('Read Diagram').classList.contains('ordito-menu-action-navigation'));
		assert.ok(button('Delete Diagram').classList.contains('ordito-menu-action-destructive'));
		assert.strictEqual(panel('Information').querySelector('.ordito-menu-fact dt')?.textContent, 'Visible Elements');
		run('Add Existing Element', root.querySelector('.ordito-floating-menu')!);
		run('Add Existing Element', panel('Contents'));
		run('Rename', palette().querySelector('header')!);
		run('Arrange', palette().querySelector('header')!);
		for (const label of ['Edit Visible Elements', 'Edit Context Dependencies', 'Add Existing Relationship', 'Rename Diagram', 'Read Diagram', 'Delete Diagram']) { run(label); }
		assert.deepStrictEqual(commands, [
			{ command: 'ordito.addExisting', args: [] }, { command: 'ordito.addExisting', args: [] }, { command: 'ordito.renameDiagram', args: [] }, { command: 'ordito.layout', args: [] },
			{ command: 'ordito.blueprint', args: [undefined, 'c4Visibility'] }, { command: 'ordito.blueprint', args: [undefined, 'c4Dependencies'] },
			{ command: 'ordito.addExistingRelation', args: [] }, { command: 'ordito.renameDiagram', args: [] }, { command: 'ordito.readContext', args: [] }, { command: 'ordito.deleteDiagram', args: [] }
		]);
	});

	test('display toggles preserve the selected tab, open popup and keyboard focus after refresh', () => {
		const { controls } = fixture(); controls.setExpanded('canvas-actions', true); tab('Layout and Display').click();
		const labels = button('Show Relationship Labels'); const before = labels.getAttribute('aria-pressed');
		labels.focus(); labels.click();
		const refreshed = button('Show Relationship Labels');
		assert.deepStrictEqual({ pressed: refreshed.getAttribute('aria-pressed'), enabled: !refreshed.disabled, detail: refreshed.querySelector('.ordito-menu-action-detail')?.textContent, focused: document.activeElement === refreshed, popup: disclosure('Diagram').open, selected: tab('Layout and Display').getAttribute('aria-selected'), hidden: panel('Layout and Display').hidden }, { pressed: String(before !== 'true'), enabled: true, detail: before === 'true' ? 'Hidden' : 'Visible', focused: true, popup: true, selected: 'true', hidden: false });
		refreshed.click(); assert.strictEqual(button('Show Relationship Labels').getAttribute('aria-pressed'), before);
	});

	test('tab arrow keys wrap, and informational focus never remains in a hidden panel', () => {
		const { controls } = fixture(); controls.setExpanded('canvas-actions', true);
		tab('Contents').focus(); tab('Contents').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
		assert.deepStrictEqual([document.activeElement === tab('Information'), tab('Information').getAttribute('aria-selected')], [true, 'true']);
		button('Read Diagram').focus(); tab('Information').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
		assert.deepStrictEqual([document.activeElement === tab('Contents'), panel('Information').hidden], [true, true]);
	});

	test('readonly tabs retain navigation and display controls while omitting editing and destructive actions', () => {
		fixture({ editable: false });
		assert.deepStrictEqual({ danger: root.querySelector('.ordito-menu-danger'), editing: [...root.querySelectorAll('button')].some(button => ['Rename', 'Rename Diagram', 'Add Existing Element'].includes(button.getAttribute('aria-label') ?? button.textContent ?? '')), arrangeDisabled: button('Arrange Diagram').disabled, readDisabled: button('Read Diagram').disabled, propertiesDisabled: button('Properties').disabled }, { danger: null, editing: false, arrangeDisabled: true, readDisabled: false, propertiesDisabled: false });
		assert.ok(panel('Contents').textContent?.includes('read-only'));
	});

	for (const kind of ['state', 'sequence'] as const) {
		test(`${kind} keeps specialized content actions and puts details in Information`, () => {
			const model = structuredClone(checkoutModel);
			if (kind === 'sequence') { model.views[0].kind = 'sequence'; }
			fixture({ model, viewKind: kind });
			for (const label of kind === 'state' ? ['Add Existing State', 'Add Existing Transition', 'Include Resource Lifecycle'] : ['Add Existing Message']) { assert.strictEqual(button(label).closest('[role="tabpanel"]'), panel('Contents')); }
			assert.strictEqual(disclosure(kind === 'state' ? 'Lifecycle Details' : 'Sequence Details').closest('[role="tabpanel"]'), panel('Information'));
		});
	}

	for (const kind of ['sequence', 'activity'] as const) {
		test(`derived ${kind} counts its participants and guards manual edits without manual nodes`, () => {
			const model = structuredClone(interactionFixture) as SemanticModel; if (kind === 'activity') { model.version = 5; }
			const view: ModelView = { id: `${kind}.checkout`, name: 'Checkout', kind, interactionId: 'interaction.checkout', nodes: [], relationIds: [] };
			fixture({ model, view });
			assert.strictEqual(panel('Information').querySelector('.ordito-menu-fact dd')?.textContent, '3');
			assert.strictEqual(button('Edit Executable Interaction').closest('[role="tabpanel"]'), panel('Contents'));
			assert.ok(![...root.querySelectorAll('button')].some(button => ['Add Existing Message', 'Add Existing Element', 'Add Element', 'Arrange Diagram'].includes(button.getAttribute('aria-label') ?? button.textContent ?? '')));
		});
	}

	for (const kind of ['sequence', 'activity'] as const) {
		test(`an imported ${kind} exposes editing and source refresh while using its actual step IDs`, () => {
			const model = { ...structuredClone(interactionFixture), version: 5 as const };
			const interaction = model.foundation.interactions[0];
			interaction.execution = undefined;
			interaction.profile = 'descriptive';
			interaction.description = { trigger: 'Checkout requested', scope: 'Checkout', participantIds: ['checkout.4', 'component.orders'], evidenceIds: [], order: [] };
			interaction.occurrenceIds = ['save']; interaction.frameIds = [];
			model.foundation.occurrences = [{ id: 'save', name: 'Save Order', from: 'checkout.4', to: 'component.orders', profile: 'descriptive' }];
			const view: ModelView = { id: `${kind}.checkout`, name: 'Checkout', kind, interactionId: interaction.id, nodes: [], relationIds: [] };
			const { commands, surface } = fixture({ model, view, inspector: true, projectRoot: URI.file('/checkout') });
			const canvas = root.querySelector('.ordito-floating-menu')!;
			run('Add Element', canvas);
			run('Add Existing Element', canvas);
			run(kind === 'sequence' ? 'Add Message' : 'Add Step', canvas);
			run('Edit Scenario', panel('Contents'));
			run('Update Diagrams from Codebase', panel('Contents'));
			surface.elementMenu('save', 20, 30);
			run(kind === 'sequence' ? 'Edit Message' : 'Edit Step', root.querySelector('aside')!);
			assert.deepStrictEqual(commands, [
				{ command: 'ordito.addElement', args: [] }, { command: 'ordito.addExisting', args: [] }, { command: 'ordito.connect', args: [] },
				{ command: 'ordito.editScenario', args: [] }, { command: 'ordito.ai.updateDiagrams', args: [] }, { command: 'ordito.editScenario', args: ['save'] }
			]);
		});
	}

	test('the alternate toolbar retains feature, blueprint, display and delete commands in matching tabs', () => {
		const { commands } = fixture({ toolbar: true });
		for (const label of ['Edit Visible Elements', 'Edit Context Dependencies', 'Add Existing Element', 'Rename Diagram', 'Add Feature', 'Arrange Diagram', 'Read Diagram', 'Delete Diagram']) { run(label); }
		assert.deepStrictEqual(commands.map(entry => entry.command), ['ordito.blueprint', 'ordito.blueprint', 'ordito.addExisting', 'ordito.renameDiagram', 'ordito.addFeature', 'ordito.layout', 'ordito.readContext', 'ordito.deleteDiagram']);
	});

	test('element and relationship context gestures open and focus the shared tabbed Inspector', () => {
		const { surface, project, controls, context } = fixture({ inspector: true }); controls.setExpanded('canvas-actions', true);
		surface.elementMenu(project.selectedId, 20, 30);
		assert.deepStrictEqual({ open: surface.inspectorOpen, relation: surface.relationSelection, popup: disclosure('Diagram').open, focused: document.activeElement?.getAttribute('role'), tabs: [...root.querySelectorAll('aside [role="tab"]')].map(tab => tab.textContent), native: context.actions }, { open: true, relation: undefined, popup: false, focused: 'tab', tabs: ['Properties', 'Behavior', 'Architecture'], native: [] });
		const relation = project.model.semantics.relations[0]; surface.relationMenu(relation.id, 20, 30);
		assert.deepStrictEqual({ selected: surface.relationSelection, focused: document.activeElement?.getAttribute('role'), tabs: [...root.querySelectorAll('aside [role="tab"]')].map(tab => tab.textContent), native: context.actions }, { selected: relation.id, focused: 'tab', tabs: ['Properties', 'Behavior', 'Architecture'], native: [] });
	});

	test('overlapping relationship selection remains a native single-choice chooser', async () => {
		const { surface, context } = fixture();
		let selected = '';
		surface.showMenu(20, 30, [toAction({ id: 'pick.one', label: 'Orders', run: async () => { selected = 'Orders'; } })]);
		await context.actions[0].run(); assert.strictEqual(selected, 'Orders');
	});
});
