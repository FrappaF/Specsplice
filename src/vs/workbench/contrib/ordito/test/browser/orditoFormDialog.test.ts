import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OrditoFormDialog } from '../../browser/orditoFormDialog.js';

suite('Specsplice form dialog', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let parent: HTMLElement;
	setup(() => { parent = document.body.appendChild(document.createElement('div')); });
	teardown(() => parent.remove());

	test('validates visible fields, skips disabled groups and commits all fields together', async () => {
		const dialog = store.add(new OrditoFormDialog(parent, { title: 'Edit Details' }));
		const name = dialog.text(dialog.body, 'Name', '', { required: true });
		const description = dialog.text(dialog.body, 'Description', 'First line\nSecond line', { multiline: true });
		const disabled = dialog.body.appendChild(document.createElement('fieldset')); disabled.disabled = true;
		dialog.text(disabled, 'Inactive Field', '', { required: true });
		const result = dialog.open(() => ({ name: name.value.trim(), description: description.value }));
		name.value = '   '; dialog.body.requestSubmit();
		assert.deepStrictEqual([name.getAttribute('aria-invalid'), document.activeElement === name], ['true', true]);
		name.value = 'Customer'; name.dispatchEvent(new Event('input')); dialog.body.requestSubmit();
		assert.deepStrictEqual(await result, { name: 'Customer', description: 'First line\nSecond line' });
		assert.strictEqual(parent.querySelector('dialog'), null);
	});

	test('Escape cancels the draft, restores focus and disposes listeners', async () => {
		const origin = parent.appendChild(document.createElement('button')); origin.focus();
		const dialog = store.add(new OrditoFormDialog(parent, { title: 'Edit Details' }));
		let reads = 0;
		const name = dialog.text(dialog.body, 'Name', 'Original');
		const result = dialog.open(() => { reads++; return name.value; });
		name.value = 'Draft';
		parent.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
		assert.deepStrictEqual([await result, reads, document.activeElement === origin, parent.querySelector('dialog')], [undefined, 0, true, null]);
	});

	test('removing an invalid collection row does not block saving the remaining draft', async () => {
		const dialog = store.add(new OrditoFormDialog(parent, { title: 'Members' }));
		const row = dialog.body.appendChild(document.createElement('fieldset'));
		dialog.text(row, 'Name', '', { required: true });
		const result = dialog.open(() => []);
		dialog.body.requestSubmit(); row.remove(); dialog.body.requestSubmit();
		assert.deepStrictEqual(await result, []);
	});

	test('cross-field failures explain the cause and recovery while keeping the draft editable', async () => {
		const dialog = store.add(new OrditoFormDialog(parent, { title: 'Delivery Times' }));
		const publish = dialog.text(dialog.body, 'Publish Time', '30');
		const delivery = dialog.text(dialog.body, 'Delivery Time', '20');
		const result = dialog.open(() => ({ publish: Number(publish.value), delivery: Number(delivery.value) }), value => value.delivery < value.publish ? 'Delivery cannot precede publication.' : undefined);
		dialog.body.requestSubmit();
		assert.deepStrictEqual({
			cause: parent.querySelector('.ordito-error-notice dd')?.textContent,
			labels: [...parent.querySelectorAll('.ordito-error-notice dt')].map(label => label.textContent),
			draft: [publish.value, delivery.value],
			open: parent.querySelector('dialog')?.open
		}, { cause: 'Delivery cannot precede publication.', labels: ['Cause', 'How to Resolve'], draft: ['30', '20'], open: true });
		delivery.value = '40'; delivery.dispatchEvent(new Event('input'));
		assert.strictEqual(parent.querySelector('.ordito-error-notice'), null);
		dialog.body.requestSubmit();
		assert.deepStrictEqual(await result, { publish: 30, delivery: 40 });
	});

	test('a failed form reader stays in the dialog and can be retried', async () => {
		const dialog = store.add(new OrditoFormDialog(parent, { title: 'Edit Value' }));
		const input = dialog.text(dialog.body, 'Value', 'Original');
		let reads = 0;
		const result = dialog.open(() => { if (++reads === 1) { throw new Error('Unexpected read failure'); } return input.value; });
		dialog.body.requestSubmit();
		assert.deepStrictEqual({ draft: input.value, open: parent.querySelector('dialog')?.open, details: parent.querySelector('.ordito-error-notice pre')?.textContent }, { draft: 'Original', open: true, details: 'Unexpected read failure' });
		dialog.body.requestSubmit();
		assert.strictEqual(await result, 'Original');
	});
});
