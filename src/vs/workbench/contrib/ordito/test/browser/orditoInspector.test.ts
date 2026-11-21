import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IOrditoCodeService } from '../../browser/orditoCodeService.js';
import { OrditoControls } from '../../browser/orditoControls.js';
import { OrditoInspector } from '../../browser/orditoInspector.js';
import { OrditoProjectService } from '../../browser/orditoProjectService.js';
import { emptyFoundation } from '../../common/modelFoundation.js';
import { type SemanticModel } from '../../common/modelTypes.js';
import { type VisualEdit } from '../../common/visualEditing.js';
import { interactionFixture } from '../common/interactionFixture.js';

suite('Specsplice inspector information hierarchy', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	let detail: HTMLElement;
	setup(() => {
		root = document.body.appendChild(document.createElement('div'));
		root.className = 'ordito-shell ordito-canvas-mode';
		detail = root.appendChild(document.createElement('aside'));
	});
	teardown(() => root.remove());

	function fixture(editable = true, version: 3 | 4 = 3, canvasConnection = false, onError?: (error: unknown) => void) {
		const model: SemanticModel = {
			version, id: 'project', name: 'CRM', codeMappings: [], verifications: [],
			...(version === 4 ? { foundation: emptyFoundation() } : {}),
			semantics: {
				elements: [
					{ id: 'crm', kind: 'component', name: 'Customer Service' },
					{ id: 'client', kind: 'entity', name: 'Customer', parentId: 'crm', description: 'A customer registered in the CRM.', details: { technology: 'PostgreSQL', environment: 'Production', members: [{ name: 'customerId', type: 'string', kind: 'attribute', key: 'primary', required: true }] } },
					{ id: 'order', kind: 'entity', name: 'Order' }
				],
				relations: [{ id: 'orders', kind: 'association', from: 'client', to: 'order', name: 'Places Orders', condition: 'active', errorCode: 'NOT_ACTIVE' }]
			},
			views: [
				{ id: 'current', name: 'Customer Diagram', kind: 'structure', nodes: [{ elementId: 'client', x: 0, y: 0 }, { elementId: 'order', x: 300, y: 0 }], relationIds: ['orders'] },
				{ id: 'other', name: 'Domain Diagram', kind: 'structure', nodes: [{ elementId: 'client', x: 0, y: 0 }], relationIds: [] }
			]
		} as SemanticModel;
		const commands: { id: string; args: string[] }[] = [];
		const revealed: { id: string; viewId?: string }[] = [];
		const inspected: string[] = [];
		const impacts: string[] = [];
		const source: string[] = [];
		const edits: VisualEdit[] = [];
		const canvasConnections: string[] = [];
		const controls = store.add(new OrditoControls(onError));
		let commandError: Error | undefined;
		const project = Object.assign(new (mock<OrditoProjectService>())(), {
			model, editable, selectedId: 'client', section: 'diagram' as const, activeView: model.views[0],
			inspectElement: (id: string) => inspected.push(id), showImpact: (id: string) => impacts.push(id),
			edit: (edit: VisualEdit) => edits.push(edit),
			readiness: () => ({ diagnostics: [] })
		});
		const code = Object.assign(new (mock<IOrditoCodeService>())(), { context: { sourceRoot: '/project' }, busy: false, inspect: async (id: string) => { source.push(id); } });
		const commandService = Object.assign(new (mock<ICommandService>())(), { executeCommand: async (id: string, ...args: string[]) => { commands.push({ id, args }); if (commandError) { throw commandError; } } });
		const inspector = new OrditoInspector({
			root,
			paragraph: (parent, text) => { parent.appendChild(document.createElement('p')).textContent = text; },
			button: (parent, label, action, id) => controls.button(parent, label, action, id),
			revealElement: (id, viewId) => revealed.push({ id, viewId }), relationMenu: () => {},
			...(canvasConnection ? { beginConnection: async (id: string) => { canvasConnections.push(id); } } : {})
		}, controls, project, code, commandService);
		const render = (close?: () => void) => controls.render(root, () => { root.replaceChildren(); detail = root.appendChild(document.createElement('aside')); inspector.renderProperties(detail, project.model, project.activeView, close); });
		return { model, project, code, inspector, controls, commands, revealed, inspected, impacts, source, edits, render, canvasConnections, failCommand: (error: Error) => { commandError = error; } };
	}

	const button = (label: string, parent: ParentNode = detail): HTMLButtonElement => {
		const result = [...parent.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.textContent === label);
		assert.ok(result, `Missing button ${label}`); return result;
	};
	const section = (label: string, parent: ParentNode = detail): HTMLElement => {
		const result = [...parent.querySelectorAll<HTMLElement>('section')].find(section => section.getAttribute('aria-label') === label || [...section.children].some(child => /^H[2-6]$/.test(child.tagName) && child.textContent === label));
		assert.ok(result, `Missing section ${label}`); return result;
	};

	const tab = (label: string): HTMLButtonElement => {
		const result = [...detail.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === label || tab.getAttribute('aria-label') === label);
		assert.ok(result, `Missing tab ${label}`); return result;
	};
	const panel = (label: string): HTMLElement => {
		const result = document.getElementById(tab(label).getAttribute('aria-controls')!);
		assert.ok(result, `Missing panel ${label}`); return result;
	};
	const disclosure = (label: string): HTMLDetailsElement => {
		const summary = [...detail.querySelectorAll('summary')].find(summary => (summary.getAttribute('aria-label') ?? summary.textContent) === label);
		assert.ok(summary, `Missing disclosure ${label}`); return summary.parentElement as HTMLDetailsElement;
	};

	const manage = (relationship = false): HTMLDetailsElement => {
		const label = relationship ? 'More Relationship Actions' : 'More Element Actions';
		const summary = [...detail.querySelectorAll('summary')].find(summary => summary.getAttribute('aria-label') === label);
		assert.ok(summary, `Missing disclosure ${label}`); return summary.parentElement as HTMLDetailsElement;
	};

	test('Properties presents actual facts and members with its primary editing action', () => {
		const f = fixture(); f.render();
		assert.deepStrictEqual([...detail.querySelectorAll('[role="tab"]')].map(tab => tab.textContent), ['Properties', 'Behavior', 'Architecture']);
		const properties = panel('Properties');
		assert.deepStrictEqual([properties.hidden, panel('Behavior').hidden, panel('Architecture').hidden], [false, true, true]);
		for (const text of ['PostgreSQL', 'Production', 'customerId', 'string']) { assert.ok(properties.textContent?.includes(text), `Missing property ${text}`); }
		assert.ok(properties.querySelector('table'));
		assert.ok(properties.contains(button('Edit Attributes and Technology')));
		assert.ok(button('Edit Attributes and Technology').classList.contains('ordito-menu-action-primary'));
		assert.ok(detail.textContent?.includes('A customer registered in the CRM.'));
		assert.ok(!properties.contains(button('Rename Element')));
		assert.strictEqual(manage().open, false);
		assert.ok(manage().contains(button('Delete Element')));
	});

	test('shared type and ownership declarations supply readable properties and architecture context', () => {
		const f = fixture(true, 4), model = f.model;
		assert.ok(model.version === 4);
		const element = model.semantics.elements[1]; element.parentId = undefined;
		element.details!.members[0].type = ''; element.details!.members[0].typeId = 'type.customerId';
		model.foundation.types.push({ id: 'type.customerId', name: 'Customer Identifier', kind: 'primitive', primitive: 'string', fields: [] });
		model.foundation.ownership.push({ id: 'owner.client', elementId: 'client', ownerId: 'crm', role: 'architecture' });
		f.render();
		assert.ok(panel('Properties').textContent?.includes('Customer Identifier'));
		assert.ok(panel('Properties').textContent?.includes('Nullability Unknown'));
		tab('Architecture').click(); assert.ok(panel('Architecture').textContent?.includes('Customer Service'));
	});

	test('editing actions remain before long property and behavior collections', () => {
		const f = fixture(true, 4), element = f.model.semantics.elements[1];
		element.details!.members = Array.from({ length: 40 }, (_, index) => ({ name: `field${index}`, type: 'string', kind: 'attribute' as const, key: 'none' as const, required: true }));
		element.behavior = { inputs: Array.from({ length: 40 }, (_, index) => ({ name: `input${index}`, type: 'string', required: true })), outputs: [], preconditions: [], postconditions: [], errors: [], permissions: [], acceptanceCriteria: [] };
		f.render();
		const properties = panel('Properties'), table = properties.querySelector('table');
		assert.ok(table); assert.strictEqual(table.querySelectorAll('tbody tr').length, 40);
		assert.ok(button('Edit Attributes and Technology', properties).compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING);
		tab('Behavior').click();
		const behavior = panel('Behavior'), firstInput = [...behavior.querySelectorAll('p')].find(paragraph => paragraph.textContent?.includes('input0'));
		assert.ok(firstInput); assert.ok(button('Edit Behavioral Contract', behavior).compareDocumentPosition(firstInput) & Node.DOCUMENT_POSITION_FOLLOWING);
		tab('Architecture').click();
		const architecture = panel('Architecture'), ownership = architecture.querySelector('.ordito-menu-fact');
		assert.ok(ownership); assert.ok(button('Edit Blueprint', architecture).compareDocumentPosition(ownership) & Node.DOCUMENT_POSITION_FOLLOWING);
	});

	test('Behavior exposes a useful empty state and an editing action, then renders contract values', async () => {
		const f = fixture(); f.render(); tab('Behavior').click();
		const behavior = panel('Behavior');
		assert.strictEqual(behavior.hidden, false);
		assert.match(behavior.textContent ?? '', /(?:No .*behavior|No behavioral|not (?:defined|declared))/i);
		button('Edit Behavioral Contract', behavior).click(); await Promise.resolve();
		assert.deepStrictEqual(f.commands, [{ id: 'ordito.behavior', args: [] }]);
		f.model.semantics.elements[1].behavior = { inputs: [{ name: 'customerId', type: 'string', required: true }], outputs: [], preconditions: ['Active customer'], postconditions: ['Saved customer'], errors: [{ code: 'NOT_ACTIVE', description: 'Customer must be active' }], permissions: [], acceptanceCriteria: [] };
		f.render();
		assert.strictEqual(tab('Behavior').getAttribute('aria-selected'), 'true');
		for (const text of ['customerId', 'string', 'Active customer', 'Saved customer', 'NOT_ACTIVE']) { assert.ok(panel('Behavior').textContent?.includes(text), `Missing behavior ${text}`); }
	});

	test('Architecture contains ownership and relationship information instead of unrelated property actions', () => {
		const f = fixture(); f.render(); tab('Architecture').click();
		const architecture = panel('Architecture');
		assert.strictEqual(architecture.hidden, false);
		assert.ok(architecture.textContent?.includes('Customer Service'));
		assert.ok(architecture.textContent?.includes('Places Orders'));
		assert.ok(architecture.contains(button('Change Boundary or Parent')));
		assert.ok(!architecture.contains(button('Edit Attributes and Technology')));
	});

	test('header and footer actions retain routes and focus identities independently of the selected panel', async () => {
		const f = fixture(), closedAfterEdits: number[] = [];
		f.render(() => { closedAfterEdits.push(f.edits.length); });
		button('Remove from This Diagram', panel('Properties')).click();
		button('Edit Attributes and Technology').click(); tab('Architecture').click(); button('Open Source').click(); button('Show Change Impact').click(); button('Element Details').click();
		button('Rename', detail.querySelector('header')!).click();
		manage().querySelector('summary')!.click(); button('Rename Element').click();
		button('Remove from This Diagram', section('In This Diagram', manage())).click();
		await Promise.resolve();
		assert.deepStrictEqual({ commands: f.commands, source: f.source, impacts: f.impacts, inspected: f.inspected, edits: f.edits, closedAfterEdits }, {
			commands: [{ id: 'ordito.notation', args: ['client'] }, { id: 'ordito.renameElement', args: [] }, { id: 'ordito.renameElement', args: [] }],
			source: ['client'], impacts: ['client'], inspected: ['client'], edits: [
				{ kind: 'exclude', viewId: 'current', id: 'client', target: 'element' }, { kind: 'exclude', viewId: 'current', id: 'client', target: 'element' }
			], closedAfterEdits: [1, 2]
		});
		assert.ok(f.controls.focusTarget('source:client'));
		f.render(); assert.strictEqual(document.activeElement, button('Open Source'));
		assert.strictEqual(tab('Architecture').getAttribute('aria-selected'), 'true');
	});

	test('an asynchronous editing command reaches contextual error reporting without losing the selected panel or focus', async () => {
		const errors: Error[] = [], failure = new Error('The project changed while editing');
		const f = fixture(true, 3, false, error => { assert.ok(error instanceof Error); errors.push(error); });
		f.failCommand(failure); f.render();
		const edit = button('Edit Attributes and Technology'); edit.focus(); edit.click();
		await timeout(0);
		assert.deepStrictEqual({ commands: f.commands, errors, selected: tab('Properties').getAttribute('aria-selected'), panelHidden: panel('Properties').hidden, focused: document.activeElement === edit }, { commands: [{ id: 'ordito.notation', args: ['client'] }], errors: [failure], selected: 'true', panelHidden: false, focused: true });
		assert.strictEqual(errors[0], failure);
	});

	test('tab selection persists when selecting another element and a focused panel action survives refresh', () => {
		const f = fixture(); f.render(); tab('Behavior').click(); button('Edit Behavioral Contract').focus();
		f.render();
		assert.strictEqual(document.activeElement, button('Edit Behavioral Contract'));
		f.project.selectedId = 'order'; f.render();
		assert.deepStrictEqual([tab('Behavior').getAttribute('aria-selected'), panel('Behavior').hidden], ['true', false]);
		assert.ok(detail.querySelector('h2')?.textContent?.includes('Order'));
	});

	test('the current diagram is explicit and other diagrams remain navigable from every tab', () => {
		const f = fixture(); f.render(); tab('Behavior').click();
		const diagrams = disclosure('Diagrams Containing This Element');
		diagrams.querySelector('summary')!.click();
		const current = button('Customer Diagram', diagrams);
		assert.ok(['true', 'page'].includes(current.getAttribute('aria-current') ?? ''));
		assert.strictEqual(current.disabled, true); assert.ok(current.textContent?.includes('Current'));
		assert.ok(!diagrams.closest('[role="tabpanel"]'));
		current.click(); button('Domain Diagram', diagrams).click();
		assert.deepStrictEqual(f.revealed, [{ id: 'client', viewId: 'other' }]);
	});

	test('read-only tabs retain facts, behavior and exploration while omitting mutable actions', () => {
		const f = fixture(false, 4); f.render();
		for (const label of ['Properties', 'Behavior', 'Architecture']) { tab(label).click(); assert.strictEqual(panel(label).hidden, false); }
		assert.ok(section('Explore').contains(button('Open Source')));
		const labels = [...detail.querySelectorAll('button')].map(button => button.getAttribute('aria-label') ?? button.textContent);
		assert.ok(!labels.some(label => ['Rename', 'Rename Element', 'Remove from This Diagram', 'Edit Description', 'Edit Attributes and Technology', 'Edit Pure Predicate', 'Edit Blueprint', 'Delete Element', 'Delete Relationship'].includes(label ?? '')));
		assert.ok(panel('Properties').textContent?.includes('PostgreSQL'));
		assert.ok(button('Customer Diagram').textContent?.includes('Current'));
	});

	test('relationship tabs separate cardinalities, behavior and architecture with consistent footer navigation', async () => {
		const f = fixture();
		f.model.semantics.relations[0].details = { sourceMultiplicity: '1', targetMultiplicity: '0..*', sourceMember: 'customerId', targetMember: 'ownerId', protocol: 'HTTPS' };
		f.inspector.renderRelationProperties(detail, 'orders');
		assert.deepStrictEqual([...detail.querySelectorAll('[role="tab"]')].map(tab => tab.textContent), ['Properties', 'Behavior', 'Architecture']);
		assert.ok(panel('Properties').contains(button('Edit Cardinalities and Protocol')));
		assert.ok(panel('Properties').textContent?.includes('0..*'));
		const propertyFacts = panel('Properties').querySelector('.ordito-menu-fact');
		assert.ok(propertyFacts); assert.ok(button('Edit Cardinalities and Protocol', panel('Properties')).compareDocumentPosition(propertyFacts) & Node.DOCUMENT_POSITION_FOLLOWING);
		tab('Behavior').click();
		for (const text of ['active', 'NOT_ACTIVE']) { assert.ok(panel('Behavior').textContent?.includes(text)); }
		const behaviorFacts = panel('Behavior').querySelector('.ordito-menu-fact');
		assert.ok(behaviorFacts); assert.ok(button('Edit Condition', panel('Behavior')).compareDocumentPosition(behaviorFacts) & Node.DOCUMENT_POSITION_FOLLOWING);
		button('Edit Condition', panel('Behavior')).click(); button('Edit Relationship Error', panel('Behavior')).click();
		tab('Architecture').click(); assert.ok(panel('Architecture').textContent?.includes('HTTPS'));
		const explore = section('Explore');
		for (const endpoint of explore.querySelectorAll<HTMLButtonElement>('button')) { endpoint.click(); }
		button('Edit Relationship…').click(); tab('Properties').click(); button('Edit Cardinalities and Protocol').click();
		await Promise.resolve();
		assert.deepStrictEqual({ revealed: f.revealed, commands: f.commands }, { revealed: [{ id: 'client', viewId: undefined }, { id: 'order', viewId: undefined }], commands: [{ id: 'ordito.condition', args: ['orders'] }, { id: 'ordito.relationError', args: ['orders'] }, { id: 'ordito.editRelation', args: ['orders'] }, { id: 'ordito.relationNotation', args: ['orders'] }] });
		assert.ok(manage(true).contains(button('Delete Relationship')));
	});

	test('read-only relationship tabs retain endpoints and details without editing or deletion', () => {
		const f = fixture(false); f.inspector.renderRelationProperties(detail, 'orders');
		for (const label of ['Properties', 'Behavior', 'Architecture']) { tab(label).click(); assert.strictEqual(panel(label).hidden, false); }
		for (const endpoint of section('Explore').querySelectorAll<HTMLButtonElement>('button')) { endpoint.click(); }
		assert.deepStrictEqual(f.revealed.map(entry => entry.id), ['client', 'order']);
		assert.ok(![...detail.querySelectorAll('button')].some(button => /^(?:Edit|Delete|Remove)\b/.test(button.getAttribute('aria-label') ?? button.textContent ?? '')));
		assert.ok(panel('Behavior').textContent?.includes('NOT_ACTIVE'));
	});

	test('canvas connection uses the current element and obeys read-only, derived and state-context guards', async () => {
		const f = fixture(true, 3, true); f.render();
		assert.ok(f.controls.focusTarget('canvas-connect:client'));
		button('Create Relationship on Canvas…').click(); await Promise.resolve();
		assert.deepStrictEqual(f.canvasConnections, ['client']);
		const offered = () => [...detail.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === 'Create Relationship on Canvas…');
		Object.assign(f.project, { editable: false }); f.render(); assert.strictEqual(offered(), false);
		Object.assign(f.project, { editable: true }); f.model.views[0].kind = 'state'; f.render(); assert.strictEqual(offered(), false);
		f.model.semantics.elements[1].kind = 'state'; f.render(); assert.strictEqual(offered(), true);
		const model = structuredClone(interactionFixture), view = { id: 'derived', name: 'Checkout Sequence', kind: 'sequence' as const, interactionId: 'interaction.checkout', nodes: [], relationIds: [] };
		model.views.push(view); Object.assign(f.project, { model, activeView: view, selectedId: 'message.charge' }); f.render();
		assert.strictEqual(offered(), false);
	});

	test('Manage keeps local sequence moves and removals apart from system deletion', async () => {
		const f = fixture(); f.model.views[0].kind = 'sequence'; f.model.semantics.relations[0].kind = 'invocation';
		f.render(); tab('Architecture').click(); manage().querySelector('summary')!.click();
		const diagram = section('In This Diagram', manage());
		assert.strictEqual(button('Move Participant Left', diagram).disabled, true);
		button('Move Participant Right', diagram).click(); button('Remove Participant from Diagram', diagram).click();
		assert.ok(!button('Delete Element').closest('[role="tabpanel"]'));
		button('Delete Element').click(); await Promise.resolve();
		assert.deepStrictEqual({ edits: f.edits, commands: f.commands }, { edits: [{ kind: 'sequenceOrder', viewId: 'current', id: 'client', target: 'participant', direction: 1 }, { kind: 'sequenceRemove', viewId: 'current', id: 'client', target: 'participant' }], commands: [{ id: 'ordito.deleteElement', args: [] }] });
	});

	test('self relationships preserve distinct endpoint focus identities and role descriptions', () => {
		const f = fixture(); f.model.semantics.relations[0].to = 'client'; f.inspector.renderRelationProperties(detail, 'orders');
		assert.ok(f.controls.focusTarget('relationship-source:orders')); const source = document.activeElement;
		assert.ok(f.controls.focusTarget('relationship-target:orders')); assert.notStrictEqual(document.activeElement, source);
		const endpoints = [...section('Explore').querySelectorAll('button')];
		assert.deepStrictEqual(endpoints.map(button => document.getElementById(button.getAttribute('aria-describedby')!)?.textContent), ['Source', 'Target']);
	});
	for (const selectedId of ['message.charge', 'frame.persist', 'branch.approved']) {
		test(`derived selection ${selectedId} exposes three meaningful tabs and preserves editor guards and focus`, async () => {
			const f = fixture(true, 4), model = structuredClone(interactionFixture);
			const view = { id: 'derived', name: 'Checkout Sequence', kind: 'sequence' as const, interactionId: 'interaction.checkout', nodes: [], relationIds: [] };
			model.views.push(view); Object.assign(f.project, { model, activeView: view, selectedId });
			f.render();
			assert.deepStrictEqual([...detail.querySelectorAll('[role="tab"]')].map(tab => tab.textContent), ['Properties', 'Behavior', 'Architecture']);
			for (const label of ['Properties', 'Behavior', 'Architecture']) { tab(label).click(); assert.ok(panel(label).textContent?.trim()); }
			tab('Behavior').click();
			const behavior = panel('Behavior'), edit = button('Edit Executable Interaction', behavior), firstData = behavior.querySelector('p, dl, details, table');
			assert.ok(firstData); assert.ok(edit.compareDocumentPosition(firstData) & Node.DOCUMENT_POSITION_FOLLOWING);
			edit.focus(); f.render(); assert.strictEqual(document.activeElement, button('Edit Executable Interaction'));
			button('Edit Executable Interaction').click(); await Promise.resolve();
			assert.deepStrictEqual(f.commands, [{ id: 'ordito.interaction', args: ['interaction.checkout'] }]);
			f.project.selectedId = selectedId === 'message.charge' ? 'frame.persist' : 'message.charge'; f.render();
			assert.strictEqual(tab('Behavior').getAttribute('aria-selected'), 'true');
			Object.assign(f.project, { editable: false }); f.render();
			assert.ok(![...detail.querySelectorAll('button')].some(button => (button.getAttribute('aria-label') ?? button.textContent) === 'Edit Executable Interaction'));
		});
	}

});
