import { isThenable } from '../../../../base/common/async.js';
import * as dom from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';

interface OrditoTabGroup {
	readonly panels: ReadonlyMap<string, HTMLElement>;
	readonly activeId: string;
	select(id: string, focus?: boolean): void;
}

/** Native actions with stable focus identities across presentation updates. */
export class OrditoControls extends Disposable {
	constructor(private readonly onError?: (error: unknown) => void) { super(); }

	private static readonly owners = new WeakMap<Element, OrditoControls>();

	/** Resolve the original control after the assistant refreshes its underlying page. */
	static captureActiveFocus(): () => void {
		const active = dom.getActiveElement();
		const owner = active ? OrditoControls.owners.get(active) : undefined;
		const root = active?.closest<HTMLElement>('.ordito-shell, .ordito-sidebar');
		if (owner && root) { return owner.captureFocus(root); }
		return () => { if (dom.isHTMLElement(active) && active.isConnected) { active.focus(); } };
	}

	private readonly listeners = this._register(new DisposableStore());
	private readonly targets = new Map<string, HTMLElement | SVGElement>();
	private readonly disclosures = new Map<string, HTMLDetailsElement>();
	private readonly expanded = new Map<string, boolean>();
	private readonly tabSelections = new Map<string, string>();
	private readonly tabGroups = new Map<string, OrditoTabGroup>();
	private deferredFocus: string | undefined;

	trackFocus(id: string, element: HTMLElement | SVGElement): void {
		this.targets.set(id, element);
		OrditoControls.owners.set(element, this);
	}

	focusTarget(id: string): boolean {
		const target = this.targets.get(id);
		if (!target?.isConnected) { return false; }
		target.focus();
		return true;
	}

	setExpanded(id: string, open: boolean): void {
		this.expanded.set(id, open);
		const details = this.disclosures.get(id);
		if (details) { details.open = open; }
	}

	/** Resolve the control again on close: project updates may have replaced its DOM node. */
	captureFocus(root: HTMLElement): () => void {
		const active = dom.getActiveElement();
		const id = [...this.targets].find(([, element]) => element === active)?.[0];
		return () => {
			if (root.isConnected) { (id ? this.targets.get(id) ?? root : root).focus({ preventScroll: true }); }
		};
	}

	button<T>(parent: HTMLElement, label: string, action: () => T, id = label): HTMLButtonElement {
		const button = dom.append(parent, dom.$<HTMLButtonElement>('button'));
		button.type = 'button';
		button.textContent = label;
		this.trackFocus(id, button);
		this.listeners.add(dom.addDisposableListener(button, 'click', () => {
			const report = (error: unknown) => { if (this.onError) { this.onError(error); } else { throw error; } };
			try {
				const result = action();
				if (isThenable(result)) { void Promise.resolve(result).catch(report); }
			} catch (error) { report(error); }
		}));
		return button;
	}

