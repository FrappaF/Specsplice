import assert from 'assert';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { editOrditoDescriptiveInteraction, editOrditoDescriptiveMessage } from '../../browser/orditoDescriptiveInteractionEditing.js';
import { type OrditoEditingContext } from '../../browser/orditoEditingContext.js';
import { type OrditoProjectService } from '../../browser/orditoProjectService.js';
import { orditoInteractionRows } from '../../browser/orditoInteractionContent.js';
import { projectDescriptiveActivity } from '../../common/descriptiveActivity.js';
import { emptyFoundation } from '../../common/semanticModel.js';
import { type ModelView, type SemanticModelV5 } from '../../common/modelTypes.js';
import { applyVisualEdit, type VisualEdit } from '../../common/visualEditing.js';
import { ScriptedDialogs } from './orditoBlueprintEditing.test.js';

suite('Specsplice descriptive scenario editing', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	setup(() => { root = document.body.appendChild(document.createElement('div')); });
	teardown(() => root.remove());

	function fixture(dialogs = new ScriptedDialogs([])) {
		const view: ModelView = {
			id: 'sequence', name: 'Refund Requests', kind: 'sequence', interactionId: 'refund', relationIds: [],
			nodes: [{ elementId: 'client', x: 0, y: 0 }, { elementId: 'server', x: 320, y: 0 }]
		};
		let model: SemanticModelV5 = {
			version: 5, id: 'store', name: 'Store', codeMappings: [], verifications: [],
			semantics: { elements: [{ id: 'client', name: 'Client', kind: 'actor' }, { id: 'server', name: 'Server', kind: 'component' }], relations: [] },
			views: [view, { ...view, id: 'activity', name: 'Refund Outcomes', kind: 'activity' }],
			foundation: {
				...emptyFoundation(),
				occurrences: [{ id: 'requested', profile: 'descriptive', name: 'Request refund', from: 'client', to: 'server', evidenceIds: [] }],
				frames: [{ id: 'result', kind: 'unspecified', occurrenceIds: [], description: { operator: 'opt', operands: [{ id: 'approved', condition: { state: 'known', value: 'Refund accepted' }, evidenceIds: [], steps: [] }] } }],
				interactions: [{ id: 'refund', profile: 'descriptive', occurrenceIds: ['requested'], frameIds: ['result'], description: { trigger: 'An HTTP request', scope: 'One refund', participantIds: ['client', 'server'], evidenceIds: [], order: [] } }]
			}
		};
		const edits: VisualEdit[] = [];
		const project = Object.assign(new (mock<OrditoProjectService>())(), { selectElement: () => {} });
		Object.defineProperty(project, 'model', { get: () => model });
		const ui = Object.assign(new (mock<OrditoEditingContext>())(), {
			container: root, project, quickInput: dialogs,
			edit: (edit: VisualEdit) => { edits.push(edit); model = applyVisualEdit(model, edit) as SemanticModelV5; }
		});
		return { ui, view, edits, model: () => model };
	}

	test('adding a message to an imported branch updates both published views', async () => {
		const f = fixture();
		const pending = editOrditoDescriptiveMessage(f.ui, f.view, { from: 'server', operandId: 'approved' });
		root.querySelector<HTMLInputElement>('dialog input[required]')!.value = 'Send refund receipt';
		root.querySelector<HTMLFormElement>('dialog form')!.requestSubmit();
		await pending;
		const model = f.model(), step = model.foundation.occurrences.find(entry => entry.name === 'Send refund receipt')!;
		assert.deepStrictEqual(f.edits.map(edit => edit.kind), ['scenarioOccurrence']);
		assert.deepStrictEqual([step.from, step.to], ['server', 'client']);
		assert.equal(model.foundation.occurrences[0].id, 'requested');
		assert.equal(orditoInteractionRows(model, 'refund').find(row => row.id === step.id)?.depth, 2);
		assert.ok(projectDescriptiveActivity(model, 'refund').nodes.some(node => node.occurrenceId === step.id));
	});

	test('editing a branch condition keeps the frame and branch identity', async () => {
		const dialogs = new ScriptedDialogs(['Edit Branch Condition']);
		const f = fixture(dialogs);
		const pending = editOrditoDescriptiveInteraction(f.ui, f.view, 'approved');
		await Promise.resolve();
		await Promise.resolve(); // The picker resolves its items before returning the selected action.
		root.querySelector<HTMLTextAreaElement>('dialog textarea')!.value = 'Refund accepted within 30 days';
		root.querySelector<HTMLFormElement>('dialog form')!.requestSubmit();
		await pending;
		dialogs.assertComplete();
		assert.deepStrictEqual(orditoInteractionRows(f.model(), 'refund').filter(row => row.id === 'result' || row.id === 'approved').map(row => [row.id, row.label]), [
			['result', 'Optional Branch'], ['approved', 'Condition: Refund accepted within 30 days']
		]);
	});
});
