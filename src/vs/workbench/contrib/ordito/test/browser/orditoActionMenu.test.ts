import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OrditoActionMenu } from '../../browser/orditoActionMenu.js';
import { OrditoControls } from '../../browser/orditoControls.js';

suite('Specsplice action menu hierarchy', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	let controls: OrditoControls;
	let menu: OrditoActionMenu;
	setup(() => {
		root = dom.append(document.body, dom.$('section.ordito-shell', { tabindex: '-1' }));
		controls = store.add(new OrditoControls()); menu = new OrditoActionMenu(controls);
	});
	teardown(() => root.remove());

	test('keeps command names distinct from descriptions, badges and decorative icons', () => {
		menu.header(root, 'Customer', 'Entity', Codicon.database);
		const section = menu.section(root, 'Explore');
		let opened = false;
		const action = menu.action(section, 'Element Details', () => { opened = true; }, { icon: Codicon.goToFile, kind: 'navigation', description: 'Inspect the shared definition', detail: '3 views' });
		action.click();
		const described = action.getAttribute('aria-describedby')!.split(' ').map(id => document.getElementById(id)?.textContent);
		assert.deepStrictEqual({ label: action.getAttribute('aria-label'), described, opened, iconsHidden: [...action.querySelectorAll('.codicon')].every(icon => !!icon.closest('[aria-hidden="true"]')), menuRole: root.querySelector('[role="menu"]') }, { label: 'Element Details', described: ['Inspect the shared definition', '3 views'], opened: true, iconsHidden: true, menuRole: null });
	});

	test('separates facts, navigation and destructive actions with semantic groups', () => {
		menu.header(root, 'Customer', 'Entity');
		const facts = menu.section(root, 'Overview'); menu.info(facts, 'Technology', 'TypeScript');
		const explore = menu.section(root, 'Diagrams');
		const current = menu.action(explore, 'Entities', () => assert.fail('Current view should not be activated'), { kind: 'navigation', current: true, icon: Codicon.database });
		const danger = menu.section(root, 'Delete from System', { tone: 'danger' });
		const remove = menu.action(danger, 'Delete Element', () => {}, { kind: 'destructive', icon: Codicon.trash });
		assert.deepStrictEqual({ groups: [...root.querySelectorAll('.ordito-menu-section')].map(section => document.getElementById(section.getAttribute('aria-labelledby')!)?.textContent), facts: facts.textContent, current: [current.disabled, current.getAttribute('aria-current'), document.getElementById(current.getAttribute('aria-describedby')!)?.textContent], dangerLast: root.lastElementChild === remove.closest('.ordito-menu-danger'), noFactButton: !facts.querySelector('button') }, { groups: ['Overview', 'Diagrams', 'Delete from System'], facts: 'TechnologyTypeScript', current: [true, 'true', 'Current'], dangerLast: true, noFactButton: true });
	});

	test('preserves focused actions and disclosure state across rerenders', () => {
		const render = () => controls.render(root, () => {
			dom.clearNode(root);
			const body = menu.disclosure(root, 'Architecture', 'architecture', { icon: Codicon.typeHierarchy });
			menu.action(body, 'Edit Blueprint', () => {}, { id: 'edit-blueprint', icon: Codicon.edit });
		});
		render(); controls.setExpanded('architecture', true); controls.focusTarget('edit-blueprint'); render();
		assert.deepStrictEqual({ open: root.querySelector('details')?.open, focused: document.activeElement?.getAttribute('aria-label') }, { open: true, focused: 'Edit Blueprint' });
	});

	test('native popup closes on outside pointer and Escape returns to its trigger', () => {
		const body = controls.details(root, 'Project', 'project', { popup: true });
		menu.header(body, 'Store'); menu.action(menu.section(body, 'Navigate'), 'Home', () => {}, { icon: Codicon.home });
		const details = body.parentElement as HTMLDetailsElement;
		controls.setExpanded('project', true);
		body.querySelector('button')!.focus();
		body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		assert.deepStrictEqual([details.open, document.activeElement === details.firstElementChild], [false, true]);
		controls.setExpanded('project', true);
		document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
		assert.strictEqual(details.open, false);
	});

	test('reports synchronous and asynchronous action failures through the shared controls', async () => {
		const received: Error[] = [];
		const synchronous = new Error('Synchronous failure');
		const asynchronous = new Error('Asynchronous failure');
		const reported = new Promise<void>(resolve => {
			const reporting = store.add(new OrditoControls(error => {
				assert.ok(error instanceof Error);
				received.push(error);
				if (received.length === 2) { resolve(); }
			}));
			const actions = new OrditoActionMenu(reporting);
			actions.action(root, 'Synchronous Action', () => { throw synchronous; }).click();
			actions.action(root, 'Asynchronous Action', async () => { throw asynchronous; }).click();
		});
		await reported;
		assert.deepStrictEqual(received, [synchronous, asynchronous]);
	});
});
