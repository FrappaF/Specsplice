import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IOrditoAiService } from '../../browser/orditoAiService.js';
import { IOrditoCodeService } from '../../browser/orditoCodeService.js';
import { OrditoEditor } from '../../browser/orditoEditor.js';
import { IOrditoProjectService, type OrditoProjectService } from '../../browser/orditoProjectService.js';
import { type ModelCodeUpdateState } from '../../common/modelCodeUpdate.js';
import { type SemanticModel } from '../../common/modelTypes.js';
import { type IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';

suite('Specsplice. codebase update from saved diagrams', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	setup(() => { root = dom.append(document.body, dom.$('div')); });
	teardown(() => root.remove());

	test('opens an inline checklist from Code, supports stopping and reviews the result', () => {
		const model: SemanticModel = {
			version: 3, id: 'store', name: 'Store',
			semantics: { elements: [{ id: 'checkout', kind: 'feature', name: 'Checkout' }, { id: 'order', kind: 'entity', name: 'Order' }], relations: [] },
			views: [], codeMappings: [], verifications: []
		};
		const project = Object.assign(new (mock<OrditoProjectService>())(), { model, modelUri: URI.file('/store/.ordito/model.json'), projectRoot: URI.file('/store'), editable: true, section: 'home', selectedId: '', onDidChange: Event.None, restore: async () => {} });
		const events = store.add(new Emitter<void>());
		const ready: ModelCodeUpdateState = {
			id: 'update', phase: 'ready', changes: [{
				id: 'order', collection: 'elements', label: 'Order', kind: 'modified', fields: ['details.members', 'description'],
				preview: [{ field: 'description', before: 'The saved order.', after: '<strong>Order amounts use EUR.</strong>' }]
			}]
		};
		let state: ModelCodeUpdateState | undefined;
		let started = 0;
		const set = (next?: ModelCodeUpdateState) => { state = next; events.fire(); };
		const ai = Object.assign(new (mock<IOrditoAiService>())(), {
			available: true, onDidChange: events.event, refreshConnection: async () => {}, inspectCodeGeneration: async () => undefined,
			updateCodebase: async () => set(ready), startCodeUpdate: async () => { started++; set({ ...ready, phase: 'running', status: 'Reading checkout.mjs' }); },
			stopCodeUpdate: () => set({ ...ready, phase: 'cancelled' }), closeCodeUpdate: () => set()
		});
		Object.defineProperty(ai, 'codeUpdateState', { get: () => state });
		const code = Object.assign(new (mock<IOrditoCodeService>())(), { available: true, context: { sourceRoot: '/store', diagramState: 'diagrams' }, onDidChange: Event.None });
		const instantiation = workbenchInstantiationService(undefined, store);
		instantiation.stub(IOrditoProjectService, project);
		instantiation.stub(IOrditoAiService, ai);
		instantiation.stub(IOrditoCodeService, code);
		const editor = store.add(instantiation.createInstance(OrditoEditor, Object.assign(new (mock<IEditorGroup>())(), { id: 1, windowId: 1 })));
		editor.create(root);
		const button = (label: string) => {
			const found = [...root.querySelectorAll('button')].find(button => button.textContent === label);
			assert.ok(found, `Missing ${label}`);
			return found;
		};
		const step = () => root.querySelector('.ordito-code-update [aria-current="step"]')?.textContent;
		button('Code').click();
		assert.ok(button('Prepare Code from Diagrams'));
		button('Update Codebase from Diagrams').click();
		assert.deepStrictEqual([step(), started, root.querySelector('dialog')], ['Changes', 0, null]);
		assert.match(editor.describeCurrentContext(), /Order/);
		assert.match(editor.describeCurrentContext(), /details\.members/);
		root.querySelector<HTMLElement>('.ordito-code-update li summary')!.click();
		assert.deepStrictEqual([...root.querySelectorAll('.ordito-code-update dd')].map(element => element.textContent), ['The saved order.', '<strong>Order amounts use EUR.</strong>']);
		set({ ...ready, phase: 'unavailable', changes: [], canRefresh: true, status: 'The saved diagrams changed.' });
		assert.match(editor.describeCurrentContext(), /The saved diagrams changed/);
		button('Refresh Changes').click();
		assert.equal(started, 0);
		button('Start Update').click();
		assert.deepStrictEqual([step(), started, root.querySelector('.ordito-code-update progress')?.hasAttribute('value')], ['Update', 1, false]);
		button('Stop Update').click();
		button('Retry Update').click();
		editor.showWorkspace();
		set({ ...ready, phase: 'completed', summary: 'Updated orders.mjs. 8 tests passed.', durationMs: 3000 });
		assert.equal(root.querySelector('.ordito-code-update'), null, 'progress should not switch back to the Code tab');
		button('Code').click();
		assert.deepStrictEqual([step(), started, button('Open Project Files').disabled], ['Review', 2, false]);
		assert.match(editor.describeCurrentContext(), /Updated orders\.mjs/);
		button('Back to Code').click();
		assert.equal(root.querySelector('.ordito-code-update'), null);
		assert.equal(document.activeElement, button('Update Codebase from Diagrams'));
	});
});
