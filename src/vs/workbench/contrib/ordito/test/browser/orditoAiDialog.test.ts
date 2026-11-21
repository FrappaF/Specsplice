import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OrditoAiDialog } from '../../browser/orditoAiDialogView.js';
import { type OrditoAiMessage } from '../../browser/orditoAiDialog.js';
import { OrditoControls } from '../../browser/orditoControls.js';

suite('Specsplice transient assistant dialog', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	setup(() => { root = dom.append(document.body, dom.$('section')); });
	teardown(() => root.remove());
	function enterText(input: HTMLTextAreaElement, text: string): void { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); }

	test('conversation is usable in the dialog and resets on every close; Escape restores focus', async () => {
		const trigger = dom.append(root, dom.$<HTMLButtonElement>('button')); trigger.textContent = 'Assistant'; trigger.focus();
		const sent: OrditoAiMessage[][] = []; let refreshes = 0;
		const open = () => {
			const dialog = store.add(new OrditoAiDialog(root, { onClose: async () => { refreshes++; }, send: async messages => { sent.push(messages); return '<script>untrusted()</script>'; } }));
			dialog.showConversation(); return dialog;
		};
		const first = open();
		const input = first.element.querySelector('textarea')!; enterText(input, 'Generate all diagrams');
		first.element.querySelector('form')!.requestSubmit(); await timeout(0);
		assert.deepStrictEqual([first.element.open, first.element.querySelectorAll('article').length, first.element.querySelector('script'), sent], [true, 2, null, [[{ role: 'user', text: 'Generate all diagrams' }]]]);
		first.element.dispatchEvent(new Event('cancel', { cancelable: true })); await timeout(0);
		assert.deepStrictEqual([refreshes, root.querySelector('dialog'), document.activeElement], [1, null, trigger]);
		const next = open();
		assert.deepStrictEqual([next.element.querySelectorAll('article').length, next.element.querySelector('textarea')!.value], [0, '']);
		await next.close(); assert.equal(refreshes, 2);
	});

	test('closing cancels a running turn and late output cannot reappear in the next conversation', async () => {
		const response = new DeferredPromise<string>(); let cancelled = false;
		const first = store.add(new OrditoAiDialog(root, { onClose: async () => {}, send: async (_messages, token) => {
			const listener = token.onCancellationRequested(() => { cancelled = true; });
			try { return await response.p; } finally { listener.dispose(); }
		} }));
		first.showConversation(); enterText(first.element.querySelector('textarea')!, 'Generate'); first.element.querySelector('form')!.requestSubmit();
		assert.equal(first.element.querySelector('textarea')!.disabled, true);
		await first.close();
		const next = store.add(new OrditoAiDialog(root, { onClose: async () => {}, send: async () => 'New session' })); next.showConversation();
		await response.complete('Old session output'); await timeout(0);
		assert.deepStrictEqual([cancelled, next.element.querySelectorAll('article').length, next.element.textContent?.includes('Old session output')], [true, 0, false]);
		await next.close();
	});

	test('closing refreshes the page and restores focus to the rebuilt action', async () => {
		root.className = 'ordito-shell';
		const controls = store.add(new OrditoControls()); let current: HTMLButtonElement;
		const render = () => controls.render(root, () => { dom.clearNode(root); current = controls.button(root, 'Explore Architecture', () => {}, 'explore'); });
		render(); current!.focus();
		const dialog = store.add(new OrditoAiDialog(document.body, { onClose: async () => render() })); dialog.showConversation();
		await dialog.close();
		assert.deepStrictEqual([document.activeElement, root.querySelectorAll('button').length], [current!, 1]);
	});

	test('live CLI responses appear before completion and saved counters do not hide the current activity', async () => {
		const response = new DeferredPromise<string>();
		const dialog = store.add(new OrditoAiDialog(root, { onClose: async () => {}, send: async () => response.p })); dialog.showConversation();
		enterText(dialog.element.querySelector('textarea')!, 'Repair the saved drafts'); dialog.element.querySelector('form')!.requestSubmit();
		dialog.updateConversation({ requestId: 'turn', kind: 'connecting' });
		dialog.updateProgress('10 Planned Diagrams · 6 Review Issues · 69 Source Tool Calls');
		assert.ok(dialog.element.textContent?.includes('Connecting to the Assistant'));
		dialog.updateConversation({ requestId: 'turn', kind: 'message', itemId: 'repair', text: 'I found six obsolete invalid attempts.' });
		assert.deepStrictEqual([dialog.element.querySelectorAll('article').length, dialog.element.querySelector('textarea')!.disabled], [2, true]);
		dialog.updateConversation({ requestId: 'turn', kind: 'message', itemId: 'repair', text: 'The existing diagrams are ready for review.' });
		await response.complete('The existing diagrams are ready for review.'); await timeout(0);
		assert.deepStrictEqual([dialog.element.querySelectorAll('article').length, dialog.element.querySelector('textarea')!.disabled], [2, false]);
		await dialog.close();
	});

	test('Enter sends once and shows a busy spinner until the response completes', async () => {
		const response = new DeferredPromise<string>(), sent: OrditoAiMessage[][] = [];
		const dialog = store.add(new OrditoAiDialog(root, { prompt: 'Update the diagrams', onClose: async () => {}, send: async messages => { sent.push(messages); return response.p; } })); dialog.showConversation();
		const input = dialog.element.querySelector('textarea')!, button = dialog.element.querySelector<HTMLButtonElement>('form button')!;
		const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); input.dispatchEvent(enter);
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		assert.deepStrictEqual({ prevented: enter.defaultPrevented, sent, busy: button.getAttribute('aria-busy'), disabled: button.disabled, spinner: !!button.querySelector('.codicon-loading.codicon-modifier-spin'), label: button.textContent }, { prevented: true, sent: [[{ role: 'user', text: 'Update the diagrams' }]], busy: 'true', disabled: true, spinner: true, label: 'Working…' });
		await response.complete('Prepared'); await timeout(0);
		assert.deepStrictEqual([button.disabled, button.getAttribute('aria-busy'), button.querySelector('.codicon'), button.textContent, document.activeElement], [true, 'false', null, 'Send', input]);
		await dialog.close();
	});

	test('blank messages disable Send and typing a meaningful request enables it', async () => {
		let sent = 0;
		const dialog = store.add(new OrditoAiDialog(root, { prompt: 'Initial request', onClose: async () => {}, send: async () => { sent++; return 'Done'; } })); dialog.showConversation();
		const input = dialog.element.querySelector('textarea')!, button = dialog.element.querySelector<HTMLButtonElement>('form button')!;
		assert.equal(button.disabled, false);
		enterText(input, ' \n '); assert.equal(button.disabled, true);
		dialog.element.querySelector('form')!.requestSubmit(); await timeout(0); assert.equal(sent, 0);
		enterText(input, 'Follow up'); assert.equal(button.disabled, false);
		await dialog.close();
	});

	test('Shift+Enter, composition and repeated keys never submit; whitespace stays unsent', async () => {
		let sent = 0;
		const dialog = store.add(new OrditoAiDialog(root, { onClose: async () => {}, send: async () => { sent++; return 'Done'; } })); dialog.showConversation();
		const input = dialog.element.querySelector('textarea')!; enterText(input, 'A multiline request');
		for (const options of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
			const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true, ...options }); input.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
		}
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, cancelable: true, bubbles: true }));
		enterText(input, ' \n '); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true }));
		assert.deepStrictEqual([sent, dialog.element.querySelectorAll('article').length], [0, 0]); await dialog.close();
	});

	test('a failed request clears the spinner and Enter can send a follow-up', async () => {
		let sent = 0;
		const dialog = store.add(new OrditoAiDialog(root, { onClose: async () => {}, send: async () => { if (++sent === 1) { throw new Error('Provider stopped responding'); } return 'Recovered'; } })); dialog.showConversation();
		const input = dialog.element.querySelector('textarea')!, button = dialog.element.querySelector<HTMLButtonElement>('form button')!;
		enterText(input, 'First attempt'); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await timeout(0);
		assert.deepStrictEqual([button.disabled, button.querySelector('.codicon-modifier-spin'), dialog.element.querySelector('.ordito-error-notice pre')?.textContent], [true, null, 'Provider stopped responding']);
		enterText(input, 'Continue'); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await timeout(0);
		assert.deepStrictEqual([sent, button.disabled, dialog.element.querySelector('[role="alert"]'), dialog.element.textContent?.includes('Recovered')], [2, true, null, true]); await dialog.close();
	});
});
