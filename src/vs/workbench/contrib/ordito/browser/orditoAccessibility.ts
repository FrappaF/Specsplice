import * as dom from '../../../../base/browser/dom.js';
import { AccessibleContentProvider, AccessibleViewProviderId, AccessibleViewType, IAccessibleViewService } from '../../../../platform/accessibility/browser/accessibleView.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { localize2 } from '../../../../nls.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { IAccessibleViewImplementation } from '../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { AccessibilityVerbositySettingId } from '../../accessibility/browser/accessibilityConfiguration.js';
import { AccessibilityHelpAction, AccessibleViewAction } from '../../accessibility/browser/accessibleViewActions.js';
import { orditoFocusedSurface } from './orditoAccessibilityContext.js';
import { describeOrditoDiagram, describeOrditoHelp } from './orditoAccessibleContent.js';
import { OrditoEditor } from './orditoEditor.js';
import { IOrditoProjectService } from './orditoProjectService.js';
import { ORDITO_VIEW_ID, OrditoView } from './orditoView.js';

/** Both native entry points share current project state and stay scoped to Specsplice focus. */
abstract class OrditoAccessibleImplementation implements IAccessibleViewImplementation {
	readonly priority = 110;
	readonly when = ContextKeyExpr.or(orditoFocusedSurface.isEqualTo('editor'), orditoFocusedSurface.isEqualTo('navigation'));
	abstract readonly name: string;
	abstract readonly type: AccessibleViewType;

	getProvider(accessor: ServicesAccessor): AccessibleContentProvider | undefined {
		const project = accessor.get(IOrditoProjectService);
		const editorService = accessor.get(IEditorService);
		const viewsService = accessor.get(IViewsService);
		const surface = accessor.get(IContextKeyService).getContext(dom.getActiveElement()).getValue<string>(orditoFocusedSurface.key);
		if (surface !== 'editor' && surface !== 'navigation') { return undefined; }
		const editor = editorService.activeEditorPane;
		const navigation = viewsService.getActiveViewWithId<OrditoView>(ORDITO_VIEW_ID);
		const origin = surface === 'navigation' ? navigation : editor instanceof OrditoEditor ? editor : undefined;
		if (!origin) { return undefined; }
		const restoreFocus = origin.captureAccessibilityFocus();
		const resource = project.modelUri?.toString();
		const content = () => this.type === AccessibleViewType.Help ? describeOrditoHelp(project) : origin instanceof OrditoEditor ? origin.describeCurrentContext() : describeOrditoDiagram(project);
		return new AccessibleContentProvider(AccessibleViewProviderId.Ordito,
			{ type: this.type, language: 'plaintext', customHelp: () => describeOrditoHelp(project) }, content,
			() => {
				if (surface === 'editor' && editorService.activeEditorPane !== origin) { return; }
				if (surface === 'navigation' && viewsService.getActiveViewWithId<OrditoView>(ORDITO_VIEW_ID) !== origin) { return; }
				if (resource === project.modelUri?.toString()) { restoreFocus(); } else { origin.focus(); }
			}, AccessibilityVerbositySettingId.Ordito, undefined, undefined, undefined, undefined, origin instanceof OrditoEditor ? origin.onDidChangeReading : project.onDidChange);
	}
}

export class OrditoAccessibleView extends OrditoAccessibleImplementation {
	readonly name = 'ordito-diagram';
	readonly type = AccessibleViewType.View;
}

export class OrditoAccessibilityHelp extends OrditoAccessibleImplementation {
	readonly name = 'ordito-help';
	readonly type = AccessibleViewType.Help;
}

/** Cover native keybindings before the registry dispatcher reaches the Eventually phase. */
export function registerOrditoAccessibleStartup(implementation: IAccessibleViewImplementation): IDisposable {
	const command = implementation.type === AccessibleViewType.View ? AccessibleViewAction : AccessibilityHelpAction;
	return command.addImplementation(implementation.priority - 1, `${implementation.name}-startup`, accessor => {
		const provider = implementation.getProvider(accessor);
		if (!provider) { return false; }
		try { accessor.get(IAccessibleViewService).show(provider); return true; }
		catch { provider.dispose(); return false; }
	}, implementation.when);
}

// Native registry dispatch is installed in the Eventually phase. Specsplice's explicit reading
// control must also work immediately after startup, using the same provider and service.
registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'ordito.readContext', title: localize2('ordito.readContext', "Specsplice: Read Current Context"), f1: true,
			precondition: ContextKeyExpr.or(orditoFocusedSurface.isEqualTo('editor'), orditoFocusedSurface.isEqualTo('navigation')) });
	}
	run(accessor: ServicesAccessor): void {
		const provider = new OrditoAccessibleView().getProvider(accessor);
		if (provider) {
			try { accessor.get(IAccessibleViewService).show(provider); }
			catch (error) { provider.dispose(); throw error; }
		}
	}
});