	/** Tabs retain their selected area while the underlying selection or document is refreshed. */
	tabs(parent: HTMLElement, id: string, entries: readonly { id: string; label: string }[], initialId = entries[0]?.id): OrditoTabGroup {
		if (!entries.length) { throw new Error('A Specsplice tab group requires at least one tab.'); }
		const instance = generateUuid();
		const list = dom.append(parent, dom.$('div.ordito-tabs', { role: 'tablist', 'aria-label': localize('ordito.tabs.sections', "Detail Sections") }));
		const content = dom.append(parent, dom.$('div.ordito-tab-panels'));
		const panels = new Map<string, HTMLElement>();
		const buttons = new Map<string, HTMLButtonElement>();
		const previous = this.tabSelections.get(id) ?? initialId;
		let activeId = entries.find(entry => entry.id === previous)?.id ?? entries[0].id;
		const select = (tabId: string, focus = false) => {
			if (!panels.has(tabId)) { return; }
			const current = dom.getActiveElement();
			const hiddenFocus = current && [...panels].some(([id, panel]) => id !== tabId && panel.contains(current));
			activeId = tabId; this.tabSelections.set(id, tabId);
			for (const [id, button] of buttons) {
				button.setAttribute('aria-selected', String(id === tabId));
				button.tabIndex = id === tabId ? 0 : -1;
				panels.get(id)!.hidden = id !== tabId;
			}
			if (focus || hiddenFocus) { buttons.get(tabId)!.focus(); }
		};
		for (const entry of entries) {
			const button = this.button(list, entry.label, () => select(entry.id), `tab:${id}:${entry.id}`);
			button.id = `${instance}-tab-${entry.id}`;
			button.setAttribute('role', 'tab');
			const panel = dom.append(content, dom.$('section.ordito-tab-panel', { id: `${instance}-panel-${entry.id}`, role: 'tabpanel', 'aria-labelledby': button.id, tabindex: '0' }));
			this.trackFocus(`tabpanel:${id}:${entry.id}`, panel);
			button.setAttribute('aria-controls', panel.id);
			buttons.set(entry.id, button); panels.set(entry.id, panel);
			this.listeners.add(dom.addDisposableListener(button, 'keydown', (event: KeyboardEvent) => {
				const index = entries.findIndex(candidate => candidate.id === entry.id);
				let next: number;
				switch (event.key) {
					case 'ArrowRight': next = (index + 1) % entries.length; break;
					case 'ArrowLeft': next = (index - 1 + entries.length) % entries.length; break;
					case 'Home': next = 0; break;
					case 'End': next = entries.length - 1; break;
					default: return;
				}
				event.preventDefault(); event.stopPropagation(); select(entries[next].id, true);
			}));
		}
		select(activeId);
		const group: OrditoTabGroup = { panels, get activeId() { return activeId; }, select };
		this.tabGroups.set(id, group);
		return group;
	}

	/** Reveal a known area before restoring focus to a control in that panel. */
	selectTab(groupId: string, tabId: string, focus = false): void {
		this.tabGroups.get(groupId)?.select(tabId, focus);
	}

	/** Context actions enter the same tabbed surface as ordinary diagram inspection. */
	focusTabGroup(groupId: string): boolean {
		const group = this.tabGroups.get(groupId);
		if (!group) { return false; }
		group.select(group.activeId, true);
		return true;
	}

	/** Keep secondary actions available to keyboard users without crowding the diagram. */
	details(parent: HTMLElement, label: string, id: string, options: { popup?: boolean; openByDefault?: boolean } = {}): HTMLElement {
		const details = dom.append(parent, dom.$<HTMLDetailsElement>('details.ordito-options'));
		details.open = this.expanded.get(id) ?? options.openByDefault ?? false;
		const summary = dom.append(details, dom.$('summary'));
		summary.textContent = label;
		this.trackFocus(id, summary);
		this.disclosures.set(id, details);
		if (options.popup) {
			this.listeners.add(dom.addDisposableListener(parent.ownerDocument, 'pointerdown', (event: PointerEvent) => {
				if (details.open && (dom.isHTMLElement(event.target) || dom.isSVGElement(event.target)) && !details.contains(event.target)) { this.setExpanded(id, false); }
			}));
		}
		this.listeners.add(dom.addDisposableListener(details, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'Escape' && details.open) { event.preventDefault(); event.stopPropagation(); this.setExpanded(id, false); summary.focus(); }
		}));
		return dom.append(details, dom.$('.ordito-options-content'));
	}

	/** Preserve keyboard location without moving focus from another workbench surface. */
	render(root: HTMLElement, render: () => void): void {
		const active = dom.getActiveElement();
		const focused = [...this.targets].find(([, button]) => button === active)?.[0] ?? (active === root ? this.deferredFocus : undefined);
		this.deferredFocus = undefined;
		for (const [id, details] of this.disclosures) {
			this.expanded.set(id, details.open);
		}
		this.disclosures.clear();
		this.tabGroups.clear();
		this.listeners.clear();
		this.targets.clear();
		render();
		if (focused) {
			const target = this.targets.get(focused);
			const disabled = dom.isHTMLButtonElement(target) && target.disabled;
			const successor = disabled ? [...target.parentElement?.children ?? []].find((element): element is HTMLButtonElement => dom.isHTMLButtonElement(element) && !element.disabled) : undefined;
			if (disabled && !successor) { this.deferredFocus = focused; }
			(successor ?? (disabled ? root : target ?? root)).focus({ preventScroll: true });
		}
	}

	focusFirst(): void {
		this.targets.values().next().value?.focus();
	}
}
