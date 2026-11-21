import assert from 'assert';
import { ScriptedDialogs } from './orditoBlueprintEditing.test.js';
import { stateFixture, stateCriteriaFixture } from '../common/stateFixture.js';
import { editOrditoStateMachine } from '../../browser/orditoStateEditing.js';
import { editOrditoStateCriteria } from '../../browser/orditoStateCriteria.js';
import { applyVisualEdit } from '../../common/visualEditing.js';
import { validateModelStateMachine } from '../../common/modelStates.js';
import { orditoStateRows, describeOrditoStateSimulation } from '../../browser/orditoStateContent.js';
import { describeOrditoDiagram } from '../../browser/orditoAccessibleContent.js';

suite('Specsplice executable state editing', () => {
	test('canceling a nested transition leaves all definitions untouched', async () => { const m = structuredClone(stateFixture), before = structuredClone(m), dialogs = new ScriptedDialogs(['Checkout', 'Add or Edit Transition', 'Draft → Paid', 'Draft', undefined]); assert.strictEqual(await editOrditoStateMachine(dialogs, m), undefined); dialogs.assertComplete(); assert.deepStrictEqual(m, before); });
	test('native transition edit preserves stable IDs, uses explicit policy and one undo transaction', async () => {
		const dialogs = new ScriptedDialogs(['Checkout', 'Add or Edit Transition', 'Draft → Paid', 'Draft', 'Paid', 'pay', 'External · Cancel Do, Exit, Effect, Entry, Start Do', '5', 'Typed Guard', 'Choose Result and Save', 'comparison', ['action.charge'], 'Validate and Save State Machine']);
		const edits = await editOrditoStateMachine(dialogs, stateFixture); dialogs.assertComplete(); assert.strictEqual(edits?.length, 1); const result = applyVisualEdit(stateFixture, edits![0]); if (result.version !== 4) { assert.fail(); }
		assert.strictEqual(result.foundation.stateMachines![0].transitions[0].priority, 5); assert.deepStrictEqual(result.foundation.stateMachines![0].transitions.map(t => t.id), stateFixture.foundation.stateMachines![0].transitions.map(t => t.id)); assert.deepStrictEqual(validateModelStateMachine(result, 'checkout.lifecycle'), []);
	});
	test('creating a flat lifecycle and state uses native typed fields with an atomic batch', async () => {
		const dialogs = new ScriptedDialogs(['Create Flat State Machine', 'initialize', 'Add or Edit State', 'Create State', 'Only State', 'Initial State', [], [], 'No Do Activity', 'Validate and Save State Machine']);
		const edits = await editOrditoStateMachine(dialogs, stateFixture); dialogs.assertComplete(); assert.strictEqual(edits?.length, 2); let next = stateFixture; for (const edit of edits!) { const value = applyVisualEdit(next, edit); if (value.version !== 4) { assert.fail(); } next = value; } const created = next.foundation.stateMachines!.at(-1)!; assert.deepStrictEqual(validateModelStateMachine(next, created.id), []); assert.strictEqual(next.semantics.elements.find(e => e.id === created.initialIds[0])?.name, 'Only State');
	});
	test('canceled independent state criteria do not create generated oracles', async () => { const previous = structuredClone(stateCriteriaFixture), dialogs = new ScriptedDialogs(['Checkout', undefined]); assert.strictEqual(await editOrditoStateCriteria(dialogs, stateFixture, previous), undefined); dialogs.assertComplete(); assert.deepStrictEqual(previous, stateCriteriaFixture); });
	test('native controls author independent state outcomes and ordered phases before simulation', async () => {
		const answers = ['Checkout', 'The independently authored state and action order hold', 'Settled Draft', '42', ...Array.from({ length: 6 }, () => ['Add Successful Reply', '0', 'Finish Replies for This Occurrence']).flat(), 'Finish Event Sequence', 'Draft', '', 'completed', 'message.draftEntry', 'message.watch', 'Finish Expected Order', 'entry: draftEntry', 'doStart: watch', 'doCompleted: watch', 'Finish Expected Order'];
		const dialogs = new ScriptedDialogs(answers), result = await editOrditoStateCriteria(dialogs, stateFixture, { version: 1, revision: '1', cases: [] }); dialogs.assertComplete();
		assert.deepStrictEqual(result?.states?.[0].expected, { stateId: 'Draft', error: null, doStatus: 'completed', statuses: [], errors: [], transitions: [], calls: ['message.draftEntry', 'message.watch'], phases: ['entry:draftEntry', 'doStart:watch', 'doCompleted:watch'] });
	});
	test('event replies can explicitly reuse initialization data or remain independently authored', async () => {
		for (const reuse of [true, false]) {
			const previous = { version: 1 as const, revision: '1', cases: [] };
			const answers = ['Checkout', 'The independently authored state and action order hold', 'Paid case', '42', ...Array.from({ length: 6 }, () => ['Add Successful Reply', '0', 'Finish Replies for This Occurrence']).flat(), 'pay', 'payment-1', '10', reuse ? 'Reuse Initialization Replies' : 'Author Replies for This Event', ...(reuse ? [] : Array(6).fill('Finish Replies for This Occurrence')), 'Checkpoint and Reopen', 'accepted', 'transition.pay', 'Finish Event Sequence', 'Paid', '', 'none', 'Finish Expected Order', 'Finish Expected Order'];
			const dialogs = new ScriptedDialogs(answers), result = await editOrditoStateCriteria(dialogs, stateFixture, previous); dialogs.assertComplete();
			const scenario = result!.states![0].scenario;
			assert.strictEqual(scenario.events[0].reopen, true);
			assert.notStrictEqual(scenario.events[0].replies, scenario.replies);
			if (reuse) { assert.deepStrictEqual(scenario.events[0].replies, scenario.replies); }
			else { assert.notDeepStrictEqual(scenario.events[0].replies, scenario.replies); }
			assert.deepStrictEqual(previous, { version: 1, revision: '1', cases: [] });
		}
	});
	test('accessible reading and simulation describe policy, order and exact failures', () => {
		const text = describeOrditoDiagram({ model: stateFixture, activeView: stateFixture.views[0], selectedId: '', section: 'diagram', loading: false, error: undefined, saveError: undefined, dirty: false, editable: true, diagnostics: [] }); for (const row of orditoStateRows(stateFixture, 'checkout.lifecycle')) { assert.ok(text.includes(row.text)); }
		const result = describeOrditoStateSimulation(stateFixture, 'checkout.lifecycle', stateCriteriaFixture.states![2].expected); for (const value of ['Draft', 'denied', 'doCancelled · action.watch', 'effect · action.charge', 'Zero AI Calls']) { assert.ok(result.includes(value), value); }
	});
});
