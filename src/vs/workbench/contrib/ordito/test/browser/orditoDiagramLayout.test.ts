import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IEditorGroupsService, IEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService, Parts, type IPartVisibilityChangeEvent } from '../../../../services/layout/browser/layoutService.js';
import { OrditoDiagramLayout } from '../../browser/orditoDiagramLayout.js';
import { TestEditorInput } from '../../../../test/browser/workbenchTestServices.js';
import { URI } from '../../../../../base/common/uri.js';
import { OrditoInput } from '../../browser/orditoInput.js';

suite('Specsplice diagram layout ownership', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture(split = false, panelVisible = true, sidebarVisible = true) {
		const active = store.add(new Emitter<void>()), visible = store.add(new Emitter()), partChanged = store.add(new Emitter<IPartVisibilityChangeEvent>());
		const root = dom.append(document.body, dom.$('div')); store.add(toDisposable(() => root.remove()));
		const ordito: OrditoInput = Object.create(OrditoInput.prototype), other = store.add(new TestEditorInput(URI.file('/other.txt'), 'test.other'));
		const editors = Object.assign(new (mock<IEditorService>())(), { activeEditor: ordito, visibleEditors: split ? [ordito, other] : [ordito], onDidActiveEditorChange: active.event, onDidVisibleEditorsChange: visible.event });
		const parts = new Map<Parts, boolean>([Parts.ACTIVITYBAR_PART, Parts.STATUSBAR_PART, Parts.SIDEBAR_PART, Parts.AUXILIARYBAR_PART, Parts.PANEL_PART].map(part => [part, part === Parts.PANEL_PART ? panelVisible : part === Parts.SIDEBAR_PART ? sidebarVisible : true]));
		const layout = Object.assign(new (mock<IWorkbenchLayoutService>())(), { mainContainer: root, onDidChangePartVisibility: partChanged.event, isVisible: (part: Parts) => parts.get(part) === true, setPartHidden: (hidden: boolean, part: Parts) => { parts.set(part, !hidden); } });
		let tabsHidden = false;
		const mainPart = Object.assign(new (mock<IEditorPart>())(), { enforcePartOptions: () => { tabsHidden = true; return toDisposable(() => { tabsHidden = false; }); } });
		const groups = Object.assign(new (mock<IEditorGroupsService>())(), { mainPart });
		const controller = store.add(new OrditoDiagramLayout(layout, groups, editors, new TestConfigurationService(), store.add(new InMemoryStorageService())));
		return { controller, active, partChanged, editors, parts, root, get tabsHidden() { return tabsHidden; } };
	}
	test('diagram focus opens navigation, hides native chrome and restores it when another editor opens', () => {
		const f = fixture(false, true, false);
		assert.deepStrictEqual([f.tabsHidden, [...f.parts.values()], f.root.classList.contains('ordito-diagram-focus')], [true, [false, false, true, false, false], true]);
		Object.assign(f.editors, { activeEditor: undefined, visibleEditors: [] }); f.active.fire();
		assert.deepStrictEqual([f.tabsHidden, [...f.parts.values()], f.root.classList.contains('ordito-diagram-focus')], [false, [true, true, true, true, true], false]);
	});
	test('a split with another editor keeps its tools and tabs', () => {
		const f = fixture(true);
		assert.deepStrictEqual([f.tabsHidden, [...f.parts.values()]], [false, [true, true, true, true, true]]);
	});
	test('an explicitly opened terminal survives return to IDE and disposal restores borrowed parts', () => {
		const f = fixture(false, false); f.parts.set(Parts.PANEL_PART, true);
		f.controller.dispose();
		assert.deepStrictEqual([f.tabsHidden, [...f.parts.values()]], [false, [true, true, true, true, true]]);
	});
	test('late native chrome updates stay hidden while requested navigation and panels remain usable', () => {
		const f = fixture();
		for (const partId of [Parts.STATUSBAR_PART, Parts.ACTIVITYBAR_PART, Parts.SIDEBAR_PART, Parts.PANEL_PART]) { f.parts.set(partId, true); f.partChanged.fire({ partId, visible: true }); }
		assert.deepStrictEqual([f.parts.get(Parts.STATUSBAR_PART), f.parts.get(Parts.ACTIVITYBAR_PART), f.parts.get(Parts.SIDEBAR_PART), f.parts.get(Parts.PANEL_PART)], [false, false, true, true]);
		f.parts.set(Parts.SIDEBAR_PART, false); f.partChanged.fire({ partId: Parts.SIDEBAR_PART, visible: false }); f.active.fire();
		assert.strictEqual(f.parts.get(Parts.SIDEBAR_PART), false);
	});

});
