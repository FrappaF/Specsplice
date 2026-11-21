import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { emptyFoundation } from '../../common/modelFoundation.js';
import { describeModelInteraction } from '../../common/modelInteractions.js';
import { type ModelView, type SemanticModelV5 } from '../../common/modelTypes.js';
import { InvalidSemanticModelError, validateSemanticModel } from '../../common/modelValidation.js';
import { getScenarioStepSiblings } from '../../common/visualEditScenario.js';
import { applyVisualEdit, type VisualEdit } from '../../common/visualEditing.js';

function fixture(): SemanticModelV5 {
	const foundation = emptyFoundation();
	foundation.occurrences = [
		{ id: 'request', profile: 'descriptive', name: 'Request', from: 'client', to: 'server', evidenceIds: [] },
		{ id: 'store-call', profile: 'descriptive', name: 'Store call', from: 'server', to: 'store', evidenceIds: [] },
		{ id: 'response', profile: 'descriptive', name: 'Response', from: 'server', to: 'client', evidenceIds: [] },
		{ id: 'unrelated', profile: 'descriptive', name: 'Unrelated', from: 'server', to: 'client', evidenceIds: [] }
	];
	foundation.interactions = [
		{
			id: 'scenario', profile: 'descriptive', occurrenceIds: ['request', 'store-call', 'response'], frameIds: [],
			description: {
				trigger: 'Request received', scope: 'One request', participantIds: ['client', 'server', 'store'], evidenceIds: [],
				order: [
					{ before: 'request', after: 'store-call', basis: 'authored', evidenceIds: [] },
					{ before: 'store-call', after: 'response', basis: 'authored', evidenceIds: [] }
				]
			}
		},
		{
			id: 'other-scenario', profile: 'descriptive', occurrenceIds: ['unrelated'], frameIds: [],
			description: { trigger: 'Other scenario', scope: 'Independent', participantIds: ['server', 'client'], evidenceIds: [], order: [] }
		}
	];
	const nodeIds = ['client', 'server', 'store'];
	const view = (kind: ModelView['kind'], visible: readonly string[], interactionId?: string): ModelView => ({
		id: kind, name: kind, kind, nodes: visible.map((elementId, index) => ({ elementId, x: 260 * index, y: 0 })),
		relationIds: [], ...(interactionId ? { interactionId } : {})
	});
	return {
		version: 5, id: 'scenario-project', name: 'Scenario Project', foundation, codeMappings: [], verifications: [],
		semantics: {
			elements: [
				{ id: 'client', name: 'Client', kind: 'actor' }, { id: 'server', name: 'Server', kind: 'component' },
				{ id: 'store', name: 'Store', kind: 'resource' }, { id: 'monitor', name: 'Monitor', kind: 'component' }
			],
			relations: []
		},
		views: [view('sequence', nodeIds, 'scenario'), view('activity', nodeIds, 'scenario'), view('structure', [...nodeIds, 'monitor'])]
	};
}

function apply(model: SemanticModelV5, ...edits: VisualEdit[]): SemanticModelV5 {
	let nextId = 0;
	return edits.reduce((model, edit) => applyVisualEdit(model, edit, () => 'edit-' + ++nextId) as SemanticModelV5, model);
}

const known = (value: string) => ({ state: 'known' as const, value });

