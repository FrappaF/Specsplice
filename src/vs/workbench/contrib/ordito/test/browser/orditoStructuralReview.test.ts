import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OrditoControls } from '../../browser/orditoControls.js';
import { renderStructuralReview, type StructuralReviewActions } from '../../browser/orditoStructuralReview.js';
import { createPureProject, type StructuralProjectSession } from '../../common/modelProject.js';
import { nodeOrdersFixture } from '../common/nodeOrdersFixture.js';

suite('Specsplice visual structural review', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite(); let root: HTMLElement;
	setup(() => { root = dom.append(document.body, dom.$('section.ordito-shell')); root.tabIndex = -1; }); teardown(() => root.remove());
	function fixture() {
		const called: string[] = [], controls = store.add(new OrditoControls());
		const session = { direction: 'forward', mutations: [{ file: 'src/domain/quantity.mjs', before: null, after: { content: 'value', mode: 420 } }], verification: { generated: 8, independent: 8, output: '16 tests passed' } } as StructuralProjectSession;
		const actions: StructuralReviewActions = { busy: false, canVerify: true, canApply: false, canUndo: false, prepare: () => called.push('prepare'), verify: () => called.push('verify'), apply: () => called.push('apply'), undo: () => called.push('undo'), technical: () => called.push('technical'), returnToDiagram: () => called.push('return') };
		const render = () => controls.render(root, () => { root.textContent = ''; renderStructuralReview(root, nodeOrdersFixture, session, controls, actions); });
		return { called, controls, session, actions, render };
	}
	test('real verification and reviewed publication are distinct, with disabled stale publication', () => {
		const f = fixture(); f.render(); const buttons = [...root.querySelectorAll('button')]; assert.strictEqual(buttons[0].textContent, 'Run Real Verification'); assert.strictEqual(buttons[1].disabled, true); buttons[1].click(); buttons[0].click(); assert.deepStrictEqual(f.called, ['verify']);
		f.actions.canApply = true; f.render(); root.querySelectorAll('button')[1].click(); assert.deepStrictEqual(f.called, ['verify', 'apply']); assert.ok(root.textContent?.includes('Real Verification Passed'));
		f.actions.canApply = false; f.actions.canVerify = false; f.render(); assert.ok(root.textContent?.includes('Prepare a New Review')); assert.strictEqual(root.querySelectorAll('button')[1].disabled, true);
	});
	test('keyboard focus and disclosure expansion survive a review update', () => {
		const f = fixture(); f.render(); const details = root.querySelector('details')!; details.open = true; const button = root.querySelectorAll('button')[3]; button.focus(); assert.strictEqual(document.activeElement, button);
		f.render(); assert.strictEqual(document.activeElement, root.querySelectorAll('button')[3]); assert.strictEqual(root.querySelector('details')!.open, true); root.querySelectorAll('button')[3].click(); assert.deepStrictEqual(f.called, ['return']);
	});
	test('hostile names/output remain text and technical details are secondary', () => {
		const f = fixture(); f.session.mutations[0].file = '<img src=x onerror=alert(1)>'; f.session.verification!.output = '<script>bad()</script>'; f.render();
		assert.strictEqual(root.querySelector('img,script'), null); assert.ok(root.textContent?.includes('<script>bad()</script>')); assert.ok(root.textContent?.includes('Price Unknown')); assert.strictEqual(root.querySelector('section')?.getAttribute('aria-label'), 'Model and Code Review');
	});
	test('busy review disables all actions; outcomes and coverage are conveyed in text', () => {
		const f = fixture(); f.actions.busy = true; f.render(); assert.ok([...root.querySelectorAll('button')].every(button => button.disabled));
		for (const part of ['8 Derived Cases', '8 Independent Cases', 'Custom Code and Live Broker Execution', 'Zero AI Calls']) { assert.ok(root.textContent?.includes(part), part); }
		assert.ok(root.querySelector('[role="status"]')); assert.strictEqual(root.querySelector('pre')?.tabIndex, 0);
	});
	test('the actionable review-change reason is visible without opening technical details', () => {
		const f = fixture(); f.actions.canVerify = false;
		f.actions.problem = 'Independent business expectations changed. Prepare a new review before running verification or applying.';
		f.render();
		const notice = root.querySelector('[role="alert"]')!;
		assert.ok(notice.querySelector('dd')?.textContent?.includes('business expectations changed'));
		assert.ok(notice.querySelectorAll('dd')[1].textContent?.includes('new review'));
		assert.deepStrictEqual([notice.querySelector('details')?.open, notice.querySelector('pre')?.textContent], [false, f.actions.problem]);
		assert.ok(!root.textContent?.includes('The operation could not finish'));
	});

	test('failed real checks remain visible and publication stays blocked', () => {
		const f = fixture(); f.session.status = 'failed'; f.session.verification!.output = 'Independent boundary case failed'; f.render();
		assert.ok(root.textContent?.includes('Real Verification Failed · Application Blocked')); assert.strictEqual(root.querySelectorAll('button')[1].disabled, true);
	});

	test('a busy transition restores focus to a useful action after local application', () => {
		const f = fixture(); f.actions.canApply = true; f.render(); root.querySelectorAll('button')[1].focus();
		f.actions.busy = true; f.render(); assert.strictEqual(document.activeElement, root);
		f.actions.busy = false; f.actions.canApply = false; f.actions.canVerify = false; f.actions.canUndo = true; f.render();
		assert.strictEqual(document.activeElement, root.querySelectorAll('button')[2]);
	});

	test('successful undo has its own outcome and offers a new review', () => {
		const f = fixture(); f.session.status = 'undone'; f.actions.canVerify = false; f.render();
		assert.ok(root.textContent?.includes('Local Changes Undone · Prepare a New Review to Continue'));
		root.querySelector<HTMLButtonElement>('.ordito-primary-action')!.click();
		assert.deepStrictEqual(f.called, ['prepare']);
	});

	test('review explains the authored business rule without opening generated files or JSON', () => {
		const f = fixture(); let id = 0;
		f.session.next = { model: createPureProject('Order Rules', () => `review.${++id}`).model } as StructuralProjectSession['next'];
		f.render();
		for (const text of ['Reviewed Behavior · Order Rules', 'Quantity Validation', 'validateQuantity: (quantity > 0)']) { assert.ok(root.textContent?.includes(text), text); }
	});

	test('runtime change exposes implementation, dependencies, existing data, tests, deployment and recovery as readable text', () => {
		const f = fixture(); f.session.stackPlan = { version: 1, from: 'node.esm@5', to: 'bun.esm@1', pimRevision: 'seal', implementation: 'Same model', dependencies: 'Bun 1.3.2', storage: 'Stop and back up checkpoint', tests: 'Same business criteria', deployment: 'Manual restart', recovery: 'Keep original runtime' }; f.render();
		for (const part of ['Runtime Change', 'node.esm@5', 'bun.esm@1', 'Storage and Existing Data', 'Stop and back up checkpoint', 'Manual restart', 'Keep original runtime']) { assert.ok(root.textContent?.includes(part), part); }
		assert.strictEqual(root.querySelectorAll('button')[1].disabled, true);
	});

});
