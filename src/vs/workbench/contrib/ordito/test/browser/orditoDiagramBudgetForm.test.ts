import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OrditoDiagramBudgetForm } from '../../browser/orditoDiagramBudgetForm.js';
import { projectDiagramBudgetPresets } from '../../common/diagramExplorationBudget.js';

suite('Specsplice. diagram budget form', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let parent: HTMLElement;
	setup(() => { parent = document.body.appendChild(document.createElement('div')); });
	teardown(() => parent.remove());

	function editField(field: HTMLInputElement, value: string): void {
		field.value = value;
		field.dispatchEvent(new Event('input', { bubbles: true }));
	}

	function selectPreset(select: HTMLSelectElement, value: string): void {
		select.value = value;
		select.dispatchEvent(new Event('change', { bubbles: true }));
	}

	test('shows the configured preset and saves explicit custom limits after validation', async () => {
		const form = store.add(new OrditoDiagramBudgetForm(parent, { mode: 'default', budget: projectDiagramBudgetPresets.standard }));
		const result = form.edit();
		const preset = form.body.querySelector('select')!;
		const fields = [...form.body.querySelectorAll('input')];
		const values = () => fields.map(field => field.value);
		assert.deepStrictEqual([preset.value, values()], ['standard', ['800', '16384', '180', '64']]);
		selectPreset(preset, 'large');
		assert.deepStrictEqual(values(), ['1000', '32768', '360', '100']);
		editField(fields[0], '1e2');
		form.body.requestSubmit();
		assert.deepStrictEqual([preset.value, fields[0].getAttribute('aria-invalid'), document.activeElement === fields[0]], ['custom', 'true', true]);
		selectPreset(preset, 'compact');
		assert.deepStrictEqual([preset.value, values(), fields[0].getAttribute('aria-invalid')], ['compact', ['400', '8192', '90', '32'], null]);
		editField(fields[2], '125');
		form.body.requestSubmit();
		assert.deepStrictEqual(await result, { maxToolCalls: 400, maxReadBytes: 8 * 1024 * 1024, maxDurationMs: 125 * 60_000, maxModelTurns: 32 });
	});

	test('clamps extension presets to whole available units and requires a positive increase', async () => {
		const form = store.add(new OrditoDiagramBudgetForm(parent, { mode: 'extension', capacity: { maxToolCalls: 5, maxReadBytes: 2500, maxDurationMs: 59_999, maxModelTurns: 2 } }));
		const result = form.edit();
		const preset = form.body.querySelector('select')!;
		const fields = [...form.body.querySelectorAll('input')];
		const values = () => fields.map(field => field.value);
		assert.deepStrictEqual([preset.value, values()], ['small', ['5', '2', '0', '2']]);
		selectPreset(preset, 'large');
		assert.deepStrictEqual(values(), ['5', '2', '0', '2']);
		for (const field of fields) { editField(field, '0'); }
		form.body.requestSubmit();
		assert.match(parent.querySelector('.ordito-error-notice')?.textContent ?? '', /Increase at least one limit/);
		editField(fields[1], '3');
		form.body.requestSubmit();
		assert.equal(fields[1].getAttribute('aria-invalid'), 'true');
		editField(fields[1], '2');
		form.body.requestSubmit();
		assert.deepStrictEqual(await result, { maxToolCalls: 0, maxReadBytes: 2048, maxDurationMs: 0, maxModelTurns: 0 });
	});
});
