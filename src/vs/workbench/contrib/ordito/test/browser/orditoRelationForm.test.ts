import assert from 'assert';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { type OrditoEditingContext } from '../../browser/orditoEditingContext.js';
import { runOrditoDiagramCommand } from '../../browser/orditoEditingDiagram.js';
import { OrditoProjectService } from '../../browser/orditoProjectService.js';
import { editOrditoConnectionDetails, editOrditoRelationForm } from '../../browser/orditoRelationForm.js';
import { type SemanticModel } from '../../common/modelTypes.js';
import { applyVisualEdit, type VisualEdit } from '../../common/visualEditing.js';

suite('Specsplice grouped relationship forms', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	let parent: HTMLElement;
	let model: SemanticModel;
	setup(() => {
		parent = document.body.appendChild(document.createElement('div'));
		model = {
			version: 3, id: 'project', name: 'Project', codeMappings: [], verifications: [],
			semantics: {
				elements: [
					{ id: 'source', name: 'Service', kind: 'component', behavior: { inputs: [], outputs: [], preconditions: [], postconditions: [], errors: [{ code: 'UNAVAILABLE', description: 'Unavailable' }], permissions: [], acceptanceCriteria: [] } },
					{ id: 'target', name: 'Store', kind: 'resource' },
					{ id: 'actor', name: 'Buyer', kind: 'actor' }
				],
				relations: [{ id: 'read', kind: 'read', from: 'source', to: 'target', name: 'Load', condition: 'ready', errorCode: 'UNAVAILABLE' }]
			},
			views: [{ id: 'diagram', name: 'Diagram', kind: 'structure', nodes: ['source', 'target', 'actor'].map((elementId, index) => ({ elementId, x: index * 200, y: 0 })), relationIds: ['read'] }]
		};
	});
	teardown(() => { parent.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true })); parent.remove(); });
	const field = (label: string) => {
		const row = [...parent.querySelectorAll('label')].find(row => row.querySelector('span')?.textContent === label);
		const control = row?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea');
		assert.ok(control, `Missing field ${label}`); return control;
	};
	const change = (label: string, value: string) => { const control = field(label); control.value = value; control.dispatchEvent(new Event('change', { bubbles: true })); };
	const save = () => { const button = parent.querySelector<HTMLButtonElement>('button[type="submit"]'); assert.ok(button); button.click(); };

	test('editing retains current kind, endpoints and declared error until explicit save', async () => {
		const before = structuredClone(model);
		const pending = editOrditoRelationForm(parent, model, { relation: model.semantics.relations[0] });
		assert.deepStrictEqual(['Relationship Source', 'Relationship Type', 'Target Element', 'Relationship Error'].map(label => field(label).value), ['source', 'read', 'target', 'UNAVAILABLE']);
		change('Relationship Name', 'Reload'); change('Condition (Optional)', 'ready\nand authorized');
		assert.deepStrictEqual(model, before);
		save();
		assert.deepStrictEqual(await pending, { from: 'source', to: 'target', relationKind: 'read', name: 'Reload', condition: 'ready\nand authorized', errorCode: 'UNAVAILABLE' });
		assert.deepStrictEqual(model, before);
	});

	test('changing source removes unsupported kinds, targets and error codes', async () => {
		const pending = editOrditoRelationForm(parent, model, { relation: model.semantics.relations[0] });
		change('Relationship Source', 'actor');
		const kind = field('Relationship Type') as HTMLSelectElement;
		assert.ok(![...kind.options].some(option => option.value === 'read'));
		assert.strictEqual(field('Relationship Error').value, '');
		change('Relationship Type', 'invocation');
		assert.deepStrictEqual([...(field('Target Element') as HTMLSelectElement).options].map(option => option.value), ['source']);
		save();
		assert.deepStrictEqual(await pending, { from: 'actor', to: 'source', relationKind: 'invocation', name: 'Load', condition: 'ready', errorCode: undefined });
	});

	test('canceling a connection discards all entered values', async () => {
		const before = structuredClone(model);
		const pending = editOrditoRelationForm(parent, model, { sourceId: 'source', view: model.views[0] });
		change('Relationship Name', 'Draft');
		parent.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
		assert.deepStrictEqual([await pending, model, parent.querySelector('dialog')], [undefined, before, null]);
	});

	test('canvas connection details accept an empty label and a multiline condition together', async () => {
		const pending = editOrditoConnectionDetails(parent, 'Service → Store');
		change('Condition (Optional)', 'ready\nand permitted'); save();
		assert.deepStrictEqual(await pending, { name: '', condition: 'ready\nand permitted' });
	});

	test('creating a relationship applies its selected declared error in the same batch', async () => {
		const project = Object.assign(new (mock<OrditoProjectService>())(), { model, activeView: model.views[0], selectedId: 'source' });
		const batches: VisualEdit[][] = [];
		const ui = Object.assign(new (mock<OrditoEditingContext>())(), {
			container: parent, project,
			edit: (value: VisualEdit | VisualEdit[]) => {
				const edits = Array.isArray(value) ? value : [value]; batches.push(edits);
				for (const edit of edits) { project.model = applyVisualEdit(project.model, edit); }
			}
		});
		const pending = runOrditoDiagramCommand(ui, 'connect');
		change('Relationship Type', 'read'); change('Relationship Error', 'UNAVAILABLE'); change('Relationship Name', 'Load Again');
		assert.strictEqual(project.model.semantics.relations.length, 1);
		save(); await pending;
		assert.deepStrictEqual({ name: project.model.semantics.relations.at(-1)?.name, errorCode: project.model.semantics.relations.at(-1)?.errorCode, batches: batches.map(edits => edits.map(edit => edit.kind)) }, { name: 'Load Again', errorCode: 'UNAVAILABLE', batches: [['relation', 'relationError']] });
	});
});
