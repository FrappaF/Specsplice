import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OrditoControls } from '../../browser/orditoControls.js';
import { renderOrditoState } from '../../browser/orditoState.js';
import { orditoStateRows } from '../../browser/orditoStateContent.js';
import { stateFixture } from '../common/stateFixture.js';

suite('Specsplice executable state renderer', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite(); let root: HTMLElement;
	setup(() => { root = dom.append(document.body, dom.$('section')); }); teardown(() => root.remove());
	test('native state table preserves semantic order, keyboard focus and model', () => { const model = structuredClone(stateFixture), before = structuredClone(model), selected: string[] = []; renderOrditoState(root, model, model.views[0], disposables.add(new OrditoControls()), () => {}, id => selected.push(id)); const rows = [...root.querySelectorAll<HTMLElement>('[data-state-id]')]; assert.deepStrictEqual(rows.map(row => row.dataset.stateId), orditoStateRows(model, 'checkout.lifecycle').map(row => row.id)); const button = root.querySelector<HTMLButtonElement>('[data-state-id="Draft"] button')!; button.focus(); assert.strictEqual(document.activeElement, button); button.click(); assert.deepStrictEqual(selected, ['Draft']); assert.deepStrictEqual(model, before); });
	test('hostile state labels are rendered as text and policy is accessible', () => { const model = structuredClone(stateFixture); model.semantics.elements.find(element => element.id === 'Draft')!.name = '<img src=x onerror=alert(1)>'; renderOrditoState(root, model, model.views[0], disposables.add(new OrditoControls()), () => {}, () => {}); assert.strictEqual(root.querySelector('img'), null); for (const row of orditoStateRows(model, 'checkout.lifecycle')) { assert.ok(root.textContent?.includes(row.text)); } assert.strictEqual(root.querySelector('section')?.getAttribute('aria-label'), 'Executable State Machine'); });
});
