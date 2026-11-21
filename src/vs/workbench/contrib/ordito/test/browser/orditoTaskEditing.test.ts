import assert from 'assert';
import { ScriptedDialogs } from './orditoBlueprintEditing.test.js';
import { editOrditoTask } from '../../browser/orditoTaskEditing.js';
import { specificationEditors, specificationRows } from '../../browser/orditoSpecificationContent.js';
import { readinessEditor } from '../../browser/orditoDiagnostics.js';
import { applyVisualEdit } from '../../common/visualEditing.js';
import { validateSemanticModel } from '../../common/modelValidation.js';
import { type SemanticModelV4 } from '../../common/modelTypes.js';
import { nodeOrdersFixture } from '../common/nodeOrdersFixture.js';
import { messagingFixture } from '../common/messagingFixture.js';
import { describeOrditoDiagram } from '../../browser/orditoAccessibleContent.js';

suite('Specsplice task intent and guided properties', () => {
	async function edit(model: SemanticModelV4, answers: (string | string[] | undefined)[]) {
		const before = structuredClone(model), dialogs = new ScriptedDialogs(answers), edits = await editOrditoTask(dialogs, model); dialogs.assertComplete(); assert.deepStrictEqual(model, before);
		return edits?.reduce((current, edit) => applyVisualEdit(current, edit) as SemanticModelV4, model);
	}
	test('checkout task and clarification use native text fields, preserve identity and record a new intent revision', async () => {
		const first = (await edit(nodeOrdersFixture, ['Create Task', 'submitOrder', 'Quantity must be positive']))!;
		const updated = (await edit(first, ['Quantity must be positive', 'Add Clarification', 'May quantity equal zero?', 'No, reject zero']))!;
		const task = updated.foundation.tasks![0]; assert.strictEqual(task.id, first.foundation.tasks![0].id); assert.notStrictEqual(task.revision, first.foundation.tasks![0].revision);
		assert.deepStrictEqual(task.clarifications, [{ question: 'May quantity equal zero?', answer: 'No, reject zero' }]); assert.strictEqual(task.history[0].text, 'Quantity must be positive'); assert.deepStrictEqual(validateSemanticModel(updated), []);
	});
	test('canceling the answer leaves the previous task, layout and behavior unchanged', async () => {
		const first = (await edit(nodeOrdersFixture, ['Create Task', 'submitOrder', 'Keep bounds strict']))!;
		assert.strictEqual(await edit(first, ['Keep bounds strict', 'Add Clarification', 'Question', undefined]), undefined);
	});
	test('async topology gets its own scoped task without copying operation definitions', async () => {
		const updated = (await edit(messagingFixture, ['Create Task', 'Messaging · Fulfilment Queue, Order Confirmed Topic', 'Retry billing twice before the dead letter']))!;
		assert.strictEqual(updated.foundation.tasks![0].target.kind, 'messaging'); assert.deepStrictEqual(updated.foundation.blueprint, messagingFixture.foundation.blueprint);
	});
	test('properties vary by semantic level and diagnostics route directly to typed editors', () => {
		const system = specificationEditors(nodeOrdersFixture, 'system.orders'), component = specificationEditors(nodeOrdersFixture, 'component.checkout');
		assert.ok(system.some(item => item.mode === 'scope')); assert.ok(!system.some(item => item.mode === 'types')); assert.ok(component.some(item => item.mode === 'operations'));
		for (const [action, object, mode] of [['chooseTechnology', 'element', 'binding'], ['resolveOwnership', 'element', 'owner'], ['resolveType', 'operation', 'operations'], ['resolveDecision', 'decision', 'decision'], ['acceptAssertion', 'element', 'assertion']] as const) {
			assert.strictEqual(readinessEditor({ action, object: { kind: object, id: 'object' }, code: 'x', severity: 'error', phase: 'generation', field: '/x', args: [] }).mode, mode);
		}
		assert.strictEqual(readinessEditor({ action: 'completeBehavior', object: { kind: 'stateMachine', id: 'x' }, code: 'x', severity: 'error', phase: 'generation', field: '/x', args: [] }).command, 'ordito.stateMachine');
	});
	test('accessible reading retains authored clarifications, unknown reasons and provenance', async () => {
		const model = (await edit(nodeOrdersFixture, ['Create Task', 'submitOrder', 'Keep quantity strict']))!;
		model.foundation.assertions.push({ id: 'fact.unknown', subject: { kind: 'element', id: 'component.checkout' }, field: '/description', value: { state: 'unknown', reason: 'Ask the domain owner' }, provenance: { kind: 'authored', producer: 'reviewer', revision: '1' }, acceptance: { status: 'proposed', revision: '1' } });
		const text = describeOrditoDiagram({ model, activeView: model.views[0], selectedId: 'component.checkout', section: 'element', loading: false, error: undefined, saveError: undefined, dirty: false, editable: true, diagnostics: [] });
		for (const line of specificationRows(model, 'component.checkout')) { assert.ok(text.includes(line), line); }
		assert.ok(text.includes('Ask the domain owner')); assert.ok(text.includes('authored / reviewer')); assert.ok(text.includes('Keep quantity strict'));
	});
});
