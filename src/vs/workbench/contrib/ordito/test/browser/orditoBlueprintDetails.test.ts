import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OrditoControls } from '../../browser/orditoControls.js';
import { renderBlueprintDetails } from '../../browser/orditoBlueprintDetails.js';
import { emptyBlueprint, emptyFoundation } from '../../common/modelFoundation.js';
import { type SemanticModelV4 } from '../../common/modelTypes.js';

suite('Specsplice blueprint details renderer', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	let controls: OrditoControls;
	let model: SemanticModelV4;
	setup(() => {
		controls = disposables.add(new OrditoControls()); root = dom.append(document.body, dom.$('section'));
		model = { version: 4, id: 'renderer', name: 'Renderer', semantics: { elements: [{ id: 'shop', kind: 'system', name: 'Shop', scope: 'governed' }, { id: 'api', kind: 'container', name: 'API' }, { id: 'component', kind: 'component', name: 'Checkout' }, { id: 'contract', kind: 'contract', name: 'Checkout API' }, { id: 'external', kind: 'system', name: 'Payments', scope: 'external' }], relations: [] }, views: [{ id: 'l2', kind: 'c4Container', name: 'Containers', subjectId: 'shop', contextIds: [], nodes: [], relationIds: [] }], foundation: { ...emptyFoundation(), blueprint: emptyBlueprint() }, codeMappings: [], verifications: [] };
		model.foundation.blueprint!.operations.push({ id: 'confirm', ownerId: 'contract', name: 'confirmOrder', inputs: [{ id: 'order', name: 'order', type: 'string', required: false, nullable: { state: 'known', value: false } }], outputs: [], errors: [], permissions: [], effects: ['reserve'], preconditions: [], postconditions: [], acceptanceCriteria: [] });
		model.foundation.blueprint!.interfaces.push({ id: 'interface', elementId: 'contract', version: '1', operationIds: ['confirm'], invariants: [] });
		model.foundation.blueprint!.ports.push({ id: 'port', elementId: 'component', direction: 'provided', interfaceId: 'interface' });
	});
	teardown(() => { root.remove(); });

	test('semantic drill-down is an explicit keyboard-focusable button and leaves geometry untouched', () => {
		let destination: string[] = []; const before = structuredClone(model.views);
		renderBlueprintDetails(root, model, 'shop', controls, (viewId, elementId) => { destination = [viewId, elementId]; }, () => { });
		const button = root.querySelector('button')!; button.focus(); button.click();
		assert.deepStrictEqual([button.textContent, document.activeElement === button, destination, model.views], ['Open Containers', true, ['l2', 'shop'], before]);
	});
	test('shared signatures retain optional versus nullable text and actionable contract references', () => {
		let selected = '';
		renderBlueprintDetails(root, model, 'component', controls, () => { }, id => { selected = id; });
		const button = [...root.querySelectorAll('button')].find(button => button.textContent === 'Provides: Checkout API')!; button.click();
		assert.deepStrictEqual([selected, root.textContent?.includes('order: string · Optional · Non-null'), root.textContent?.includes('Declared Effect: reserve')], ['contract', true, true]);
	});
	test('external dependencies expose their context boundary without an internal drill-down', () => {
		renderBlueprintDetails(root, model, 'external', controls, () => { throw new Error('Unexpected drill-down'); }, () => { });
		assert.deepStrictEqual([root.querySelectorAll('button').length, root.textContent?.includes('Context only')], [0, true]);
	});
	test('ADR reasons, structured constraints and historical reasons are inspectable', () => {
		model.foundation.decisions.push({ id: 'adr', revision: '2', status: 'accepted', scopeIds: ['component'], constraints: [], record: { number: '1', title: 'Transport', context: 'Provider requirements', decision: 'Use declared protocol', consequences: ['Versioned payload'], history: [{ revision: '1', status: 'proposed', scopeIds: ['component'], constraints: [], title: 'Earlier rationale', decision: 'Earlier decision' }] } });
		renderBlueprintDetails(root, model, 'component', controls, () => { }, () => { });
		assert.deepStrictEqual(['Provider requirements', 'Use declared protocol', 'Earlier rationale', 'Earlier decision', 'Prose requires review'].map(value => root.textContent?.includes(value)), [true, true, true, true, true]);
	});
});
