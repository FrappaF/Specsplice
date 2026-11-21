import * as dom from '../../../../base/browser/dom.js';
import { DisposableStore, Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ModelView, SemanticModel } from '../common/modelTypes.js';
import { OrditoProjectService } from './orditoProjectService.js';
import { OrditoControls } from './orditoControls.js';
import { DiagramCamera, DiagramBounds, fitDiagramCamera, zoomDiagram } from '../common/diagramCamera.js';
import { notationGroupMembers } from '../common/diagramLayout.js';
import { DiagramBox, DiagramObstacle, DiagramPoint } from '../common/diagramRouting.js';

interface OrditoCanvasControllerHost {
	readonly root: HTMLElement;
	reportError?(error: unknown): void;
}

/** Use the facing side's midpoint as a stable port on a hovered node, regardless of its silhouette. */
function connectionPreviewRoute(source: DiagramBox, target: DiagramBox | undefined, pointer: DiagramPoint, outline?: DiagramObstacle['outline']): DiagramPoint[] | undefined {
	const center = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
	if (source === target) {
		const right = source.x + source.width;
		const bottom = source.y + source.height;
		const gap = 24;
		return [{ x: right, y: center.y }, { x: right + gap, y: center.y }, { x: right + gap, y: bottom + gap }, { x: center.x, y: bottom + gap }, { x: center.x, y: bottom }];
	}
	let tip = pointer;
	if (target) {
		const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
		const dx = center.x - targetCenter.x, dy = center.y - targetCenter.y;
		tip = Math.abs(dx) / target.width >= Math.abs(dy) / target.height
			? { x: dx < 0 ? target.x : target.x + target.width, y: targetCenter.y }
			: { x: targetCenter.x, y: dy < 0 ? target.y : target.y + target.height };
	}
	const dx = tip.x - center.x, dy = tip.y - center.y;
	const normalizedX = Math.abs(dx * 2 / source.width), normalizedY = Math.abs(dy * 2 / source.height);
	const outlineDistance = outline === 'diamond' ? normalizedX + normalizedY : outline === 'ellipse' ? Math.hypot(normalizedX, normalizedY) : Math.max(normalizedX, normalizedY);
	return outlineDistance > 1 ? [{ x: center.x + dx / outlineDistance, y: center.y + dy / outlineDistance }, tip] : undefined;
}

/** Owns camera state and per-render pointer/keyboard listeners for the Specsplice editor. */
export class OrditoCanvasController extends Disposable {
	readonly interactions = this._register(new DisposableStore());

	camera: DiagramCamera = { x: 80, y: 112, zoom: 1 };

	cameraKey: string | undefined;

	readonly cameras = new Map<string, DiagramCamera>();

	worldBounds: DiagramBounds = { x: 0, y: 0, width: 1, height: 1 };

	floatingMenu: HTMLElement | undefined;

	floatingInspector: HTMLElement | undefined;

	zoomReadout: HTMLElement | undefined;

	suppressCanvasClick = false;

	get zoom(): number { return this.camera.zoom; }

	set zoom(value: number) { this.camera = zoomDiagram(this.camera, value, { x: (this.canvasViewport?.clientWidth ?? 800) / 2, y: (this.canvasViewport?.clientHeight ?? 600) / 2 }); }

	canvasViewport: HTMLElement | undefined;

	canvasContent: HTMLElement | undefined;

	private connectionPreview: { listeners: DisposableStore; update: () => void } | undefined;

	private visibleViewport(): { x: number; y: number; width: number; height: number } | undefined {
		if (!this.canvasViewport) { return undefined; }
		const viewport = this.canvasViewport.getBoundingClientRect();
		const menu = this.floatingMenu?.getBoundingClientRect();
		const zoom = this.zoomReadout?.parentElement?.getBoundingClientRect();
		const top = menu ? Math.max(0, menu.bottom - viewport.top + 12) : 0;
		const bottom = zoom ? Math.max(0, viewport.bottom - zoom.top + 12) : 0;
		return { x: 0, y: top, width: this.canvasViewport.clientWidth, height: Math.max(1, this.canvasViewport.clientHeight - top - bottom) };
	}

