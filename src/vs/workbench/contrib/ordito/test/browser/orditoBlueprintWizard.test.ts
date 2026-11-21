import assert from 'assert';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OrditoBlueprintWizard } from '../../browser/orditoBlueprintWizard.js';
import { applyVisualEdit } from '../../common/visualEditing.js';
import { type SemanticModelV4 } from '../../common/modelTypes.js';
import { blueprintFixture } from '../common/blueprintFixture.js';

suite('Specsplice blueprint wizard', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let parent: HTMLElement;
	let model: SemanticModelV4;
	let wizard: OrditoBlueprintWizard;
	setup(() => {
		parent = document.body.appendChild(document.createElement('div'));
		model = structuredClone(blueprintFixture);
		wizard = store.add(new OrditoBlueprintWizard(parent));
	});
	teardown(() => { wizard.dispose(); parent.remove(); });

	const button = (label: string) => {
		const element = [...parent.querySelectorAll('button')].find(button => button.textContent === label || button.querySelector('strong')?.textContent === label || button.getAttribute('aria-label') === label);
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

	test('creates a type only after review, with inline validation and detached edits', async () => {
		const before = structuredClone(model);
		const result = wizard.open(model, 'component.checkout');
		button('Shared Types');
		await page('Shared Types');
		await next('Type Name');
		button('Next'); await waitForDOM(() => parent.querySelector('.ordito-error-notice dd')?.textContent === 'Enter a value.');
		assert.strictEqual(parent.querySelector('.ordito-error-notice dd')?.textContent, 'Enter a value.');
		fill('Delivery State'); await next('Type Kind');
		select('Enumeration'); await next('Values (Separated by Semicolons)');
		fill('pending; shipped'); await next('Review Your Blueprint Changes');
		assert.deepStrictEqual(model, before);
		assert.ok(parent.querySelector('dl')?.textContent?.includes('Delivery State'));
		button('Edit Type Name'); await page('Type Name');
		fill('Delivery Status'); await next('Review Your Blueprint Changes');
		button('Apply Changes');
		const edits = await result;
		assert.ok(edits?.length);
		const updated = edits.reduce((model, edit) => applyVisualEdit(model, edit) as SemanticModelV4, model);
		assert.deepStrictEqual([updated.foundation.types.at(-1)?.name, updated.foundation.types.at(-1)?.values], ['Delivery Status', ['pending', 'shipped']]);
		assert.deepStrictEqual(model, before);
		assert.strictEqual(parent.querySelector('dialog'), null);
	});

	test('Back preserves drafts and changing a previous choice discards dependent answers', async () => {
		const result = wizard.open(model, '', undefined, 'types');
		await page('Shared Types'); await next('Type Name');
		fill('Shipment State'); await next('Type Kind');
		select('Enumeration'); await next('Values (Separated by Semicolons)');
		fill('queued; shipped'); button('Back'); await page('Type Kind');
		assert.strictEqual(parent.querySelector<HTMLInputElement>('input:checked')?.closest('label')?.textContent, 'Enumeration');
		await next('Values (Separated by Semicolons)');
		assert.strictEqual(parent.querySelector<HTMLInputElement>('input[type="text"]')?.value, 'queued; shipped');
		await next('Review Your Blueprint Changes');
		button('Edit Type Kind'); await page('Type Kind');
		select('Primitive'); await next('Primitive Defined by the Selected Profile');
		assert.strictEqual(parent.querySelector<HTMLInputElement>('input[type="text"]')?.value, '');
		fill('string'); await next('Review Your Blueprint Changes');
		button('Apply Changes');
		const edits = await result; const edit = edits?.[0];
		assert.ok(edit?.kind === 'type');
		assert.deepStrictEqual({ name: edit.entry.name, kind: edit.entry.kind, primitive: edit.entry.primitive, values: edit.entry.values }, { name: 'Shipment State', kind: 'primitive', primitive: 'string', values: undefined });
	});

	for (const stage of ['choose', 'configure', 'review']) {
		test(`canceling at ${stage} leaves the model unchanged and restores focus`, async () => {
			const origin = document.body.appendChild(document.createElement('button')); origin.focus();
			wizard.dispose(); wizard = store.add(new OrditoBlueprintWizard(parent));
			const before = structuredClone(model);
			try {
				const result = wizard.open(model, '', undefined, stage === 'choose' ? undefined : 'types');
				if (stage !== 'choose') { await page('Shared Types'); }
				if (stage === 'review') {
					await next('Type Name'); fill('Draft Type'); await next('Type Kind');
					select('Record'); await next('Review Your Blueprint Changes');
				}
				if (stage === 'configure') { parent.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true })); }
				else { button('Cancel'); }
				assert.strictEqual(await result, undefined);
				assert.deepStrictEqual(model, before);
				assert.strictEqual(document.activeElement, origin);
			} finally { origin.remove(); }
		});
	}

	test('an empty required list blocks Next and lets the user return to the activity chooser', async () => {
		model.foundation.blueprint!.ports = [];
		const result = wizard.open(model, '', undefined, 'connections');
		await page('Required Interface Consumer');
		assert.strictEqual([...parent.querySelectorAll('button')].find(button => button.textContent === 'Next')?.disabled, true);
		assert.ok(parent.textContent?.includes('No compatible items are available.'));
		button('Back'); await page('What Would You Like to Define?');
		button('Cancel'); assert.strictEqual(await result, undefined);
	});

	test('multiple selections retain their defaults and can explicitly remove a membership', async () => {
		model.semantics.elements.push({ id: 'feature.delivery', kind: 'feature', name: 'Delivery' });
		model.foundation.memberships.push({ id: 'membership.delivery', elementId: 'component.checkout', featureId: 'feature.delivery' });
		const result = wizard.open(model, 'component.checkout', undefined, 'membership');
		await page('Feature Memberships');
		const checkbox = [...parent.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(input => input.closest('label')?.textContent === 'Delivery');
		assert.ok(checkbox?.checked); checkbox.click();
		await next('Review Your Blueprint Changes');
		button('Edit Feature Memberships'); await page('Feature Memberships');
		assert.strictEqual([...parent.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(input => input.closest('label')?.textContent === 'Delivery')?.checked, false);
		await next('Review Your Blueprint Changes'); button('Apply Changes');
		assert.ok((await result)?.some(edit => edit.kind === 'membership' && edit.entry.id === 'membership.delivery' && !edit.included));
	});

	test('the sidebar entry flow asks for a target instead of silently changing the canvas selection', async () => {
		const result = wizard.open(model, 'component.checkout');
		button('System Scope or Container Responsibility');
		await page('Element'); select('Shop'); await next('System Scope or Container Responsibility');
		select('External System'); await next('Review Your Blueprint Changes');
		button('Apply Changes');
		assert.deepStrictEqual(await result, [{ kind: 'elementScope', id: 'system.shop', scope: 'external' }]);
	});
});
