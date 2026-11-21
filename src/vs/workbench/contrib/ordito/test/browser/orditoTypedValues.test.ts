import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { orditoTypedValues, readOrditoScalar } from '../../browser/orditoTypedValues.js';
import { ScriptedDialogs } from './orditoBlueprintEditing.test.js';
import { nodeOrdersFixture } from '../common/nodeOrdersFixture.js';

suite('Specsplice visual typed values', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('text, empty strings, zero and false need no serialization syntax', async () => {
		for (const [primitive, answers, expected, current] of [['string', ['ciao'], 'ciao', undefined], ['string', [''], '', undefined], ['integer', ['0'], 0, undefined], ['boolean', ['<focused>'], false, false]] as const) {
			const dialogs = new ScriptedDialogs([...answers]); assert.strictEqual(await readOrditoScalar(dialogs, primitive, 'Value', current), expected); dialogs.assertComplete();
		}
	});
	test('negative cases distinguish a missing field, null, zero and a deliberately different type', async () => {
		const fields = ['zero', 'null', 'missing', 'wrong'].map(id => ({ id, name: id, type: '', typeId: 'type.quantity', required: true }));
		const dialogs = new ScriptedDialogs(['Value for zero', '0', 'Null', 'Absent', 'Different Value Type', 'Text', 'not a number']);
		const data = await orditoTypedValues(dialogs, nodeOrdersFixture, { negativeCases: true }).fields(fields); dialogs.assertComplete();
		assert.deepStrictEqual(data, { zero: 0, null: null, wrong: 'not a number' });
	});
	test('editing and deleting collection items preserves empty string values', async () => {
		const model = structuredClone(nodeOrdersFixture); model.foundation.types.push({ id: 'qa.texts', name: 'Texts', kind: 'collection', itemTypeId: model.foundation.types.find(type => type.primitive === 'string')!.id, fields: [] });
		const dialogs = new ScriptedDialogs(['Item 1', 'Edit Item', '', 'Item 2', 'Remove Item', 'Finish Collection']);
		assert.deepStrictEqual(await orditoTypedValues(dialogs, model).scalar('qa.texts', 'Texts', 0, ['before', 'remove']), ['']); dialogs.assertComplete();
	});
	test('canceling after editing a value preserves the supplied input record', async () => {
		const original = { first: 2, second: 3 }, fields = Object.keys(original).map(id => ({ id, name: id, type: '', typeId: 'type.quantity', required: true }));
		const dialogs = new ScriptedDialogs(['7', undefined]);
		assert.strictEqual(await orditoTypedValues(dialogs, nodeOrdersFixture).fields(fields, 0, original), undefined); dialogs.assertComplete(); assert.deepStrictEqual(original, { first: 2, second: 3 });
	});
});