	fitDiagram(): void {
		const viewport = this.visibleViewport();
		if (!viewport) { return; }
		const padding = Math.min(72, viewport.width / 8, viewport.height / 6);
		this.camera = fitDiagramCamera(this.worldBounds, viewport, padding);
		this.camera.x += viewport.x;
		this.camera.y += viewport.y;
		this.applyCamera();
	}

	applyCamera(): void {
		if (!this.canvasContent || !this.canvasViewport) { return; }
		this.canvasContent.style.transform = `translate(${this.camera.x}px, ${this.camera.y}px) scale(${this.camera.zoom})`;
		this.canvasViewport.style.backgroundPosition = `${this.camera.x}px ${this.camera.y}px`;
		let grid = 24 * this.zoom;
		while (grid < 16) { grid *= 2; }
		while (grid > 48) { grid /= 2; }
		this.canvasViewport.style.backgroundSize = `${grid}px ${grid}px`;
		if (this.zoomReadout) { this.zoomReadout.textContent = `${Math.round(this.zoom * 100)}%`; }
		const menu = this.floatingMenu;
		const inspector = this.floatingInspector;
		if (menu) { menu.style.setProperty('--ordito-canvas-menu-max-height', `${Math.max(48, this.canvasViewport.clientHeight - menu.offsetTop - menu.offsetHeight - 88)}px`); }
		if (menu && inspector) { inspector.style.top = menu.offsetLeft + menu.offsetWidth + inspector.offsetWidth + 24 > this.host.root.clientWidth ? `${menu.offsetTop + menu.offsetHeight + 12}px` : ''; }
		if (this.cameraKey) { this.cameras.set(this.cameraKey, { ...this.camera }); }
		this.connectionPreview?.update();
	}

	/** Update the temporary arrow and its hovered target using the current viewport geometry. */
	installConnectionPreview(viewport: HTMLElement, source: HTMLElement, targets: ReadonlySet<HTMLElement>, outline?: DiagramObstacle['outline']): void {
		const shaft = dom.$.SVG('path', { class: 'ordito-relation-preview' });
		const arrowhead = dom.$.SVG('path');
		const overlay = dom.append(viewport, dom.$.SVG('svg', { class: 'ordito-relation-preview-layer', 'aria-hidden': 'true' }, shaft, arrowhead));
		viewport.classList.add('is-connecting');
		for (const target of targets) {
			target.classList.add('is-connection-candidate');
		}
		let pointer: DiagramPoint | undefined;
		let highlighted: HTMLElement | undefined;
		const highlight = (target: HTMLElement | undefined) => {
			if (target === highlighted) { return; }
			highlighted?.classList.remove('is-connection-target');
			highlighted = target;
			highlighted?.classList.add('is-connection-target');
		};
		const update = () => {
			const bounds = overlay.getBoundingClientRect();
			if (pointer && pointer.x >= bounds.left && pointer.x <= bounds.right && pointer.y >= bounds.top && pointer.y <= bounds.bottom) {
				const hit = viewport.ownerDocument.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLElement>('.ordito-node');
				const target = hit && targets.has(hit) ? hit : undefined;
				highlight(target);
				const sourceBounds = source.getBoundingClientRect();
				const targetBounds = target === source ? sourceBounds : target?.getBoundingClientRect();
				const route = connectionPreviewRoute(sourceBounds, targetBounds, pointer, outline);
				if (route) {
					const tip = route[route.length - 1], previous = route[route.length - 2];
					const dx = tip.x - previous.x, dy = tip.y - previous.y;
					const angle = Math.atan2(dy, dx), length = Math.min(12, Math.hypot(dx, dy) / 2);
					const x = tip.x - bounds.left, y = tip.y - bounds.top;
					shaft.setAttribute('d', route.map((point, index) => `${index ? 'L' : 'M'} ${point.x - bounds.left} ${point.y - bounds.top}`).join(' '));
					arrowhead.setAttribute('d', `M ${x - length * Math.cos(angle - 0.5)} ${y - length * Math.sin(angle - 0.5)} L ${x} ${y} L ${x - length * Math.cos(angle + 0.5)} ${y - length * Math.sin(angle + 0.5)}`);
					return;
				}
			} else {
				highlight(undefined);
			}
			shaft.removeAttribute('d');
			arrowhead.removeAttribute('d');
		};
		const track = (event: PointerEvent) => {
			pointer = event.pointerType === 'touch' ? undefined : { x: event.clientX, y: event.clientY };
			update();
		};
		const reset = () => { pointer = undefined; update(); };
		const listeners = this.interactions.add(new DisposableStore());
		this.connectionPreview = { listeners, update };
		listeners.add(toDisposable(() => {
			highlight(undefined);
			for (const target of targets) {
				target.classList.remove('is-connection-candidate');
			}
			overlay.remove();
			viewport.classList.remove('is-connecting');
			this.connectionPreview = undefined;
		}));
		listeners.add(dom.addDisposableListener(viewport, 'pointerenter', track));
		listeners.add(dom.addDisposableListener(viewport, 'pointermove', track));
		listeners.add(dom.addDisposableListener(viewport, 'pointerleave', reset));
		listeners.add(dom.addDisposableListener(viewport, 'pointercancel', reset));
	}

