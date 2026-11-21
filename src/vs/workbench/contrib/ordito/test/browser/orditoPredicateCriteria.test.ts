import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { createPureProject } from '../../common/modelProject.js';
import { editOrditoPredicateCriteria } from '../../browser/orditoPredicateCriteria.js';
import { ScriptedDialogs } from './orditoBlueprintEditing.test.js';

suite('Specsplice visual predicate cases', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	function fixture() { let id = 0; const data = createPureProject('QA', () => `qa.${++id}`); return { ...data, operation: data.model.foundation.blueprint!.operations[0] }; }
	test('authors boundary inputs and expected outcomes independently, retaining their criterion binding', async () => {
		const f = fixture(), previous = { ...f.criteria, cases: [] };
		const dialogs = new ScriptedDialogs(['Add Predicate Test Case', 'Zero quantity', `Value for ${f.operation.inputs[0].name}`, '0', 'Not Satisfied']);
		const next = await editOrditoPredicateCriteria(dialogs, f.model, previous); dialogs.assertComplete();
		assert.deepStrictEqual(next?.cases, [{ id: 'Zero quantity', predicateId: f.model.foundation.predicates![0].id, criterionId: f.operation.acceptanceCriteria[0].id, input: { [f.operation.inputs[0].id!]: 0 }, expected: false }]);
		assert.deepStrictEqual(previous.cases, []);
	});
	test('authors an invalid input through a typed control without using a JSON editor', async () => {
		const f = fixture();
		const dialogs = new ScriptedDialogs(['Add Predicate Test Case', 'Invalid quantity', 'Different Value Type', 'Text', 'bad input', 'Input Type Error']);
		const next = await editOrditoPredicateCriteria(dialogs, f.model, { ...f.criteria, cases: [] }); dialogs.assertComplete();
		assert.deepStrictEqual([next?.cases[0].input, next?.cases[0].expected], [{ [f.operation.inputs[0].id!]: 'bad input' }, 'typeError']);
	});
	test('asks which criterion to use when an operation has more than one', async () => {
		const f = fixture();
		const other = { ...f.operation.acceptanceCriteria[0], id: 'qa.alternative', then: 'Reject zero quantity' };
		f.operation.acceptanceCriteria.push(other);
		const dialogs = new ScriptedDialogs(['Add Predicate Test Case', other.then, 'Zero quantity', `Value for ${f.operation.inputs[0].name}`, '0', 'Not Satisfied']);
		const next = await editOrditoPredicateCriteria(dialogs, f.model, { ...f.criteria, cases: [] });
		dialogs.assertComplete();
		assert.strictEqual(next?.cases[0].criterionId, other.id);
	});
	test('changing inputs retains the independent expected result and leaves the previous criteria intact', async () => {
		const f = fixture(), before = structuredClone(f.criteria), target = before.cases[0];
		const dialogs = new ScriptedDialogs([target.id, 'Edit Inputs', `Value for ${f.operation.inputs[0].name}`, '0']);
		const next = await editOrditoPredicateCriteria(dialogs, f.model, f.criteria); dialogs.assertComplete();
		assert.deepStrictEqual([next?.cases[0].input, next?.cases[0].expected, f.criteria], [{ [f.operation.inputs[0].id!]: 0 }, target.expected, before]);
	});
	test('removing a case requires confirmation and preserves the other authored cases', async () => {
		const f = fixture(), before = structuredClone(f.criteria), target = before.cases[0];
		const keep = new ScriptedDialogs([target.id, 'Delete Case', '<focused>']);
		assert.strictEqual(await editOrditoPredicateCriteria(keep, f.model, f.criteria), undefined); keep.assertComplete();
		const remove = new ScriptedDialogs([target.id, 'Delete Case', 'Delete Case']);
		const next = await editOrditoPredicateCriteria(remove, f.model, f.criteria); remove.assertComplete();
		assert.deepStrictEqual([next?.cases, f.criteria], [before.cases.slice(1), before]);
	});
	test('confirming an unchanged expected result or canceling a new case does not publish a new revision', async () => {
		const f = fixture(), before = structuredClone(f.criteria), target = before.cases[0];
		const dialogs = new ScriptedDialogs([target.id, 'Edit Expected Result', '<focused>']);
		assert.strictEqual(await editOrditoPredicateCriteria(dialogs, f.model, f.criteria), undefined); dialogs.assertComplete();
		const canceled = new ScriptedDialogs(['Add Predicate Test Case', undefined]);
		assert.strictEqual(await editOrditoPredicateCriteria(canceled, f.model, f.criteria), undefined); canceled.assertComplete(); assert.deepStrictEqual(f.criteria, before);
	});
});
