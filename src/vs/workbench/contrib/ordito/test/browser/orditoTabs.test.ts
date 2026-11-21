import assert from 'assert';
import '../../browser/media/ordito.css';
import * as dom from '../../../../../base/browser/dom.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OrditoControls } from '../../browser/orditoControls.js';

suite('Specsplice reusable tabs', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	setup(() => { root = document.body.appendChild(document.createElement('section')); root.className = 'ordito-shell'; root.tabIndex = -1; });
	teardown(() => root.remove());
	const entries = [{ id: 'properties', label: 'Properties' }, { id: 'behavior', label: 'Behavior' }, { id: 'architecture', label: 'Architecture' }] as const;
	const tab = (label: string) => {
		const result = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === label || tab.getAttribute('aria-label') === label);
		assert.ok(result, `Missing tab ${label}`); return result;
	};
	const key = (target: HTMLElement, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

	test('tab and panel identities expose one selected panel and one native tab stop', () => {
		const controls = store.add(new OrditoControls());
		const tabs = controls.tabs(root, 'inspector', entries);
		assert.strictEqual(tabs.activeId, 'properties');
		assert.strictEqual(root.querySelectorAll('[role="tablist"]').length, 1);
		assert.deepStrictEqual(entries.map(entry => {
			const button = tab(entry.label), panel = tabs.panels.get(entry.id)!;
			return { selected: button.getAttribute('aria-selected'), tabIndex: button.tabIndex, hidden: panel.hidden, visible: dom.getWindow(panel).getComputedStyle(panel).display !== 'none', role: panel.getAttribute('role'), controls: document.getElementById(button.getAttribute('aria-controls')!) === panel, labelledBy: document.getElementById(panel.getAttribute('aria-labelledby')!) === button };
		}), [
			{ selected: 'true', tabIndex: 0, hidden: false, visible: true, role: 'tabpanel', controls: true, labelledBy: true },
			{ selected: 'false', tabIndex: -1, hidden: true, visible: false, role: 'tabpanel', controls: true, labelledBy: true },
			{ selected: 'false', tabIndex: -1, hidden: true, visible: false, role: 'tabpanel', controls: true, labelledBy: true }
		]);
		tab('Behavior').click();
		assert.deepStrictEqual([tabs.activeId, tabs.panels.get('properties')?.hidden, tabs.panels.get('behavior')?.hidden], ['behavior', true, false]);
	});

	test('keyboard navigation wraps, supports Home and End, and leaves native Tab navigation intact', () => {
		const controls = store.add(new OrditoControls()); const tabs = controls.tabs(root, 'inspector', entries);
		const states: { selected: string; focused: string | null | undefined }[] = [];
		tab('Properties').focus();
		for (const [from, pressed] of [['Properties', 'ArrowLeft'], ['Architecture', 'ArrowRight'], ['Properties', 'End'], ['Architecture', 'Home']]) {
			key(tab(from), pressed); states.push({ selected: tabs.activeId, focused: document.activeElement?.textContent });
		}
		assert.deepStrictEqual(states, [{ selected: 'architecture', focused: 'Architecture' }, { selected: 'properties', focused: 'Properties' }, { selected: 'architecture', focused: 'Architecture' }, { selected: 'properties', focused: 'Properties' }]);
		assert.strictEqual(tabs.panels.get('properties')?.tabIndex, 0);
		assert.strictEqual([...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].filter(tab => tab.tabIndex === 0).length, 1);
		assert.strictEqual(key(tab('Properties'), 'Tab'), true);
	});

	test('selection and focused actions persist through rerenders and changing the inspected object', () => {
		const controls = store.add(new OrditoControls());
		let selection = 'Customer';
		let current: ReturnType<OrditoControls['tabs']> | undefined;
		const render = () => controls.render(root, () => {
			root.replaceChildren(); current = controls.tabs(root, 'element-inspector', entries);
			for (const [id, panel] of current.panels) { controls.button(panel, `Edit ${selection} ${id}`, () => {}, `edit:${id}`); }
		});
		render(); controls.selectTab('element-inspector', 'behavior');
		assert.ok(controls.focusTarget('edit:behavior'));
		selection = 'Order'; render();
		assert.ok(current);
		assert.deepStrictEqual({ active: current.activeId, behaviorHidden: current.panels.get('behavior')?.hidden, action: document.activeElement?.textContent }, { active: 'behavior', behaviorHidden: false, action: 'Edit Order behavior' });
		controls.selectTab('element-inspector', 'architecture', true);
		assert.deepStrictEqual([current.activeId, document.activeElement], ['architecture', tab('Architecture')]);
	});

	test('programmatic selection moves focus out of the panel being hidden', () => {
		const controls = store.add(new OrditoControls()); const tabs = controls.tabs(root, 'inspector', entries);
		const action = controls.button(tabs.panels.get('properties')!, 'Edit Properties', () => {});
		action.focus(); tabs.select('behavior');
		assert.deepStrictEqual({ active: tabs.activeId, focus: document.activeElement, oldHidden: tabs.panels.get('properties')?.hidden }, { active: 'behavior', focus: tab('Behavior'), oldHidden: true });
	});

	test('groups remain independent and unavailable saved selections fall back to an existing tab', () => {
		const controls = store.add(new OrditoControls());
		const first = controls.tabs(root, 'element-inspector', entries), second = controls.tabs(root, 'relation-inspector', entries);
		first.select('architecture'); second.select('behavior');
		assert.deepStrictEqual([first.activeId, second.activeId], ['architecture', 'behavior']);
		assert.ok(controls.focusTarget('tab:relation-inspector:properties'));
		assert.strictEqual(controls.focusTabGroup('relation-inspector'), true);
		const selectedTab = document.getElementById(second.panels.get('behavior')!.getAttribute('aria-labelledby')!);
		assert.deepStrictEqual([second.activeId, document.activeElement], ['behavior', selectedTab]);
		assert.strictEqual(controls.focusTabGroup('missing'), false);
		assert.strictEqual(document.activeElement, selectedTab);
		const identities = [...root.querySelectorAll('[role="tab"], [role="tabpanel"]')].map(element => element.id);
		assert.strictEqual(new Set(identities).size, identities.length);
		let updated: ReturnType<OrditoControls['tabs']> | undefined;
		controls.render(root, () => { root.replaceChildren(); updated = controls.tabs(root, 'element-inspector', entries.slice(0, 2)); });
		assert.ok(updated); assert.strictEqual(updated.activeId, 'properties');
		assert.strictEqual(updated.panels.get('properties')?.hidden, false);
		assert.strictEqual(controls.focusTabGroup('relation-inspector'), false);
	});

	test('old tab listeners are removed on refresh and disposal', () => {
		const controls = store.add(new OrditoControls());
		controls.tabs(root, 'inspector', entries);
		const oldBehavior = tab('Behavior');
		let current: ReturnType<OrditoControls['tabs']> | undefined;
		controls.render(root, () => { root.replaceChildren(); current = controls.tabs(root, 'inspector', entries); });
		assert.ok(current); current.select('architecture'); oldBehavior.click();
		assert.strictEqual(current.activeId, 'architecture');
		tab('Behavior').click(); const architecture = tab('Architecture'); controls.dispose(); architecture.click();
		assert.strictEqual(current.activeId, 'behavior');
	});
});