suite('Specsplice editable descriptive scenarios', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('create and reuse participants across linked projections without copying or changing other diagrams', () => {
		const original = fixture();
		const model = apply(original,
			{ kind: 'element', viewId: 'sequence', id: 'validator', elementKind: 'component', name: 'Validator' },
			{ kind: 'include', viewId: 'activity', id: 'monitor' },
			{ kind: 'sequenceOrder', viewId: 'sequence', id: 'monitor', target: 'participant', direction: -1 });
		const participantIds = ['client', 'server', 'store', 'monitor', 'validator'];
		assert.deepStrictEqual(model.views.slice(0, 2).map(view => view.nodes.map(node => node.elementId)), [participantIds, participantIds]);
		assert.deepStrictEqual(model.foundation.interactions[0].description?.participantIds, participantIds);
		assert.strictEqual(model.foundation.interactions[0].authored, true);
		assert.deepStrictEqual(model.views.at(-1), original.views.at(-1));
		assert.deepStrictEqual(model.foundation.interactions.slice(1), original.foundation.interactions.slice(1));
		assert.strictEqual(model.semantics.elements.filter(node => node.id === 'monitor').length, 1);
		assert.deepStrictEqual(validateSemanticModel(model), []);
	});

	test('create and edit branches and order their steps without replacing scenario, frame or operand IDs', () => {
		const original = fixture();
		const frameEdit: Extract<VisualEdit, { kind: 'scenarioFrame' }> = {
			kind: 'scenarioFrame', viewId: 'activity', id: 'payment-branch', operator: 'alt',
			operands: [{ id: 'approved', condition: known('Approved'), steps: [] }, { id: 'rejected', condition: known('Rejected'), steps: [] }]
		};
		const emptyFrame = apply(original, frameEdit);
		assert.ok(describeModelInteraction(emptyFrame, 'scenario').some(row => row.id === frameEdit.id));
		const model = apply(emptyFrame,
			{ kind: 'scenarioOccurrence', viewId: 'sequence', id: 'authorize', from: 'server', to: 'server', name: 'Authorize', operandId: 'approved' },
			{ kind: 'scenarioOccurrence', viewId: 'activity', id: 'notify', from: 'server', to: 'client', name: 'Notify', operandId: 'approved' },
			{ kind: 'scenarioOccurrence', viewId: 'activity', id: 'retry', from: 'client', to: 'server', name: 'Retry', operandId: 'rejected' },
			{ kind: 'sequenceOrder', viewId: 'activity', id: 'notify', target: 'message', direction: -1 });
		assert.deepStrictEqual(getScenarioStepSiblings(model, model.views[0], 'authorize'), ['notify', 'authorize']);
		assert.throws(() => apply(model, { kind: 'scenarioOrderEdge', viewId: 'sequence', before: 'notify', after: 'retry' }), InvalidSemanticModelError);
		const edited = apply(model, { kind: 'scenarioFrame', viewId: 'sequence', id: frameEdit.id, operator: 'alt',
			operands: [{ id: 'approved', condition: known('Allowed'), steps: ['notify', 'authorize'] }, { id: 'rejected', condition: known('Rejected'), steps: ['retry'] }] });
		const frame = edited.foundation.frames.find(frame => frame.id === frameEdit.id);
		assert.deepStrictEqual(frame?.kind === 'unspecified' && frame.description?.operands.map(operand => [operand.id, operand.condition]), [['approved', known('Allowed')], ['rejected', known('Rejected')]]);
		assert.deepStrictEqual(edited.foundation.interactions[0].frameIds, [frameEdit.id]);
		assert.deepStrictEqual(validateSemanticModel(edited), []);
		const withoutFrame = apply(edited, { kind: 'scenarioRemoveFrame', viewId: 'sequence', id: frameEdit.id });
		assert.deepStrictEqual(withoutFrame.foundation.interactions[0].occurrenceIds, edited.foundation.interactions[0].occurrenceIds);
		assert.deepStrictEqual(validateSemanticModel(withoutFrame), []);
	});

	test('moving a step into a branch preserves order between the remaining root steps', () => {
		const model = apply(fixture(),
			{ kind: 'scenarioFrame', id: 'choices', viewId: 'sequence', operator: 'opt', operands: [{ id: 'choice', condition: known('Store present'), steps: [] }] },
			{ kind: 'scenarioOccurrence', id: 'store-call', viewId: 'activity', from: 'server', to: 'store', name: 'Store call', operandId: 'choice' });
		assert.deepStrictEqual(model.foundation.interactions[0].description?.order, [{ before: 'request', after: 'response', basis: 'authored', evidenceIds: [] }]);
		assert.deepStrictEqual(model.foundation.frames[0].occurrenceIds, ['store-call']);
		assert.deepStrictEqual(validateSemanticModel(model), []);
	});

	test('removing a participant prunes connected steps and retains remaining order and shared identities', () => {
		const original = fixture();
		for (const command of [
			{ kind: 'exclude', viewId: 'activity', id: 'store', target: 'element' },
			{ kind: 'deleteElement', id: 'store' }
		] satisfies VisualEdit[]) {
			const model = apply(original, command);
			assert.deepStrictEqual(model.foundation.occurrences.map(call => call.id), ['request', 'response', 'unrelated']);
			assert.deepStrictEqual(model.foundation.interactions[0].description?.order, [{ before: 'request', after: 'response', basis: 'authored', evidenceIds: [] }]);
			assert.deepStrictEqual(model.views.slice(0, 2).map(view => view.nodes.map(node => node.elementId)), [['client', 'server'], ['client', 'server']]);
			assert.strictEqual(model.semantics.elements.some(node => node.id === 'store'), command.kind === 'exclude');
			assert.deepStrictEqual(model.foundation.interactions[1], original.foundation.interactions[1]);
			assert.deepStrictEqual(validateSemanticModel(model), []);
		}
	});
});
