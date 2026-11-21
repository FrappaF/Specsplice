import assert from 'assert';
import { blueprintFixture } from '../common/blueprintFixture.js';
import { type IInputOptions, type IPickOptions, type IQuickInputService, type IQuickPickItem, type QuickPickInput } from '../../../../../platform/quickinput/common/quickInput.js';
import { editOrditoBlueprint, type BlueprintEditMode } from '../../browser/orditoBlueprintEditing.js';
import { applyVisualEdit } from '../../common/visualEditing.js';
import { type SemanticModelV4 } from '../../common/modelTypes.js';

/** Scripted native dialog boundary: all semantic editing still uses the production implementation. */
export class ScriptedDialogs implements Pick<IQuickInputService, 'pick' | 'input'> {
	readonly pickHistory: { title: string | undefined; items: IQuickPickItem[]; matchOnDescription?: boolean; matchOnDetail?: boolean }[] = [];
	constructor(private readonly answers: (string | string[] | undefined)[]) { }
	pick<T extends IQuickPickItem>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options?: IPickOptions<T> & { canPickMany: true }): Promise<T[] | undefined>;
	pick<T extends IQuickPickItem>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options?: IPickOptions<T> & { canPickMany: false }): Promise<T | undefined>;
	pick<T extends IQuickPickItem>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options?: Omit<IPickOptions<T>, 'canPickMany'>): Promise<T | undefined>;
	async pick<T extends IQuickPickItem>(picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[], options?: IPickOptions<T>): Promise<T | T[] | undefined> {
		assert.ok(this.answers.length, 'Unexpected dialog'); const answer = this.answers.shift(); if (answer === undefined) { return; }
		const items = (await picks).filter((item): item is T => item.type !== 'separator');
		this.pickHistory.push({ title: options?.title, items, matchOnDescription: options?.matchOnDescription, matchOnDetail: options?.matchOnDetail });
		if (answer === '<focused>' && !options?.canPickMany) { return await options?.activeItem ?? items[0]; }
		const find = (label: string) => { const item = items.find(item => item.label === label || item.detail === label); assert.ok(item, `Missing dialog choice: ${label}`); return item; };
		return options?.canPickMany ? (Array.isArray(answer) ? answer : [answer]).map(find) : find(String(answer));
	}
	async input(options?: IInputOptions): Promise<string | undefined> {
		assert.ok(this.answers.length, 'Unexpected input'); const answer = this.answers.shift(); assert.ok(!Array.isArray(answer));
		if (answer !== undefined) { assert.strictEqual(await options?.validateInput?.(answer), undefined); } return answer;
	}
	assertComplete(): void { assert.strictEqual(this.answers.length, 0); }
}

