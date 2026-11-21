import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OrditoControls } from '../../browser/orditoControls.js';
import { renderOrditoInteractionSequence } from '../../browser/orditoInteractionSequence.js';
import { orditoInteractionRows } from '../../browser/orditoInteractionContent.js';
import { interactionFixture } from '../common/interactionFixture.js';
import '../../browser/media/ordito.css';
import { renderOrditoSequence } from '../../browser/orditoSequence.js';
import { renderOrditoDescriptiveActivity } from '../../browser/orditoDescriptiveActivity.js';

suite('Specsplice sequence renderer', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite(); let root: HTMLElement;
	setup(() => { root = dom.append(dom.append(dom.append(document.body, dom.$('section.ordito-shell')), dom.$('div.ordito-canvas')), dom.$('div.ordito-canvas-content.ordito-sequence')); }); teardown(() => root.closest('.ordito-shell')!.remove());
	test('nested frames and operands render in semantic order with measured, focusable labels', () => {
		const model = structuredClone(interactionFixture), before = structuredClone(model), controls = disposables.add(new OrditoControls());
		const size = renderOrditoInteractionSequence(root, model, 'interaction.checkout', controls, () => {}), buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-interaction-step-id]')];
		assert.deepStrictEqual(buttons.map(button => button.dataset.interactionStepId), orditoInteractionRows(model, 'interaction.checkout').map(row => row.id));
		assert.strictEqual(root.querySelectorAll('rect[data-frame-id]').length, 3); assert.ok(size.width >= 720 && size.height > 200);
		buttons[2].focus(); assert.strictEqual(document.activeElement, buttons[2]); assert.deepStrictEqual(model, before);
		for (let index = 1; index < buttons.length; index++) { assert.ok(buttons[index].offsetTop >= buttons[index - 1].offsetTop + buttons[index - 1].offsetHeight); }
	});
	test('hostile labels remain text; accessible and visible rows describe the same policies', () => {
		const model = structuredClone(interactionFixture); model.foundation.blueprint!.operations.find(operation => operation.id === 'charge')!.name = '<img src=x onerror=alert(1)>';
		renderOrditoInteractionSequence(root, model, 'interaction.checkout', disposables.add(new OrditoControls()), () => {});
		assert.strictEqual(root.querySelector('img'), null); for (const row of orditoInteractionRows(model, 'interaction.checkout')) { assert.ok(root.textContent?.includes(row.label)); assert.ok([...root.querySelectorAll('[data-interaction-step-id]')].some(label => label.getAttribute('aria-label') === row.text)); }
	});

	test('imported scenarios show aligned lifelines, concise messages and separate alternative operands without changing the model', () => {
		const model = structuredClone(interactionFixture);
		model.semantics.elements = [{ id: 'user', kind: 'actor', name: 'Todo user' }, { id: 'controller', kind: 'component', name: 'TodosController' }, { id: 'todo', kind: 'component', name: 'Todo model' }];
		model.foundation.occurrences = [
			{ id: 'submit', profile: 'descriptive', name: 'Submit new Todo form', from: 'user', to: 'controller' },
			{ id: 'build', profile: 'descriptive', name: 'Build Todo from permitted parameters', from: 'controller', to: 'todo' },
			{ id: 'save', profile: 'descriptive', name: 'Save Todo', from: 'controller', to: 'todo' },
			{ id: 'success', profile: 'descriptive', name: 'Redirect to Todo list', from: 'controller', to: 'user' },
			{ id: 'failure', profile: 'descriptive', name: 'Render index with unprocessable-entity status', from: 'controller', to: 'user' }
		];
		model.foundation.frames = [{ id: 'outcome', kind: 'unspecified', occurrenceIds: ['success', 'failure'], description: { operator: 'alt', operands: [{ id: 'saved', condition: { state: 'known', value: 'Todo save succeeds' }, steps: ['success'], evidenceIds: [] }, { id: 'invalid', condition: { state: 'known', value: 'Todo save fails validation' }, steps: ['failure'], evidenceIds: [] }] } }];
		model.foundation.interactions = [{ id: 'create-todo', profile: 'descriptive', occurrenceIds: model.foundation.occurrences.map(call => call.id), frameIds: ['outcome'], description: { trigger: 'Create Todo', scope: 'Todo creation', participantIds: ['user', 'controller', 'todo'], evidenceIds: [], order: [['submit', 'build'], ['build', 'save'], ['save', 'success'], ['save', 'failure']].map(([before, after]) => ({ before, after, evidenceIds: [], basis: 'authored' as const })) } }];
		const before = structuredClone(model), selected: string[] = [];
		const view = { id: 'create-sequence', name: 'Create Todo', kind: 'sequence' as const, interactionId: 'create-todo', nodes: [], relationIds: [] };
		const size = renderOrditoSequence(root, model, view, disposables.add(new OrditoControls()), '', id => selected.push(id));
		const headers = [...root.querySelectorAll<HTMLButtonElement>('.ordito-sequence-participant')];
		const lines = [...root.querySelectorAll<SVGPathElement>('.ordito-sequence-lifeline')];
		assert.deepStrictEqual({ participants: headers.map(header => header.textContent), lifelines: lines.map(line => line.dataset.elementId), messages: root.querySelectorAll('[data-occurrence-id]').length, separators: root.querySelectorAll('.ordito-sequence-operand-separator').length, operator: root.querySelector('.ordito-sequence-frame-label')?.textContent, guards: [...root.querySelectorAll('.ordito-sequence-operand')].map(label => label.textContent) }, { participants: ['Todo user', 'TodosController', 'Todo model'], lifelines: ['todo', 'controller', 'user'], messages: 5, separators: 1, operator: 'alt', guards: ['[Todo save succeeds]', '[Todo save fails validation]'] });
		for (const line of lines) {
			const header = headers.find(header => header.dataset.elementId === line.dataset.elementId)!;
			const [x, start, end] = line.getAttribute('d')!.match(/\d+/g)!.map(Number);
			assert.deepStrictEqual([x, start, end, dom.getWindow(line).getComputedStyle(line).strokeDasharray], [header.offsetLeft + header.offsetWidth / 2, header.offsetTop + header.offsetHeight, size.height - 16, '4px, 4px']);
		}
		const messages = [...root.querySelectorAll<HTMLButtonElement>('[data-sequence-kind="message"]')];
		assert.deepStrictEqual(messages.map(message => message.textContent), model.foundation.occurrences.map(call => call.name));
		const frame = root.querySelector<SVGRectElement>('[data-frame-id="outcome"]')!.getBBox();
		for (const arrow of root.querySelectorAll<SVGPathElement>('[data-occurrence-id="success"], [data-occurrence-id="failure"]')) { assert.ok(arrow.getBBox().y + arrow.getBBox().height < frame.y + frame.height, 'the alternative frame encloses its message arrows'); }
		messages[1].focus(); messages[1].click();
		assert.deepStrictEqual([document.activeElement === messages[1], selected, model], [true, ['build'], before]);

		dom.clearNode(root);
		const activity = disposables.add(new OrditoControls());
		renderOrditoDescriptiveActivity(root, model, view.interactionId, activity, id => selected.push(id), 'save');
		for (const selector of ['button[data-occurrence-id="save"]', 'button.ordito-sequence-frame-label', 'button.ordito-sequence-operand']) {
			const button = root.querySelector<HTMLButtonElement>(selector)!;
			button.focus(); button.click();
		}
		assert.deepStrictEqual([selected, root.querySelector('[data-occurrence-id="save"]')?.getAttribute('aria-pressed'), model], [['build', 'save', 'outcome', 'saved'], 'true', before]);
	});
});
