import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OrditoControls } from '../../browser/orditoControls.js';
import { renderOrditoWelcome, renderOrditoProjectHome } from '../../browser/orditoWelcome.js';
import { orditoDocumentStatus } from '../../browser/orditoDocumentStatus.js';
import { type SemanticModel } from '../../common/modelTypes.js';

suite('Specsplice project entrances and truthful status', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	setup(() => { root = dom.append(document.body, dom.$('section.ordito-shell')); });
	teardown(() => root.remove());

	function home(model: SemanticModel, overrides: Partial<Parameters<typeof renderOrditoProjectHome>[2]> = {}) {
		const called: string[] = [];
		const controls = store.add(new OrditoControls());
		const actions: Parameters<typeof renderOrditoProjectHome>[2] = {
			model, editable: true, busy: false,
			addFeature: () => called.push('feature'), addDiagram: id => called.push(id ? `diagram:${id}` : 'diagram'),
			openDiagram: id => called.push(`open:${id}`), inspectFeature: id => called.push(`inspect:${id}`),
			systemMap: () => called.push('map'), navigation: () => called.push('navigation'),
			purchaseExample: () => called.push('purchase'), quantityTemplate: () => called.push('quantity'),
			...overrides
		};
		renderOrditoProjectHome(root, controls, actions);
		return { controls, called, actions };
	}

	function model(populated = false): SemanticModel {
		return {
			version: 2, id: 'mercato', name: '<img src=x>',
			semantics: { elements: populated ? [
				{ id: 'purchase', kind: 'feature', name: 'Checkout', description: '<script>unsafe</script>' },
				{ id: 'returns', kind: 'feature', name: 'Resi' }
			] : [], relations: [] },
			views: populated ? [
				{ id: 'structure', name: 'Checkout Structure', kind: 'structure', featureId: 'purchase', nodes: [], relationIds: [] },
				{ id: 'flow', name: 'Checkout Flow', kind: 'activity', featureId: 'purchase', nodes: [], relationIds: [] },
				{ id: 'shared', name: 'Vista condivisa', kind: 'structure', nodes: [], relationIds: [] }
			] : [], codeMappings: [], verifications: []
		};
	}

	function activate(controls: OrditoControls, id: string): void {
		assert.strictEqual(controls.focusTarget(id), true, `Missing action: ${id}`);
		const active = dom.getActiveElement();
		assert.ok(dom.isHTMLButtonElement(active), `Action is not an enabled, visible button: ${id}`);
		active.click();
	}

	test('three entrances dispatch distinct tasks; model files and examples stay in secondary help', () => {
		const called: string[] = [];
		const controls = store.add(new OrditoControls());
		renderOrditoWelcome(root, controls, { open: () => called.push('open'), create: () => called.push('create'), importCode: () => called.push('import'), openModel: () => called.push('model'), example: () => called.push('example'), canImport: true });
		const entrances = [...root.querySelectorAll<HTMLButtonElement>('.ordito-welcome-tasks button')];
		for (const button of entrances) { button.click(); }
		assert.deepStrictEqual({ names: entrances.map(button => button.textContent), called, primary: root.querySelectorAll('.ordito-primary-action').length, helpOpen: root.querySelector('details')?.open }, { names: ['Open Project', 'Create Project', 'Import Codebase'], called: ['open', 'create', 'import'], primary: 1, helpOpen: false });
	});

	test('the unsupported import remains explained and cannot dispatch', () => {
		let calls = 0;
		renderOrditoWelcome(root, store.add(new OrditoControls()), { open() { }, create() { }, importCode: () => calls++, openModel() { }, example() { }, canImport: false });
		const button = root.querySelector<HTMLButtonElement>('.ordito-welcome-tasks section:last-child button')!;
		button.click();
		assert.deepStrictEqual([button.disabled, calls, !!root.querySelector(`#${button.getAttribute('aria-describedby')}`)?.textContent?.includes('unavailable')], [true, 0, true]);
	});

	test('empty project Home explains the first feature and keeps navigation and examples discoverable', () => {
		const f = home(model());
		activate(f.controls, 'start:manual');
		activate(f.controls, 'home:map');
		activate(f.controls, 'home:navigation');
		assert.deepStrictEqual({
			called: f.called, title: root.querySelector('h1')?.textContent,
			unsafe: root.querySelector('img, script'), primary: root.querySelectorAll('.ordito-primary-action').length,
			start: !!root.querySelector('.ordito-home-start'), examples: root.querySelectorAll('.ordito-home-example').length
		}, { called: ['feature', 'map', 'navigation'], title: '<img src=x>', unsafe: null, primary: 1, start: true, examples: 2 });
	});

	test('exploring examples does not mutate the project; adding a supported template is explicit', () => {
		const source = model();
		const before = JSON.stringify(source);
		const f = home(source);
		f.controls.setExpanded('home:example:purchase', true);
		f.controls.setExpanded('home:example:quantity', true);
		assert.deepStrictEqual([f.called, JSON.stringify(source)], [[], before]);
		activate(f.controls, 'home:purchase-example');
		activate(f.controls, 'home:quantity-template');
		assert.deepStrictEqual([f.called, JSON.stringify(source)], [['purchase', 'quantity'], before]);
		root.textContent = '';
		const unsupported = home(source, { quantityTemplate: undefined });
		assert.deepStrictEqual([unsupported.controls.focusTarget('home:quantity-template'), root.querySelectorAll('.ordito-home-example').length], [false, 2]);
	});

	test('populated Home reaches actual feature diagrams and unowned views without changing the model', () => {
		const source = model(true);
		const before = JSON.stringify(source);
		const f = home(source, { resumeViewId: 'flow' });
		for (const id of ['home:resume', 'home:feature:returns', 'home:view:purchase:structure', 'home:view:purchase:flow', 'home:view:system:shared']) { activate(f.controls, id); }
		assert.deepStrictEqual({
			called: f.called, features: root.querySelectorAll('.ordito-home-feature').length,
			start: root.querySelector('.ordito-home-start'), system: !!root.querySelector('.ordito-home-system-diagrams'),
			unsafe: root.querySelector('img, script'), model: JSON.stringify(source)
		}, { called: ['open:flow', 'inspect:returns', 'open:structure', 'open:flow', 'open:shared'], features: 2, start: null, system: true, unsafe: null, model: before });
		root.textContent = '';
		const stale = home(source, { resumeViewId: 'deleted-view' });
		assert.strictEqual(stale.controls.focusTarget('home:resume'), false);
		root.textContent = '';
		source.views = [];
		const withoutDiagrams = home(source);
		activate(withoutDiagrams.controls, 'home:feature:returns');
		activate(withoutDiagrams.controls, 'home:add-diagram:returns');
		assert.deepStrictEqual([root.querySelector('.ordito-home-start'), root.querySelectorAll('.ordito-home-feature').length, withoutDiagrams.called], [null, 2, ['inspect:returns', 'diagram:returns']]);
	});

	test('read-only and busy projects prevent model mutations while retaining navigation', () => {
		for (const overrides of [{ editable: false }, { busy: true }]) {
			root.textContent = '';
			const f = home(model(true), overrides);
			f.controls.setExpanded('home:example:quantity', true);
			for (const button of root.querySelectorAll('button')) { button.click(); }
			assert.deepStrictEqual(f.called.filter(action => ['feature', 'diagram', 'quantity'].includes(action) || action.startsWith('diagram:')), []);
			f.called.length = 0;
			activate(f.controls, 'home:map');
			activate(f.controls, 'home:navigation');
			activate(f.controls, 'home:feature:purchase');
			assert.deepStrictEqual(f.called, ['map', 'navigation', 'inspect:purchase']);
		}
	});

	test('the initial guide can be collapsed and stays collapsed after presentation updates', () => {
		const f = home(model());
		assert.strictEqual(f.controls.focusTarget('home:guide'), true);
		const summary = dom.getActiveElement() as HTMLElement;
		assert.strictEqual(summary.closest('details')?.open, true);
		summary.click();
		f.controls.render(root, () => { root.textContent = ''; renderOrditoProjectHome(root, f.controls, f.actions); });
		assert.strictEqual(f.controls.focusTarget('home:guide'), true);
		assert.strictEqual(dom.getActiveElement()?.closest('details')?.open, false);
	});

	test('blocking errors dominate success and file persistence stays distinct from verification', () => {
		const base = { loading: false, dirty: false, hasDocument: true, draft: false, codeChanged: false };
		assert.deepStrictEqual([
			orditoDocumentStatus({ ...base, error: 'broken', operation: 'Verification passed' }),
			orditoDocumentStatus({ ...base, saveError: 'disk full', dirty: true }),
			orditoDocumentStatus({ ...base, draft: true }),
			orditoDocumentStatus(base),
			orditoDocumentStatus({ ...base, hasDocument: false, readOnly: true }),
			orditoDocumentStatus({ ...base, readOnly: true, error: 'broken' }),
			orditoDocumentStatus({ ...base, hasDocument: false })
		], ['Project Could Not Be Opened', 'Changes Could Not Be Saved', 'Draft Saved · Corrections Required', 'Model Saved Locally', 'Read-Only Model', 'Project Could Not Be Opened', 'Choose a Project to Begin']);
	});
});
