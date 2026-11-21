import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { type ThemeIcon } from '../../../../../base/common/themables.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { OrditoBlueprintEditor } from '../../browser/orditoBlueprintEditor.js';
import { OrditoCanvasController } from '../../browser/orditoCanvasController.js';
import { OrditoCanvasSurface } from '../../browser/orditoCanvasSurface.js';
import { OrditoControls } from '../../browser/orditoControls.js';
import { OrditoProjectService } from '../../browser/orditoProjectService.js';
import { applyVisualEdit } from '../../common/visualEditing.js';
import { type VisualEdit } from '../../common/visualEditTypes.js';
import { blueprintFixture } from '../common/blueprintFixture.js';

suite('Specsplice blueprint diagram controls', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	setup(() => { root = dom.append(document.body, dom.$('section')); });
	teardown(() => root.remove());

	function button(label: string): HTMLButtonElement {
		const button = [...root.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent) === label);
		assert.ok(button, `Missing button: ${label}`);
		return button;
	}

	function field(label: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
		const wrapper = [...root.querySelectorAll('label')].find(labelElement => labelElement.firstElementChild?.textContent === label);
		const field = wrapper?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea');
		assert.ok(field, `Missing field: ${label}`);
		return field;
	}

	function setField(label: string, value: string): void {
		const input = field(label);
		input.value = value;
		input.dispatchEvent(new Event('change', { bubbles: true }));
	}

	function fixture() {
		const model = structuredClone(blueprintFixture);
		const project = Object.assign(new (mock<OrditoProjectService>())(), { model, activeView: model.views[2], selectedId: 'component.checkout', section: 'diagram', editable: true });
		const controls = store.add(new OrditoControls());
		const canvas = store.add(new OrditoCanvasController({ root }, controls, project, store.add(new InMemoryStorageService())));
		const commands: { command: string; args: (string | undefined)[] }[] = [];
		const commandService = Object.assign(new (mock<ICommandService>())(), { executeCommand: async (command: string, ...args: (string | undefined)[]) => { commands.push({ command, args }); } });
		const host = Object.assign(new (mock<ConstructorParameters<typeof OrditoCanvasSurface>[0]>())(), {
			root,
			button: (parent: HTMLElement, label: string, action: () => void, id?: string) => controls.button(parent, label, action, id),
			iconButton: (parent: HTMLElement, label: string, _icon: ThemeIcon, action: () => void, id?: string) => controls.button(parent, label, action, id),
			paragraph: (parent: HTMLElement, text: string) => { dom.append(parent, dom.$('p')).textContent = text; }
		});
		const surface = new OrditoCanvasSurface(host, canvas, controls, project, commandService, new (mock<IQuickInputService>())(), new (mock<IContextMenuService>())(), new (mock<INotificationService>())());
		return { surface, project, commands };
	}

	function editorFixture() {
		const { project } = fixture();
		const batches: (readonly VisualEdit[])[] = [];
		const opened: string[] = [];
		Object.assign(project, {
			documentVersion: 'model:0',
			editBatch: (edits: readonly VisualEdit[]) => {
				batches.push(edits);
				const model = edits.reduce((current, edit) => applyVisualEdit(current, edit) as typeof current, project.model);
				Object.assign(project, { model, activeView: model.views.find(view => view.id === project.activeView?.id), documentVersion: `model:${batches.length}` });
			},
			showDiagram: (id: string) => opened.push(id)
		});
		const editor = store.add(new OrditoBlueprintEditor(project));
		return { project, editor, batches, opened };
	}

	for (const presentation of ['canvas', 'toolbar'] as const) {
		test(`${presentation} exposes visibility and dependency editing for the current blueprint`, () => {
			const { surface, project, commands } = fixture();
			if (presentation === 'canvas') { surface.renderCanvasMenus(root, project.activeView!); } else { surface.renderEditingToolbar(root); }
			const buttons = [...root.querySelectorAll('button')].filter(button => ['Edit Visible Elements', 'Edit Context Dependencies'].includes(button.getAttribute('aria-label') ?? button.textContent!));
			for (const button of buttons) { button.click(); }
			assert.deepStrictEqual(commands, [{ command: 'ordito.blueprint', args: [undefined, 'c4Visibility'] }, { command: 'ordito.blueprint', args: [undefined, 'c4Dependencies'] }]);
		});
	}

	test('readonly blueprints and diagrams without a subject omit blueprint editing actions', () => {
		const { surface, project } = fixture();
		Object.assign(project, { editable: false }); surface.renderCanvasMenus(root, project.activeView!);
		Object.assign(project, { editable: true, activeView: { ...project.activeView!, subjectId: undefined } }); surface.renderEditingToolbar(root);
		assert.ok(!root.textContent?.includes('Edit Visible Elements') && !root.textContent?.includes('Edit Context Dependencies'));
	});

	test('applying a new C4 view keeps the blueprint editor open', () => {
		const { editor, project, batches, opened } = editorFixture();
		editor.open(undefined, 'c4');
		editor.render(root);
		button('New C4 View').click();
		setField('View Name', 'New Blueprint');
		setField('C4 Level', 'c4Component');
		setField('View Subject', 'container.api');
		assert.strictEqual(batches.length, 0);
		assert.ok(!root.querySelector('dialog'));
		button('Apply to Model').click();
		assert.deepStrictEqual(batches.map(batch => batch.length), [1]);
		assert.strictEqual(project.model.views.find(view => view.name === 'New Blueprint')?.subjectId, 'container.api');
		assert.deepStrictEqual(opened, []);
		assert.ok(button('New C4 View').isConnected);
		button('Open Diagram').click();
		assert.strictEqual(opened.at(0), project.model.views.find(view => view.name === 'New Blueprint')?.id);
	});

	test('a shared operation can use a type from the same draft and remain selected across applications', () => {
		const { editor, project, batches } = editorFixture();
		editor.open(undefined, 'operations');
		editor.render(root);
		button('New Shared Operation').click();
		setField('Operation Name', 'getTrackingCode');
		setField('Operation Owner', 'contract.checkout');
		button('Add Input').click();
		setField('Name', 'code');

		button('Shared Types').click();
		button('New Shared Type').click();
		setField('Type Name', 'Tracking Code');
		setField('Type Kind', 'primitive');
		setField('Primitive Defined by the Profile', 'string');
		button('Shared Operations').click();
		assert.strictEqual(field('Operation Name').value, 'getTrackingCode');
		const type = Array.from((field('Type') as HTMLSelectElement).options).find(option => option.textContent?.includes('Tracking Code'));
		assert.ok(type);
		setField('Type', type.value);
		assert.strictEqual(batches.length, 0);

		button('Review').click();
		assert.ok(root.querySelector('.ordito-blueprint-review')?.textContent?.includes('Tracking Code'));
		button('Apply to Model').click();
		assert.deepStrictEqual(batches.map(batch => batch.map(edit => edit.kind)), [['type', 'blueprint']]);
		assert.ok(project.model.version === 4 || project.model.version === 5);
		const operation = project.model.foundation.blueprint?.operations.find(operation => operation.name === 'getTrackingCode');
		assert.ok(operation);
		assert.strictEqual(operation.inputs[0]?.typeId, type.value);
		assert.strictEqual(field('Operation Name').value, operation.name);

		setField('Operation Name', 'readTrackingCode');
		button('Access and Acceptance').click();
		button('Add Criterion').click();
		setField('Given', 'A tracking code exists');
		button('Behavior Rules').click();
		assert.strictEqual(button('Apply to Model').getAttribute('aria-disabled'), 'true');
		button('Access and Acceptance').click();
		setField('When', 'The customer looks up the delivery');
		setField('Then', 'The current status is shown');
		button('Apply to Model').click();
		assert.strictEqual(batches.length, 2);
		const updated = project.model.foundation.blueprint?.operations.find(entry => entry.id === operation.id);
		assert.strictEqual(updated?.name, 'readTrackingCode');
		assert.strictEqual(updated?.acceptanceCriteria[0]?.then, 'The current status is shown');
		assert.strictEqual(button('Access and Acceptance').getAttribute('aria-selected'), 'true');
	});

	test('an external model revision preserves the draft and allows a fresh edit after discarding it', () => {
		const { editor, project, batches } = editorFixture();
		editor.open(undefined, 'types');
		editor.render(root);
		button('New Shared Type').click();
		setField('Type Name', 'Draft Before External Change');

		Object.assign(project, { model: { ...project.model, name: 'External Revision' }, documentVersion: 'model:external' });
		editor.render(root);
		assert.strictEqual(field('Type Name').value, 'Draft Before External Change');
		assert.strictEqual(button('Apply to Model').getAttribute('aria-disabled'), 'true');
		button('Apply to Model').click();
		assert.strictEqual(batches.length, 0);

		button('Discard Draft').click();
		assert.strictEqual(project.model.name, 'External Revision');
		assert.strictEqual(button('Apply to Model').getAttribute('aria-disabled'), 'true');
		button('New Shared Type').click();
		setField('Type Name', 'New Type on Current Revision');
		button('Apply to Model').click();
		assert.strictEqual(batches.length, 1);
		assert.ok(project.model.version === 4 || project.model.version === 5);
		assert.ok(project.model.foundation.types.some(type => type.name === 'New Type on Current Revision'));
		assert.ok(!project.model.foundation.types.some(type => type.name === 'Draft Before External Change'));
	});

	for (const [mode, target, initialState] of [['c4Visibility', 'Audit · Visible', true], ['c4Dependencies', 'Payments · Context', false]] as const) {
		test(`${mode} opens the active C4 view and keeps changes in the editor until applied`, () => {
			const { editor, batches } = editorFixture();
			editor.open(undefined, mode);
			editor.render(root);
			const control = root.querySelector<HTMLInputElement>(`input[aria-label="${target}"]`);
			assert.ok(control);
			assert.strictEqual(control.checked, initialState);
			control.click();
			assert.strictEqual(batches.length, 0);
			button('Apply to Model').click();
			const edit = batches.at(0)?.at(0);
			assert.strictEqual(edit?.kind, 'c4View');
			assert.strictEqual(edit.view.id, 'c4.l3');
			assert.strictEqual(root.querySelector<HTMLInputElement>(`input[aria-label="${target}"]`)?.checked, !initialState);
		});
	}
});