	clearConnectionPreview(): void {
		if (this.connectionPreview) {
			this.interactions.delete(this.connectionPreview.listeners);
		}
	}

	installPan(parent: HTMLElement): void {
		this.interactions.add(dom.addDisposableListener(parent, 'wheel', (event: WheelEvent) => {
			event.preventDefault();
			if (event.ctrlKey || event.metaKey) {
				const bounds = parent.getBoundingClientRect();
				this.camera = zoomDiagram(this.camera, this.zoom * Math.exp(-event.deltaY * 0.002), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
			} else { this.camera.x -= event.deltaX; this.camera.y -= event.deltaY; }
			this.applyCamera();
		}, { passive: false }));
		this.interactions.add(dom.addDisposableListener(parent, 'keydown', (event: KeyboardEvent) => {
			if (event.target !== parent) { return; }
			const step = event.shiftKey ? 160 : 64;
			const offset = event.key === 'ArrowLeft' ? [step, 0] : event.key === 'ArrowRight' ? [-step, 0] : event.key === 'ArrowUp' ? [0, step] : event.key === 'ArrowDown' ? [0, -step] : undefined;
			if (offset) { event.preventDefault(); event.stopPropagation(); this.camera.x += offset[0]; this.camera.y += offset[1]; this.applyCamera(); }
			else if (event.key === 'Home') { event.preventDefault(); this.fitDiagram(); }
		}));
		let drag: { x: number; y: number; left: number; top: number } | undefined;
		this.interactions.add(dom.addDisposableListener(parent, 'pointerdown', (event: PointerEvent) => {
			this.controls.setExpanded('canvas-actions', false);
			this.suppressCanvasClick = false;
			const target = event.target as Element;
			if (event.button === 1 || event.button === 0 && (event.altKey || !target.closest('button, [role="button"], .ordito-connection-label, [data-relation-id]'))) {
				drag = { x: event.clientX, y: event.clientY, left: this.camera.x, top: this.camera.y };
				parent.setPointerCapture(event.pointerId); parent.focus(); parent.classList.add('is-panning'); event.preventDefault();
			}
		}));
		this.interactions.add(dom.addDisposableListener(parent, 'pointermove', (event: PointerEvent) => {
			if (drag) { this.camera.x = drag.left + event.clientX - drag.x; this.camera.y = drag.top + event.clientY - drag.y; this.applyCamera(); }
		}));
		this.interactions.add(dom.addDisposableListener(parent, 'pointerup', (event: PointerEvent) => {
			if (drag) { this.suppressCanvasClick = Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 3; drag = undefined; parent.classList.remove('is-panning'); }
		}));
		this.interactions.add(dom.addDisposableListener(parent, 'pointercancel', () => { drag = undefined; parent.classList.remove('is-panning'); }));
		this.interactions.add(dom.addDisposableListener(parent, 'click', (event: MouseEvent) => { if (this.suppressCanvasClick && event.detail > 0) { this.suppressCanvasClick = false; event.preventDefault(); event.stopPropagation(); } }, true));
		this.interactions.add(dom.addDisposableListener(parent, 'focusin', (event: FocusEvent) => {
			const target = event.target as HTMLElement;
			if (!target.classList.contains('ordito-node')) { return; }
			const bounds = target.getBoundingClientRect(), parentBounds = parent.getBoundingClientRect();
			const viewport = this.visibleViewport();
			if (!viewport) { return; }
			const left = parentBounds.left + viewport.x, top = parentBounds.top + viewport.y;
			if (bounds.right < left + 24 || bounds.left > left + viewport.width - 24 || bounds.bottom < top + 24 || bounds.top > top + viewport.height - 24) {
				this.camera.x += left + viewport.width / 2 - (bounds.left + bounds.width / 2);
				this.camera.y += top + viewport.height / 2 - (bounds.top + bounds.height / 2); this.applyCamera();
			}
		}));
	}

	installNodeEditing(button: HTMLButtonElement, view: ModelView, id: string, model: SemanticModel, isBoundary: boolean): void {
		const members = isBoundary ? notationGroupMembers(model, view, id) : new Set([id]);
		const move = (dx: number, dy: number) => {
			try { this.project.editBatch(view.nodes.filter(node => members.has(node.elementId)).map(node => ({ kind: 'position', viewId: view.id, id: node.elementId, x: Math.round(node.x + dx), y: Math.round(node.y + dy) }))); }
			catch (error) { if (this.host.reportError) { this.host.reportError(error); } else { throw error; } }
		};
		let drag: { x: number; y: number; left: number; top: number } | undefined;
		this.interactions.add(dom.addDisposableListener(button, 'pointerdown', (event: PointerEvent) => {
			if (event.button !== 0 || event.altKey) { return; }
			drag = { x: event.clientX, y: event.clientY, left: parseFloat(button.style.left), top: parseFloat(button.style.top) };
			button.setPointerCapture(event.pointerId);
		}));
		this.interactions.add(dom.addDisposableListener(button, 'pointermove', (event: PointerEvent) => {
			if (!drag) { return; }
			button.style.left = `${drag.left + (event.clientX - drag.x) / this.zoom}px`;
			button.style.top = `${drag.top + (event.clientY - drag.y) / this.zoom}px`;
		}));
		this.interactions.add(dom.addDisposableListener(button, 'pointerup', (event: PointerEvent) => {
			if (!drag) { return; }
			const dx = (event.clientX - drag.x) / this.zoom;
			const dy = (event.clientY - drag.y) / this.zoom;
			drag = undefined;
			if (Math.abs(dx) + Math.abs(dy) > 3) {
				move(dx, dy);
				this.project.selectElement(id);
			}
		}));
		this.interactions.add(dom.addDisposableListener(button, 'pointercancel', () => {
			if (drag) { button.style.left = `${drag.left}px`; button.style.top = `${drag.top}px`; drag = undefined; }
		}));
		this.interactions.add(dom.addDisposableListener(button, 'keydown', (event: KeyboardEvent) => {
			const step = event.shiftKey ? 40 : 20;
			const offset = event.key === 'ArrowLeft' ? [-step, 0] : event.key === 'ArrowRight' ? [step, 0] : event.key === 'ArrowUp' ? [0, -step] : event.key === 'ArrowDown' ? [0, step] : undefined;
			if (offset) {
				event.preventDefault();
				event.stopPropagation();
				move(offset[0], offset[1]);
			}
		}));
	}

	constructor(
		private readonly host: OrditoCanvasControllerHost,
		private readonly controls: OrditoControls,
		private readonly project: OrditoProjectService,
		storageService: IStorageService
	) {
		super();
		try {
			const saved: Record<string, DiagramCamera> = JSON.parse(storageService.get('ordito.canvas.cameras', StorageScope.WORKSPACE) ?? '{}');
			for (const [key, camera] of Object.entries(saved).slice(-100)) { if (camera && [camera.x, camera.y, camera.zoom].every(Number.isFinite) && camera.zoom >= 0.05 && camera.zoom <= 3) { this.cameras.set(key, camera); } }
		} catch { /* Ignore obsolete viewport state. */ }
		this._register(storageService.onWillSaveState(() => storageService.store('ordito.canvas.cameras', JSON.stringify(Object.fromEntries([...this.cameras].slice(-100))), StorageScope.WORKSPACE, StorageTarget.MACHINE)));
	}
}
