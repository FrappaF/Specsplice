import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OrditoControls } from '../../browser/orditoControls.js';
import { renderOrditoSystemMap } from '../../browser/orditoSystemMap.js';
import { atlasTargetKey, createSystemAtlasState, SystemAtlas, type AtlasTarget } from '../../common/systemAtlas.js';
import { createAtlasFixture } from '../common/systemAtlasFixture.js';

suite('Specsplice layered system atlas', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	setup(() => { root = dom.append(document.body, dom.$('section.ordito-shell')); root.style.width = '1024px'; });
	teardown(() => root.remove());
	const element = (id: string): AtlasTarget => ({ type: 'element', id });
	const area = (id: string): AtlasTarget => ({ type: 'area', id: JSON.stringify([id]) });

	function setupAtlas(options: Parameters<typeof createAtlasFixture>[0] = {}) {
		const atlas = new SystemAtlas(createAtlasFixture(options));
		const controls = store.add(new OrditoControls()), interactions = store.add(new DisposableStore());
		const calls: string[] = [];
		let state = createSystemAtlasState();
		const render = () => {
			interactions.clear();
			controls.render(root, () => {
				dom.clearNode(root);
				renderOrditoSystemMap(root, atlas, controls, interactions, { state, change: next => { state = next; render(); }, element: id => calls.push(id), diagram: id => calls.push(id) });
			});
		};
		render();
		const row = (target: AtlasTarget) => [...root.querySelectorAll<HTMLElement>('.ordito-atlas-node')].find(row => row.dataset.targetType === target.type && row.dataset.targetId === target.id)!;
		const click = (target: AtlasTarget, action: 'filter' | 'open' = 'filter') => row(target).querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
		const remove = (target: AtlasTarget) => [...root.querySelectorAll<HTMLButtonElement>('[data-filter-key]')].find(button => button.dataset.filterKey === atlasTargetKey(target))!.click();
		const search = (query: string) => { const input = root.querySelector('input')!; input.focus(); input.value = query; input.dispatchEvent(new Event('input')); };
		return { atlas, controls, calls, render, row, click, remove, search, getState: () => state };
	}

	test('actor and area clicks accumulate in place; arrows alone change levels', () => {
		const app = setupAtlas();
		assert.ok(app.row(element('actor-0')).querySelector('small')!.textContent!.includes(`${app.atlas.adjacency.get('actor-0')!.length} relationships`));
		app.click(element('actor-0')); app.click(area('area-0'));
		assert.deepStrictEqual({ level: app.getState().level, filters: app.getState().filters, chips: root.querySelectorAll('[data-filter-key]').length, inspected: app.calls }, { level: 'system', filters: [element('actor-0'), area('area-0')], chips: 2, inspected: [] });
		app.click(area('area-0'), 'open'); app.click(element('feature-0'));
		assert.deepStrictEqual({ level: app.getState().level, filters: app.getState().filters, featureRows: root.querySelectorAll('.ordito-atlas-center .ordito-atlas-node').length }, { level: 'area', filters: [element('actor-0'), area('area-0'), element('feature-0')], featureRows: 1 });
		app.click(element('feature-0'), 'open');
		assert.deepStrictEqual({ level: app.getState().level, filters: app.getState().filters, internals: root.querySelector('.ordito-atlas-center header span')?.textContent, actors: root.querySelectorAll('.ordito-atlas-actors .ordito-atlas-node').length, shared: root.querySelectorAll('.ordito-atlas-shared .ordito-atlas-node').length, selected: app.row(element('actor-0')).querySelector('button')!.getAttribute('aria-pressed') }, { level: 'feature', filters: [element('actor-0'), area('area-0'), element('feature-0')], internals: '20', actors: 1, shared: 6, selected: 'true' });
	});

	test('internal filter and each independent chip removal retain the remaining criteria', () => {
		const app = setupAtlas();
		app.click(element('actor-0')); app.click(area('area-0')); app.click(area('area-0'), 'open'); app.click(element('feature-0')); app.click(element('feature-0'), 'open');
		app.click(element('element-0-0')); app.click(element('element-0-0'));
		assert.deepStrictEqual({ filters: app.getState().filters, rows: root.querySelectorAll('.ordito-atlas-center .ordito-atlas-node').length, arrows: root.querySelectorAll('.ordito-atlas-center .ordito-atlas-open').length }, { filters: [element('actor-0'), area('area-0'), element('feature-0'), element('element-0-0')], rows: 2, arrows: 0 });
		app.remove(element('element-0-0')); app.remove(area('area-0'));
		assert.deepStrictEqual({ filters: app.getState().filters, internals: root.querySelector('.ordito-atlas-center header span')?.textContent }, { filters: [element('actor-0'), element('feature-0')], internals: '20' });
		app.remove(element('actor-0'));
		assert.deepStrictEqual({ filters: app.getState().filters, actors: root.querySelectorAll('.ordito-atlas-actors .ordito-atlas-node').length, level: app.getState().level }, { filters: [element('feature-0')], actors: 4, level: 'feature' });
	});

	test('global search adds incompatible criteria, announces empty results and leaves every chip removable', () => {
		const app = setupAtlas();
		app.click(element('actor-0')); app.click(area('area-0')); app.search('feature-12'); app.click(element('feature-12'));
		assert.deepStrictEqual({ filters: app.getState().filters, level: app.getState().level, rows: root.querySelectorAll('.ordito-atlas-canvas .ordito-atlas-node').length, chips: root.querySelectorAll('[data-filter-key]').length, empty: root.querySelector('.ordito-atlas-center')?.textContent?.includes('No objects satisfy all filters'), status: root.querySelector('[role="status"]')?.textContent?.includes('3 active filters'), focused: (document.activeElement as HTMLElement).dataset.filterKey }, { filters: [element('actor-0'), area('area-0'), element('feature-12')], level: 'system', rows: 0, chips: 3, empty: true, status: true, focused: atlasTargetKey(element('feature-12')) });
		app.remove(element('feature-12'));
		assert.deepStrictEqual({ filters: app.getState().filters, areas: root.querySelectorAll('.ordito-atlas-center .ordito-atlas-node').length }, { filters: [element('actor-0'), area('area-0')], areas: 1 });
	});

	test('search arrow reaches an off-page internal element, preserving filters through paging and breadcrumbs', () => {
		const app = setupAtlas();
		app.click(element('actor-0')); app.click(area('area-0')); app.search('element-0-19'); app.click(element('element-0-19'), 'open');
		assert.deepStrictEqual({ filters: app.getState().filters, feature: app.getState().featureId, page: app.getState().centerPage, revealed: !!app.row(element('element-0-19')) }, { filters: [element('actor-0'), area('area-0')], feature: 'feature-0', page: 3, revealed: true });
		root.querySelector<HTMLButtonElement>('[data-page="centerPage"][data-delta="-1"]')!.click();
		app.controls.focusTarget('atlas-breadcrumb:system'); (document.activeElement as HTMLButtonElement).click();
		assert.deepStrictEqual({ filters: app.getState().filters, level: app.getState().level, page: app.getState().centerPage }, { filters: [element('actor-0'), area('area-0')], level: 'system', page: 0 });
	});

	test('search input retains keyboard focus and caret across state updates; no-match results are announced', () => {
		const app = setupAtlas();
		app.search('Verifica disponibilita');
		const input = root.querySelector('input')!;
		input.setSelectionRange(4, 4); input.dispatchEvent(new Event('input'));
		assert.deepStrictEqual({ focused: document.activeElement === root.querySelector('input'), caret: root.querySelector('input')!.selectionStart, matches: root.querySelectorAll('.ordito-atlas-results .ordito-atlas-node').length }, { focused: true, caret: 4, matches: 8 });
		app.search('zz-no-match');
		assert.deepStrictEqual({ rows: root.querySelectorAll('.ordito-atlas-node').length, announcement: root.querySelector('[role="status"]')?.textContent?.startsWith('0 results') }, { rows: 0, announcement: true });
	});

	test('diagrams and inspection remain explicit actions, with exact relationship conditions accessible', () => {
		const app = setupAtlas();
		app.click(area('area-0')); app.click(area('area-0'), 'open'); app.click(element('feature-0')); app.click(element('feature-0'), 'open');
		app.controls.focusTarget('atlas-view:diagram-0'); (document.activeElement as HTMLButtonElement).click();
		app.controls.focusTarget('atlas-inspect'); (document.activeElement as HTMLButtonElement).click();
		app.controls.setExpanded('atlas-relationships', true);
		// The relation page is bounded; a direct resource filter exposes its exact relation immediately.
		app.click(element('shared-0'));
		assert.deepStrictEqual({ calls: app.calls, condition: root.querySelector('.ordito-atlas-relationships')?.textContent?.includes('Accesso autorizzato'), error: root.querySelector('.ordito-atlas-relationships')?.textContent?.includes('access-denied'), filters: app.getState().filters }, { calls: ['diagram-0', 'feature-0'], condition: true, error: true, filters: [area('area-0'), element('feature-0'), element('shared-0')] });
	});

	test('real version 4 memberships preserve internal elements and use a single unassigned area', () => {
		const app = setupAtlas({ version: 4 });
		app.click(element('actor-0')); app.click({ type: 'area', id: '[null]' }, 'open'); app.click(element('feature-0')); app.click(element('feature-0'), 'open');
		assert.deepStrictEqual({ filters: app.getState().filters, internals: root.querySelector('.ordito-atlas-center header span')?.textContent, shared: root.querySelectorAll('.ordito-atlas-shared .ordito-atlas-node').length, actors: root.querySelectorAll('.ordito-atlas-actors .ordito-atlas-node').length }, { filters: [element('actor-0'), element('feature-0')], internals: '20', shared: 6, actors: 1 });
	});

	test('hub with 60,000 objects keeps nodes, diagrams, relationship details and paths bounded', async () => {
		const app = setupAtlas({ actors: 240, features: 2400, shared: 4800, hub: true });
		app.click(element('actor-0')); app.click(area('area-0')); app.click(area('area-0'), 'open'); app.click(element('feature-0')); app.click(element('feature-0'), 'open');
		await new Promise<void>(resolve => dom.getWindow(root).requestAnimationFrame(() => resolve()));
		assert.deepStrictEqual({ filters: app.getState().filters, total: root.querySelector('.ordito-atlas-center header span')?.textContent, nodesBounded: root.querySelectorAll('.ordito-atlas-canvas .ordito-atlas-node').length <= 18, pathsBounded: root.querySelectorAll('.ordito-atlas-lines > path').length <= 24, diagramsBounded: root.querySelectorAll('.ordito-atlas-diagram').length <= 6, detailsBounded: root.querySelectorAll('.ordito-atlas-relation').length <= 6, otherActors: root.querySelectorAll('.ordito-atlas-actors .ordito-atlas-node').length }, { filters: [element('actor-0'), area('area-0'), element('feature-0')], total: '5,000', nodesBounded: true, pathsBounded: true, diagramsBounded: true, detailsBounded: true, otherActors: 1 });
	});
});
