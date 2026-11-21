import assert from 'assert';
import { nodeOrdersFixture } from '../common/nodeOrdersFixture.js';
import { ScriptedDialogs } from './orditoBlueprintEditing.test.js';
import { buildOrditoExpression, editOrditoPredicate } from '../../browser/orditoPredicateEditing.js';
import { applyVisualEdit } from '../../common/visualEditing.js';

suite('Specsplice pure predicate editing', () => {
	test('canceling a detached reset preserves the original authored graph', async () => {
		const model = structuredClone(nodeOrdersFixture); const before = structuredClone(model);
		const dialogs = new ScriptedDialogs(['submitOrder', 'predicate.positive', 'Precondition · Inputs Only', 'Clear Detached Expression', undefined]);
		assert.strictEqual(await editOrditoPredicate(dialogs, model, 'component.checkout'), undefined); dialogs.assertComplete(); assert.deepStrictEqual(model, before);
	});
	test('editing phase preserves predicate and node identities with an atomic semantic edit', async () => {
		const model = structuredClone(nodeOrdersFixture);
		const dialogs = new ScriptedDialogs(['submitOrder', 'predicate.positive', 'Postcondition · Inputs and Outputs', 'Choose Result and Save', 'positive']);
		const edits = await editOrditoPredicate(dialogs, model); dialogs.assertComplete(); assert.strictEqual(edits?.length, 1);
		const updated = applyVisualEdit(model, edits![0]); assert.strictEqual(updated.version, 4);
		if (updated.version === 4) { assert.deepStrictEqual(updated.foundation.predicates, [{ ...model.foundation.predicates![0], phase: 'post' }]); }
	});
	test('typed literal choices are native items with validated safe integer values', async () => {
		const dialogs = new ScriptedDialogs(['submitOrder', 'predicate.positive', 'Precondition · Inputs Only', 'Add Value', 'Add Typed Literal', 'Quantity', '2', 'Choose Result and Save', 'positive']);
		const edits = await editOrditoPredicate(dialogs, structuredClone(nodeOrdersFixture)); dialogs.assertComplete();
		assert.strictEqual(edits?.[0].kind, 'predicate'); if (edits?.[0].kind === 'predicate') { const last = edits[0].entry.nodes.at(-1)!; assert.deepStrictEqual({ ...last, id: 'tool-assigned' }, { id: 'tool-assigned', kind: 'literal', typeId: 'type.quantity', value: 2 }); }
	});
	test('predicate results offer only true or false conditions, preserving added values', async () => {
		const model = structuredClone(nodeOrdersFixture), dialogs = new ScriptedDialogs(['submitOrder', 'predicate.positive', 'Precondition · Inputs Only', 'Add Value', 'Add Typed Literal', 'Quantity', '2', 'Choose Result and Save', 'positive']);
		const edits = await editOrditoPredicate(dialogs, model); dialogs.assertComplete();
		assert.strictEqual(edits?.[0].kind, 'predicate');
		if (edits?.[0].kind === 'predicate') { assert.strictEqual(edits[0].entry.nodes.at(-1)?.kind, 'literal'); assert.strictEqual(edits[0].entry.rootId, 'positive'); }
		assert.deepStrictEqual(dialogs.pickHistory.at(-1)?.items.map(item => item.detail), ['positive']);
		assert.deepStrictEqual(model, nodeOrdersFixture);
	});
	test('canceling result selection preserves the authored graph', async () => {
		const model = structuredClone(nodeOrdersFixture), dialogs = new ScriptedDialogs(['submitOrder', 'predicate.positive', 'Precondition · Inputs Only', 'Choose Result and Save', undefined]);
		assert.strictEqual(await editOrditoPredicate(dialogs, model), undefined); dialogs.assertComplete(); assert.deepStrictEqual(model, nodeOrdersFixture);
	});
	test('an incomplete scalar predicate offers composition before saving a result', async () => {
		const dialogs = new ScriptedDialogs(['Add Typed Literal', 'Quantity', '2', 'Add Value', undefined]);
		assert.strictEqual(await buildOrditoExpression(dialogs, nodeOrdersFixture, [], undefined, true), undefined); dialogs.assertComplete();
		assert.deepStrictEqual(dialogs.pickHistory.at(-1)?.items.map(item => item.label), ['Add Value', 'Combine Values', 'Clear Detached Expression']);
	});
	test('editing a postcondition keeps its current scope selected', async () => {
		const model = structuredClone(nodeOrdersFixture); model.foundation.predicates![0].phase = 'post';
		const dialogs = new ScriptedDialogs(['submitOrder', 'predicate.positive', '<focused>', 'Choose Result and Save', 'positive']);
		const edits = await editOrditoPredicate(dialogs, model); dialogs.assertComplete();
		assert.strictEqual(edits?.[0].kind === 'predicate' && edits[0].entry.phase, 'post');
	});
	test('literal text is stored exactly as typed rather than decoded as JSON', async () => {
		const model = structuredClone(nodeOrdersFixture), type = model.foundation.types.find(type => type.primitive === 'string')!;
		const text = 'ciao "world"';
		const dialogs = new ScriptedDialogs(['submitOrder', 'predicate.positive', '<focused>', 'Add Value', 'Add Typed Literal', type.name, text, 'Choose Result and Save', 'positive']);
		const edits = await editOrditoPredicate(dialogs, model); dialogs.assertComplete();
		assert.deepStrictEqual(edits?.[0].kind === 'predicate' ? edits[0].entry.nodes.at(-1) : undefined, { id: edits?.[0].kind === 'predicate' ? edits[0].entry.nodes.at(-1)!.id : '', kind: 'literal', typeId: type.id, value: text });
	});

});
