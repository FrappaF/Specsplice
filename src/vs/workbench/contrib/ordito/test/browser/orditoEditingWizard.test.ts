import assert from 'assert';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { editOrditoBehavior } from '../../browser/orditoBehaviorEditing.js';
import { OrditoEditingWizard } from '../../browser/orditoEditingWizard.js';
import { blueprintFixture } from '../common/blueprintFixture.js';

suite('Specsplice shared editing wizard', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let parent: HTMLElement;
	let wizard: OrditoEditingWizard;
	setup(() => {
		parent = document.body.appendChild(document.createElement('div'));
		wizard = store.add(new OrditoEditingWizard(parent));
	});
	teardown(() => { wizard.dispose(); parent.remove(); });

	const button = (label: string) => {
		const element = [...parent.querySelectorAll('button')].find(button => button.textContent === label || button.getAttribute('aria-label') === label);
		assert.ok(element, `Missing button: ${label}`); element.click();
	};
	const waitForDOM = (ready: () => boolean): Promise<void> => {
		if (ready()) { return Promise.resolve(); }
		return new Promise(resolve => {
			const observer = new MutationObserver(() => { if (ready()) { observer.disconnect(); resolve(); } });
			store.add(toDisposable(() => observer.disconnect()));
			observer.observe(parent, { subtree: true, childList: true, characterData: true });
		});
	};
	const page = (title: string) => waitForDOM(() => parent.querySelector('h3')?.textContent === title);
	const select = (label: string) => {
		const row = [...parent.querySelectorAll('label')].find(row => row.querySelector('strong')?.textContent === label);
		assert.ok(row, `Missing option: ${label}`); row.click();
	};
	const fill = (value: string) => {
		const input = parent.querySelector<HTMLInputElement>('input[type="text"]'); assert.ok(input); input.value = value;
	};
	const next = async (title: string) => { button('Next'); await page(title); };

	test('behavior editing preserves drafts with Back and returns one detached contract after review', async () => {
		const model = structuredClone(blueprintFixture);
		const before = structuredClone(model);
		const element = model.semantics.elements.find(element => element.id === 'component.checkout')!;
		const result = wizard.run('Edit Behavior', element.name, quick => editOrditoBehavior(quick, model, element));
		await page('Behavioral Contract: Checkout');
		assert.strictEqual(parent.querySelector('h2')?.textContent, 'Edit Behavior');
		assert.ok(![...parent.querySelectorAll('button')].some(button => button.textContent === 'Back'));
		select('Inputs'); await next('Inputs');
		select('Add Entry'); await next('Field Name');
		fill('customerId'); await next('Field Type');
		fill('string'); button('Back'); await page('Field Name');
		assert.strictEqual(parent.querySelector<HTMLInputElement>('input[type="text"]')?.value, 'customerId');
		await next('Field Type');
		assert.strictEqual(parent.querySelector<HTMLInputElement>('input[type="text"]')?.value, 'string');
		await next('Field Presence'); select('Required'); await next('Review Your Changes');
		assert.deepStrictEqual(model, before);
		button('Edit Field Name'); await page('Field Name');
		fill('accountId'); await next('Review Your Changes');
		button('Apply Changes');
		assert.deepStrictEqual((await result)?.inputs, [{ name: 'accountId', type: 'string', required: true }]);
		assert.deepStrictEqual(model, before);
		assert.strictEqual(parent.querySelector('dialog'), null);
	});

	test('cancel during asynchronous validation settles immediately and ignores the late result', async () => {
		const origin = document.body.appendChild(document.createElement('button')); origin.focus();
		wizard.dispose(); wizard = store.add(new OrditoEditingWizard(parent));
		let finishValidation: (error: string | undefined) => void = () => { throw new Error('Validation did not start'); };
		try {
			const result = wizard.run('Create Entry', 'Checkout', quick => quick.input({ title: 'Entry Name', validateInput: () => new Promise(resolve => { finishValidation = resolve; }) }));
			await page('Entry Name'); fill('Draft'); button('Next');
			button('Cancel');
			assert.strictEqual(await result, undefined);
			finishValidation('Late Error');
			await Promise.resolve();
			assert.deepStrictEqual({ dialog: parent.querySelector('dialog'), focused: document.activeElement === origin }, { dialog: null, focused: true });
		} finally { origin.remove(); }
	});

	test('changing a choice before Back preserves the draft and clears dependent answers', async () => {
		const result = wizard.run('Create Value', 'Project', async quick => {
			const name = await quick.input({ title: 'Name' });
			const kind = await quick.pick([{ label: 'Text', value: 'text' }, { label: 'Number', value: 'number' }], { title: 'Value Type' });
			if (!kind) { return; }
			const value = await quick.pick((kind.value === 'text' ? ['Alpha', 'Beta'] : ['One', 'Two']).map(label => ({ label })), { title: 'Value' });
			return value ? { name, kind: kind.value, value: value.label } : undefined;
		});
		await page('Name'); fill('Entry'); await next('Value Type'); select('Text'); await next('Value'); select('Beta'); await next('Review Your Changes');
		button('Edit Value Type'); await page('Value Type'); select('Number'); button('Back'); await page('Name');
		await next('Value Type');
		assert.strictEqual(parent.querySelector<HTMLInputElement>('input:checked')?.closest('label')?.textContent, 'Number');
		await next('Value');
		assert.strictEqual(parent.querySelector('input:checked'), null);
		select('One'); await next('Review Your Changes'); button('Apply Changes');
		assert.deepStrictEqual(await result, { name: 'Entry', kind: 'number', value: 'One' });
	});

	test('editing an earlier time revalidates later answers before returning to review', async () => {
		const result = wizard.run('Messaging Scenario', 'Project', async quick => {
			const published = await quick.input({ title: 'Publish Time', validateInput: async value => /^\d+$/.test(value) ? undefined : 'Enter a time.' });
			if (published === undefined) { return; }
			const delivered = await quick.input({ title: 'Delivery Time', validateInput: async value => /^\d+$/.test(value) && Number(value) >= Number(published) ? undefined : 'Delivery cannot precede publication.' });
			return delivered === undefined ? undefined : { published: Number(published), delivered: Number(delivered) };
		});
		await page('Publish Time'); fill('10'); await next('Delivery Time'); fill('20'); await next('Review Your Changes');
		button('Edit Publish Time'); await page('Publish Time'); fill('30'); await next('Delivery Time');
		assert.deepStrictEqual({ draft: parent.querySelector<HTMLInputElement>('input[type="text"]')?.value, validation: parent.querySelector('.ordito-error-notice dd')?.textContent }, { draft: '20', validation: 'Delivery cannot precede publication.' });
		fill('40'); await next('Review Your Changes'); button('Apply Changes');
		assert.deepStrictEqual(await result, { published: 30, delivered: 40 });
	});

	test('cancel also settles while a replayed answer is being validated', async () => {
		let finishValidation: (error: string | undefined) => void = () => { throw new Error('Replay validation did not start'); };
		let validationStarted: () => void = () => {};
		const validating = new Promise<void>(resolve => { validationStarted = resolve; });
		const result = wizard.run('Timed Scenario', 'Project', async quick => {
			const published = await quick.input({ title: 'Publish Time' });
			const delivered = await quick.input({ title: 'Delivery Time', validateInput: value => published === '30' ? new Promise(resolve => { finishValidation = resolve; validationStarted(); }) : Promise.resolve(value ? undefined : 'Enter a time.') });
			return { published, delivered };
		});
		await page('Publish Time'); fill('10'); await next('Delivery Time'); fill('20'); await next('Review Your Changes');
		button('Edit Publish Time'); await page('Publish Time'); fill('30'); button('Next'); await validating;
		button('Cancel');
		assert.strictEqual(await result, undefined);
		finishValidation('Late Error'); await Promise.resolve();
		assert.strictEqual(parent.querySelector('dialog'), null);
	});

	test('a failed validator explains recovery without replacing the step or discarding its value', async () => {
		let checks = 0;
		const result = wizard.run('Create Entry', 'Project', quick => quick.input({ title: 'Entry Name', validateInput: async () => { if (++checks === 1) { throw new Error('Unexpected validation failure'); } return undefined; } }));
		await page('Entry Name'); fill('Draft name'); button('Next');
		await waitForDOM(() => !!parent.querySelector('.ordito-error-notice'));
		assert.deepStrictEqual({ step: parent.querySelector('h3')?.textContent, draft: parent.querySelector<HTMLInputElement>('input[type="text"]')?.value, labels: [...parent.querySelectorAll('.ordito-error-notice dt')].map(label => label.textContent), nextDisabled: [...parent.querySelectorAll('button')].find(button => button.textContent === 'Next')?.disabled }, { step: 'Entry Name', draft: 'Draft name', labels: ['Cause', 'How to Resolve'], nextDisabled: false });
		const input = parent.querySelector<HTMLInputElement>('input[type="text"]')!;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		assert.strictEqual(parent.querySelector('.ordito-error-notice'), null);
		await next('Review Your Changes'); button('Apply Changes');
		assert.strictEqual(await result, 'Draft name');
	});
});