suite('Specsplice guided blueprint editing', () => {
	let model: SemanticModelV4;
	setup(() => { model = structuredClone(blueprintFixture); });
	const run = async (model: SemanticModelV4, answers: (string | string[] | undefined)[], mode?: BlueprintEditMode, selectedId = 'component.checkout') => {
		const dialogs = new ScriptedDialogs(answers); const before = structuredClone(model);
		const edits = await editOrditoBlueprint(dialogs, model, selectedId, model.views[2], mode);
		dialogs.assertComplete(); assert.deepStrictEqual(model, before);
		return edits?.reduce((model, edit) => applyVisualEdit(model, edit) as SemanticModelV4, model);
	};
	test('blueprint navigation can go back or cancel without changing the model', async () => {
		assert.strictEqual(await run(model, ['Structure', 'Back', 'Data and Operations', undefined]), undefined);
		assert.strictEqual(await run(model, [undefined]), undefined);
	});
	test('canceling after a detached operation edit leaves all definitions untouched', async () => {
		assert.strictEqual(await run(model, ['Data and Operations', 'Shared Operations', 'confirmOrder', 'Signature', 'Input Parameters', 'Create New', 'newInput', undefined]), undefined);
	});
	test('contextual operation edits remain detached and exclude unrelated owners', async () => {
		model.foundation.blueprint!.operations.push({ ...structuredClone(model.foundation.blueprint!.operations[0]), id: 'unrelated.operation', ownerId: 'container.store', name: 'Unrelated' });
		const dialogs = new ScriptedDialogs(['confirmOrder', 'Rename', 'renamed']); const before = structuredClone(model);
		const edits = await editOrditoBlueprint(dialogs, model, 'component.checkout', model.views[2], 'operations'); dialogs.assertComplete();
		assert.deepStrictEqual(model, before); assert.ok(edits?.length);
		assert.equal(dialogs.pickHistory[0].items.some(item => item.label === 'Unrelated'), false);
	});
	test('renaming an operation uses its existing stable identity', async () => {
		const updated = await run(model, ['Data and Operations', 'Shared Operations', 'confirmOrder', 'Rename', 'submitOrder']);
		assert.deepStrictEqual(updated?.foundation.blueprint?.operations.map(operation => [operation.id, operation.name]), [['operation.confirm', 'submitOrder'], ['operation.reserveRequired', 'reserveStock'], ['operation.reserve', 'reserveStock']]);
	});
	test('guided field editing keeps optional presence separate from non-null values', async () => {
		const updated = await run(model, ['Data and Operations', 'Shared Operations', 'confirmOrder', 'Signature', 'Input Parameters', 'order', 'order', 'Order', 'Optional', 'Non-null Value']);
		assert.deepStrictEqual(updated?.foundation.blueprint?.operations[0].inputs[0], { id: 'input.operation.confirm', name: 'order', type: '', typeId: 'type.order', required: false, nullable: { state: 'known', value: false } });
	});
	for (const nullable of [{ state: 'known' as const, value: true }, { state: 'unknown' as const, reason: 'Ask the domain owner before choosing nullability' }]) {
		test(`renaming an existing field preserves its selected type, optional presence and ${nullable.state} nullability`, async () => {
			const previous = model.foundation.blueprint!.operations[0].inputs[0];
			Object.assign(previous, { type: '', required: false, nullable });
			model.foundation.blueprint!.operations[0].inputs.push({ id: 'qa.other', name: 'other', type: '', typeId: previous.typeId, required: true, nullable: { state: 'known', value: false } });
			const updated = await run(model, ['Data and Operations', 'Shared Operations', 'confirmOrder', 'Signature', 'Input Parameters', 'order', 'renamedOrder', '<focused>', '<focused>', '<focused>']);
			assert.deepStrictEqual(updated?.foundation.blueprint?.operations[0].inputs, [{ ...previous, name: 'renamedOrder' }, model.foundation.blueprint!.operations[0].inputs[1]]);
		});
	}
	test('editing an existing permission keeps other requirements and the rest of the shared contract intact', async () => {
		model.semantics.elements.push({ id: 'qa.buyer', kind: 'actor', name: 'QA Buyer' });
		const operation = model.foundation.blueprint!.operations[0];
		operation.permissions = [{ actorId: 'qa.buyer', capability: 'order:create' }, { actorId: 'qa.buyer', capability: 'order:read' }];
		const answers = ['Data and Operations', 'Shared Operations', 'confirmOrder', 'Access and Acceptance', 'Permissions', 'QA Buyer · order:create', '<focused>'];
		const updated = await run(model, [...answers, 'order:manage']);
		assert.deepStrictEqual(updated?.foundation.blueprint?.operations[0], { ...operation, permissions: [{ actorId: 'qa.buyer', capability: 'order:manage' }, operation.permissions[1]] });
		const unchanged = await run(model, [...answers, 'order:create']); assert.deepStrictEqual(unchanged, model);
		assert.strictEqual(await run(model, [...answers, undefined]), undefined);
		const removed = await run(model, ['Data and Operations', 'Shared Operations', 'confirmOrder', 'Remove Contract Member', 'Permission · QA Buyer · order:create']);
		assert.deepStrictEqual(removed?.foundation.blueprint?.operations[0], { ...operation, permissions: [operation.permissions[1]] });
	});

	test('editing an existing acceptance criterion preserves its identity, authored order and unrelated contract data', async () => {
		const operation = model.foundation.blueprint!.operations[0];
		operation.acceptanceCriteria = [{ id: 'qa.case.first', given: 'authorized buyer', when: 'creating an order', then: 'order accepted' }, { id: 'qa.case.second', given: 'unknown buyer', when: 'creating an order', then: 'order rejected' }];
		const answers = ['Data and Operations', 'Shared Operations', 'confirmOrder', 'Access and Acceptance', 'Acceptance Criteria', 'order accepted'];
		const updated = await run(model, [...answers, 'authorized buyer', 'creating an order', 'order accepted with a receipt']);
		assert.deepStrictEqual(updated?.foundation.blueprint?.operations[0], { ...operation, acceptanceCriteria: [{ ...operation.acceptanceCriteria[0], then: 'order accepted with a receipt' }, operation.acceptanceCriteria[1]] });
		const unchanged = await run(model, [...answers, 'authorized buyer', 'creating an order', 'order accepted']); assert.deepStrictEqual(unchanged, model);
		assert.strictEqual(await run(model, [...answers, 'changed given', undefined]), undefined);
	});

	test('same-named type choices expose their kind and identity while keeping the current target selected', async () => {
		model.foundation.types.push({ id: 'qa.bool', name: 'Shared Name', kind: 'primitive', primitive: 'boolean', fields: [] }, { id: 'qa.string', name: 'Shared Name', kind: 'primitive', primitive: 'string', fields: [] }, { id: 'qa.list', name: 'QA List', kind: 'collection', fields: [], itemTypeId: 'qa.string' });
		const dialogs = new ScriptedDialogs(['Data and Operations', 'Shared Types', 'QA List', 'Edit Type Definition', '<focused>']);
		const edits = await editOrditoBlueprint(dialogs, model, 'component.checkout', model.views[2]); dialogs.assertComplete();
		const choices = dialogs.pickHistory.find(step => step.title === 'Declared Type')!.items.filter(item => item.label === 'Shared Name');
		assert.deepStrictEqual(choices.map(item => [item.description, item.detail]), [['primitive · boolean', 'ID: qa.bool'], ['primitive · string', 'ID: qa.string']]);
		assert.deepStrictEqual(edits?.reduce((current, edit) => applyVisualEdit(current, edit) as SemanticModelV4, model).foundation.types, model.foundation.types);
	});

	test('overloaded operation choices identify the owner, signature and stable identity', async () => {
		const operation = model.foundation.blueprint!.operations[0];
		model.foundation.blueprint!.operations.push({ ...structuredClone(operation), id: 'qa.overload', inputs: [] });
		const dialogs = new ScriptedDialogs(['Data and Operations', 'Shared Operations', 'confirmOrder', 'Rename', undefined]);
		await editOrditoBlueprint(dialogs, model, 'component.checkout', model.views[2]); dialogs.assertComplete();
		const choices = dialogs.pickHistory.find(step => step.title === 'Shared Operations')!.items.filter(item => item.label === 'confirmOrder');
		assert.strictEqual(choices.length, 2);
		assert.ok(choices.every(item => item.description && item.detail?.includes(' → ')));
		assert.ok(choices[0].detail?.includes(`ID: ${operation.id}`)); assert.ok(choices[1].detail?.includes('ID: qa.overload'));
		assert.notStrictEqual(choices[0].detail, choices[1].detail);
	});

	test('an empty operation omits the inapplicable member removal action', async () => {
		const operation = model.foundation.blueprint!.operations[0];
		Object.assign(operation, { inputs: [], outputs: [], errors: [], permissions: [], acceptanceCriteria: [] });
		const dialogs = new ScriptedDialogs(['Data and Operations', 'Shared Operations', 'confirmOrder', 'Rename', undefined]);
		await editOrditoBlueprint(dialogs, model, 'component.checkout', model.views[2]); dialogs.assertComplete();
		assert.ok(!dialogs.pickHistory.find(step => step.title === 'Operation: confirmOrder')!.items.some(item => item.label === 'Remove Contract Member'));
	});

	test('existing type constraints can be corrected or removed without changing identity, and cancellation preserves the definition', async () => {
		model.foundation.types.unshift({ id: 'qa.type.bounded', name: 'QA Bounded Integer', kind: 'primitive', primitive: 'integer', fields: [], constraints: [{ id: 'qa.minimum', kind: 'minimum', value: 0 }] });
		const answers = ['Data and Operations', 'Shared Types', 'QA Bounded Integer', 'Edit or Remove Type Constraint', 'Minimum · 0'];
		const updated = await run(model, [...answers, 'Edit Constraint Value', '5']);
		assert.deepStrictEqual(updated?.foundation.types.map(type => type.id), model.foundation.types.map(type => type.id));
		assert.deepStrictEqual(updated?.foundation.types[0]?.constraints, [{ id: 'qa.minimum', kind: 'minimum', value: 5 }]);
		const unchanged = await run(model, [...answers, 'Edit Constraint Value', '0']); assert.deepStrictEqual(unchanged?.foundation.types, model.foundation.types);
		assert.strictEqual(await run(model, [...answers, 'Edit Constraint Value', undefined]), undefined);
		const removed = await run(model, [...answers, 'Remove Constraint']); assert.deepStrictEqual(removed?.foundation.types[0]?.constraints, []);
	});

	for (const kind of ['collection', 'reference'] as const) {
		test(`unchanged ${kind} definition retains its nonfirst target type and registry position`, async () => {
			model.foundation.types.push({ id: 'qa.targetA', name: 'QA A', kind: 'primitive', primitive: 'integer', fields: [] }, { id: 'qa.targetB', name: 'QA B', kind: 'primitive', primitive: 'string', fields: [] }, { id: 'qa.wrapper', name: 'QA Wrapper', kind, fields: [], ...(kind === 'collection' ? { itemTypeId: 'qa.targetB' } : { targetTypeId: 'qa.targetB' }) });
			const updated = await run(model, ['Data and Operations', 'Shared Types', 'QA Wrapper', 'Edit Type Definition', '<focused>']);
			assert.deepStrictEqual(updated?.foundation.types, model.foundation.types);
		});
	}

	test('unchanged first field in a multi-field record keeps authored order and contract values', async () => {
		const record = { id: 'qa.record', name: 'QA Record', kind: 'record' as const, fields: [{ id: 'qa.first', name: 'first', type: '', typeId: model.foundation.types[0].id, required: false, nullable: { state: 'known' as const, value: true } }, { id: 'qa.second', name: 'second', type: '', typeId: model.foundation.types[0].id, required: true, nullable: { state: 'known' as const, value: false } }] };
		model.foundation.types.push(record);
		const updated = await run(model, ['Data and Operations', 'Shared Types', 'QA Record', 'Add or Edit Field', 'first', 'first', '<focused>', '<focused>', '<focused>']);
		assert.deepStrictEqual(updated?.foundation.types, model.foundation.types);
	});

	test('unchanged scope and container role use their current declarations', async () => {
		const container = model.semantics.elements.find(element => element.kind === 'container')!; container.runtimeKind = 'service'; container.description = 'QA service responsibility';
		const updated = await run(model, ['Structure', 'System Scope or Container Responsibility', 'Updated service responsibility', '<focused>'], undefined, container.id);
		assert.deepStrictEqual(updated?.semantics.elements.find(element => element.id === container.id), { ...container, description: 'Updated service responsibility' });
		model.semantics.elements.push({ id: 'qa.external', kind: 'system', name: 'QA External', scope: 'external' });
		const unchanged = await run(model, ['Structure', 'System Scope or Container Responsibility', '<focused>'], undefined, 'qa.external'); assert.deepStrictEqual(unchanged, model);
	});

	test('guided architecture ownership keeps the current owner and excludes invalid owners and descendants', async () => {
		const current = model.foundation.ownership.find(entry => entry.elementId === 'component.checkout')!;
		model.semantics.elements.push({ id: 'qa.child', kind: 'component', name: 'QA Child' });
		model.foundation.ownership.push({ id: 'qa.child.owner', elementId: 'qa.child', ownerId: current.elementId, role: 'architecture' });
		const dialogs = new ScriptedDialogs(['Structure', 'Architectural or Lifecycle Owner', '<focused>', '<focused>']);
		const edits = await editOrditoBlueprint(dialogs, model, current.elementId, model.views[2]); dialogs.assertComplete();
		const candidates = dialogs.pickHistory.find(step => step.title === 'Architectural or Lifecycle Owner')!.items;
		assert.ok(!candidates.some(item => item.label === 'QA Child' || item.label === 'Checkout'));
		assert.deepStrictEqual(edits?.reduce((value, edit) => applyVisualEdit(value, edit) as SemanticModelV4, model).foundation.ownership, model.foundation.ownership);
		assert.deepStrictEqual(dialogs.pickHistory.find(step => step.title === 'Ownership Role')!.items.map(item => item.label), ['Architecture']);
	});

	test('guided lifecycle ownership only offers resource, entity or class owners for a state', async () => {
		model.semantics.elements.push({ id: 'qa.resource', kind: 'resource', name: 'QA Resource' }, { id: 'qa.state', kind: 'state', name: 'QA State' });
		const dialogs = new ScriptedDialogs(['Structure', 'Architectural or Lifecycle Owner', 'QA Resource', '<focused>']);
		const edits = await editOrditoBlueprint(dialogs, model, 'qa.state', model.views[2]); dialogs.assertComplete();
		assert.ok(edits?.some(edit => edit.kind === 'ownership' && edit.entry.elementId === 'qa.state' && edit.entry.ownerId === 'qa.resource' && edit.entry.role === 'lifecycle'));
		assert.deepStrictEqual(dialogs.pickHistory.find(step => step.title === 'Ownership Role')!.items.map(item => item.label), ['Lifecycle']);
	});

	test('an existing required port keeps its current interface and direction', async () => {
		const port = model.foundation.blueprint!.ports.find(port => port.direction === 'required')!;
		const contract = model.foundation.blueprint!.interfaces.find(contract => contract.id === port.interfaceId)!;
		const name = model.semantics.elements.find(element => element.id === contract.elementId)!.name;
		const updated = await run(model, ['Connections', 'Provided or Required Interface', name, '<focused>', '<focused>'], undefined, port.elementId);
		assert.deepStrictEqual(updated?.foundation.blueprint?.ports, model.foundation.blueprint!.ports);
	});

	test('a new C4 view starts with only its chosen subject selected', async () => {
		const dialogs = new ScriptedDialogs(['Structure', 'C4 View Subject and Context', 'Create New', 'L3 · Components', 'API', 'QA New View', [], ['API']]);
		await editOrditoBlueprint(dialogs, model, 'component.checkout', model.views[2]); dialogs.assertComplete();
		assert.deepStrictEqual(dialogs.pickHistory.find(step => step.title === 'Visible Elements')!.items.filter(item => item.picked).map(item => item.label), ['API']);
	});

	test('C4 element selections identify searchable types, ownership, descriptions and same-named identities', async () => {
		model.semantics.elements.push({ id: 'usecase.checkout', kind: 'useCase', name: 'Checkout' });
		model.foundation.ownership.push({ id: 'usecase.owner', elementId: 'usecase.checkout', ownerId: 'system.shop', role: 'architecture' });
		const dialogs = new ScriptedDialogs(['Create New', 'L3 · Components', 'API', 'QA New View', [], ['API']]);
		await editOrditoBlueprint(dialogs, model, '', model.views[2], 'c4'); dialogs.assertComplete();
		const selections = dialogs.pickHistory.filter(step => ['View Subject', 'Context Dependencies (Outside the Subject)', 'Visible Elements'].includes(step.title!));
		assert.ok(selections.every(step => step.matchOnDescription && step.matchOnDetail));
		const metadata = (items: IQuickPickItem[]) => items.filter(item => ['Buyer', 'API', 'Checkout'].includes(item.label)).map(item => [item.label, item.description, item.detail]);
		const expected = [
			['Buyer', 'Actor', 'Checkout Blueprint'],
			['API', 'Application / Container', 'Checkout Blueprint / Shop · Owns checkout and audit responsibilities'],
			['Checkout', 'Component', 'Checkout Blueprint / Shop / API · Confirms an order and requests stock · ID: component.checkout'],
			['Checkout', 'Feature', 'Checkout Blueprint · ID: feature.checkout'],
			['Checkout', 'Use Case', 'Checkout Blueprint / Shop · ID: usecase.checkout']
		];
		assert.deepStrictEqual(selections.map(step => metadata(step.items)), [[expected[1]], expected, expected]);
	});

	test('direct visibility editing keeps existing selections, coordinates, scope and view metadata', async () => {
		const view = model.views[2]; view.featureId = 'feature.checkout';
		model.semantics.elements.push({ id: 'component.receipts', kind: 'component', name: 'Receipts' });
		model.foundation.ownership.push({ id: 'receipts.owner', elementId: 'component.receipts', ownerId: 'container.api', role: 'architecture' });
		const dialogs = new ScriptedDialogs([['API', 'Stock', 'Checkout Blueprint / Shop / API · Confirms an order and requests stock · ID: component.checkout', 'Receipts']]);
		const before = structuredClone(model);
		const edits = await editOrditoBlueprint(dialogs, model, '', view, 'c4Visibility'); dialogs.assertComplete();
		assert.deepStrictEqual(dialogs.pickHistory[0].items.filter(item => item.picked).map(item => item.label).sort(), view.nodes.map(node => model.semantics.elements.find(element => element.id === node.elementId)!.name).sort());
		assert.deepStrictEqual(edits, [{ kind: 'c4View', view: { ...view, nodes: [...['container.api', 'component.stock', 'component.checkout'].map(id => view.nodes.find(node => node.elementId === id)!), { elementId: 'component.receipts', x: 0, y: 180 }], relationIds: ['relation.stock'] } }]);
		assert.deepStrictEqual(model, before);
	});

	test('direct dependency editing keeps visible nodes and changes only context identities', async () => {
		const view = model.views[2];
		const dialogs = new ScriptedDialogs([['Money', 'Stock', 'Payments']]);
		const edits = await editOrditoBlueprint(dialogs, model, '', view, 'c4Dependencies'); dialogs.assertComplete();
		assert.deepStrictEqual(dialogs.pickHistory[0].items.filter(item => item.picked).map(item => item.label).sort(), view.contextIds!.map(id => model.semantics.elements.find(element => element.id === id)!.name).sort());
		assert.deepStrictEqual(edits, [{ kind: 'c4View', view: { ...view, contextIds: ['package.money', 'component.stock', 'system.payments'] } }]);
	});

	for (const mode of ['c4Visibility', 'c4Dependencies'] as const) {
		test(`canceling ${mode} leaves the model unchanged`, async () => {
			assert.strictEqual(await run(model, [undefined], mode), undefined);
		});
	}

	test('C4 scope editing preserves subject identity, existing coordinates and foreign context', async () => {
		const updated = await run(model, ['Structure', 'C4 View Subject and Context', 'API Components', '<focused>', '<focused>', 'API Components', ['Money', 'Stock', 'Checkout API'], ['API', 'Checkout', 'Audit', 'Money', 'Stock', 'Checkout API']]);
		assert.deepStrictEqual(updated?.views[2], model.views[2]);
	});
	test('decision status changes create one tracked revision and preserve reasons', async () => {
		const updated = await run(model, ['1 · Declared stock protocol', 'Change Status', 'Deprecated'], 'decision');
		const decision = updated?.foundation.decisions.find(decision => decision.id === 'adr.transport');
		assert.deepStrictEqual([decision?.status, decision?.record?.history[0].revision, decision?.record?.history[0].decision], ['deprecated', 'adr.1', 'Use the declared protocol for stock requests']);
	});
	test('unchanged memberships preserve the full registry order and identities', async () => {
		const selected = model.foundation.memberships.filter(entry => entry.elementId === 'component.checkout').map(entry => model.semantics.elements.find(element => element.id === entry.featureId)!.name);
		const updated = await run(model, ['Structure', 'Feature Memberships', selected]);
		assert.deepStrictEqual(updated?.foundation.memberships, model.foundation.memberships);
	});

	test('feature membership editing keeps ownership and shared identity unchanged', async () => {
		const updated = await run(model, ['Structure', 'Feature Memberships', ['Checkout', 'Audit']]);
		assert.deepStrictEqual(updated?.foundation.ownership, model.foundation.ownership);
		assert.deepStrictEqual(updated?.foundation.memberships.filter(entry => entry.elementId === 'component.checkout').map(entry => entry.featureId), ['feature.checkout', 'feature.audit']);
	});

	test('existing transport editing keeps the declared payload type focused', async () => {
		const relation = model.semantics.relations[0];
		assert.ok(relation);
		model.foundation.blueprint!.transports = [{ id: 'qa.transport', relationId: relation.id, protocol: 'HTTPS', format: 'JSON', schemaTypeId: 'type.order', schemaVersion: '1.0.0' }];
		const dialogs = new ScriptedDialogs(['Connections', 'Transport Contract', relation.name, 'HTTPS', 'JSON', '<focused>', '1.0.0']);
		const edits = await editOrditoBlueprint(dialogs, model, '', model.views[2]); dialogs.assertComplete();
		assert.strictEqual((edits?.[0] as { entry: { schemaTypeId: string } }).entry.schemaTypeId, 'type.order');
	});

	test('an empty transport editor explains the missing relationship prerequisite', async () => {
		model.semantics.relations = [];
		const dialogs = new ScriptedDialogs(['Connections', 'Transport Contract']);
		await assert.rejects(editOrditoBlueprint(dialogs, model, '', model.views[2]), /Create a relationship/); dialogs.assertComplete();
	});

	test('unchanged knowledge editing preserves subject, property, unknown state, acceptance and revision metadata', async () => {
		const target = model.semantics.elements.find(element => element.id === 'component.checkout')!;
		const entry = { id: 'qa.assertion', subject: { kind: 'element' as const, id: target.id }, field: '/name', value: { state: 'unknown' as const, reason: 'Confirm the public name' }, provenance: { kind: 'observed' as const, producer: 'qa', revision: 'qa.provenance' }, acceptance: { status: 'accepted' as const, revision: 'qa.acceptance' }, evidenceIds: ['qa.evidence'] };
		model.foundation.assertions = [entry];
		const dialogs = new ScriptedDialogs(['Decisions', 'Knowledge and Acceptance', `${target.name} · /name`, '<focused>', '<focused>', '<focused>', 'Confirm the public name', '<focused>']);
		assert.strictEqual(await editOrditoBlueprint(dialogs, model, '', model.views[2]), undefined); dialogs.assertComplete();
		assert.deepStrictEqual(model.foundation.assertions, [entry]);
		const subjects = dialogs.pickHistory.find(step => step.title === 'Constraint or Assertion Subject')!.items;
		assert.ok(subjects.every(item => item.description && item.detail?.startsWith('ID: ')));
	});


	test('knowledge assertions can address collection properties and retain numeric zero', async () => {
		model.foundation.types.push({ id: 'qa.range', name: 'QA Range', kind: 'primitive', primitive: 'number', fields: [], constraints: [{ id: 'qa.minimum', kind: 'minimum', value: 0 }] });
		const updated = await run(model, ['Decisions', 'Knowledge and Acceptance', 'Create New', 'QA Range', '/constraints/0/value', 'Known Value', '0', 'Accepted']);
		const assertion = updated!.foundation.assertions.at(-1)!;
		assert.deepStrictEqual([assertion.subject, assertion.field, assertion.value], [{ kind: 'type', id: 'qa.range' }, '/constraints/0/value', { state: 'known', value: 0 }]);
	});

});
