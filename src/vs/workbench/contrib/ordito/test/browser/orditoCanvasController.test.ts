import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { OrditoCanvasController } from '../../browser/orditoCanvasController.js';
import { OrditoControls } from '../../browser/orditoControls.js';
import { OrditoProjectService } from '../../browser/orditoProjectService.js';
import { checkoutModel } from '../../common/checkoutModel.js';
import { type VisualEdit } from '../../common/visualEditTypes.js';

suite('Specsplice canvas controller', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	setup(() => { root = dom.append(document.body, dom.$('section')); });
	teardown(() => root.remove());

	function fixture(failure?: Error) {
		const model = structuredClone(checkoutModel), edits: VisualEdit[] = [];
		const errors: unknown[] = [];
		const project = new class extends mock<OrditoProjectService>() {
			override get model() { return model; }
			override editBatch(batch: VisualEdit[]): void { if (failure) { throw failure; } edits.push(...batch); }
			override selectElement(): void { }
		};
		const controls = disposables.add(new OrditoControls());
		const storage = disposables.add(new InMemoryStorageService());
		const canvas = disposables.add(new OrditoCanvasController({ root, reportError: error => errors.push(error) }, controls, project, storage));
		canvas.canvasViewport = root;
		canvas.canvasContent = dom.append(root, dom.$('div'));
		return { canvas, model, edits, errors };
	}

	test('pan listeners follow the current render and clearing them stops old DOM from changing the camera', () => {
		const { canvas } = fixture();
		canvas.installPan(root);
		root.dispatchEvent(new WheelEvent('wheel', { deltaX: 20, deltaY: 30, cancelable: true }));
		root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
		root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, cancelable: true }));
		assert.deepStrictEqual(canvas.camera, { x: -4, y: -78, zoom: 1 });
		assert.strictEqual(canvas.canvasContent!.style.transform, 'translate(-4px, -78px) scale(1)');
		canvas.interactions.clear();
		root.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
		assert.deepStrictEqual(canvas.camera, { x: -4, y: -78, zoom: 1 });
		canvas.installPan(root);
		root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
		assert.strictEqual(canvas.camera.x, 60);
	});

	test('keyboard node movement submits one atomic layout edit and leaves the model snapshot unchanged', () => {
		const { canvas, model, edits } = fixture(), before = structuredClone(model);
		const view = model.views[0], node = view.nodes[0];
		const button = dom.append(root, dom.$<HTMLButtonElement>('button'));
		canvas.installNodeEditing(button, view, node.elementId, model, false);
		button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
		assert.deepStrictEqual({ edits, model }, {
			edits: [{ kind: 'position', viewId: view.id, id: node.elementId, x: node.x + 40, y: node.y }],
			model: before
		});
	});

	test('failed keyboard movement reports the error without changing the model or keyboard focus', () => {
		const failure = new Error('The project changed');
		const { canvas, model, edits, errors } = fixture(failure), before = structuredClone(model);
		const view = model.views[0], node = view.nodes[0];
		const button = dom.append(root, dom.$<HTMLButtonElement>('button')); button.focus();
		canvas.installNodeEditing(button, view, node.elementId, model, false);
		const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
		button.dispatchEvent(event);
		assert.deepStrictEqual({ errors, edits, model, focused: document.activeElement === button, prevented: event.defaultPrevented }, { errors: [failure], edits: [], model: before, focused: true, prevented: true });
	});

	test('a failed drag commit reaches the host error handler and leaves the project model intact', () => {
		const failure = new Error('The selected element no longer exists');
		const { canvas, model, edits, errors } = fixture(failure), before = structuredClone(model);
		const view = model.views[0], node = view.nodes[0];
		const button = dom.append(root, dom.$<HTMLButtonElement>('button'));
		button.style.left = `${node.x}px`; button.style.top = `${node.y}px`;
		// Synthetic pointer events have no native pointer to capture.
		button.setPointerCapture = () => {};
		canvas.installNodeEditing(button, view, node.elementId, model, false);
		button.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 20 }));
		button.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 50, clientY: 60 }));
		button.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 50, clientY: 60 }));
		assert.deepStrictEqual({ errors, edits, model }, { errors: [failure], edits: [], model: before });
	});
});
