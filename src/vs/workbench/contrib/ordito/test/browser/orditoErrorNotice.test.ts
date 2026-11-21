import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OrditoControls } from '../../browser/orditoControls.js';
import { renderOrditoErrorNotice } from '../../browser/orditoErrorNotice.js';
import { describeOrditoError } from '../../browser/orditoErrors.js';

suite('Specsplice shared error notice', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let parent: HTMLElement;
	setup(() => { parent = document.body.appendChild(document.createElement('div')); });
	teardown(() => parent.remove());

	test('announces a complete explanation without taking focus or rendering technical text as HTML', () => {
		const controls = store.add(new OrditoControls());
		const input = parent.appendChild(document.createElement('input')); input.focus();
		const notice = renderOrditoErrorNotice(parent, { title: 'Could Not Complete the Change', cause: 'The target is incompatible.', resolution: 'Choose a compatible target.', details: '<script>untrusted()</script>' }, controls);
		const details = notice.querySelector('details')!;
		assert.deepStrictEqual({
			role: notice.getAttribute('role'),
			labelledBy: notice.getAttribute('aria-labelledby') === notice.querySelector('h3')?.id,
			labels: [...notice.querySelectorAll('dt')].map(label => label.textContent),
			values: [...notice.querySelectorAll('dd')].map(value => value.textContent),
			focused: document.activeElement === input,
			technicalOpen: details.open,
			technical: notice.querySelector('pre')?.textContent,
			script: notice.querySelector('script')
		}, { role: 'alert', labelledBy: true, labels: ['Cause', 'How to Resolve'], values: ['The target is incompatible.', 'Choose a compatible target.'], focused: true, technicalOpen: false, technical: '<script>untrusted()</script>', script: null });
	});

	test('omits technical disclosure when no technical detail is available', () => {
		const notice = renderOrditoErrorNotice(parent, { title: 'Check the Values', cause: 'A value is required.', resolution: 'Enter a name.' }, store.add(new OrditoControls()));
		assert.strictEqual(notice.querySelector('details'), null);
	});

	test('failed synchronous and asynchronous actions report in place while preserving the entered value and focus', async () => {
		const input = parent.appendChild(document.createElement('input')); input.value = 'Unfinished element';
		const notices = parent.appendChild(document.createElement('div'));
		const errors: unknown[] = [];
		const noticeControls = store.add(new OrditoControls());
		const controls = store.add(new OrditoControls(error => {
			errors.push(error);
			noticeControls.render(notices, () => { notices.replaceChildren(); renderOrditoErrorNotice(notices, describeOrditoError(error, 'edit'), noticeControls); });
		}));
		const synchronous = new Error('Synchronous edit failure');
		const asynchronous = new Error('Asynchronous action failure');
		const edit = controls.button(parent, 'Apply Change', () => { throw synchronous; });
		const save = controls.button(parent, 'Save Changes', async () => { throw asynchronous; });
		input.focus(); edit.click();
		assert.deepStrictEqual({ errors, draft: input.value, focused: document.activeElement === input, details: notices.querySelector('pre')?.textContent }, { errors: [synchronous], draft: 'Unfinished element', focused: true, details: synchronous.message });
		save.click(); await timeout(0);
		assert.deepStrictEqual({ errors, draft: input.value, focused: document.activeElement === input, notices: notices.querySelectorAll('[role="alert"]').length, details: notices.querySelector('pre')?.textContent }, { errors: [synchronous, asynchronous], draft: 'Unfinished element', focused: true, notices: 1, details: asynchronous.message });
	});
});
