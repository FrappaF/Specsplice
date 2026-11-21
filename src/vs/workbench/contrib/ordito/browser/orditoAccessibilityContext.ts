import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { AccessibilityVerbositySettingId } from '../../accessibility/browser/accessibilityConfiguration.js';

export const orditoFocusedSurface = new RawContextKey<string>('orditoFocusedSurface', '', localize('ordito.focusedSurface', "The focused Specsplice workbench surface."));

/** Resolve actual user keybindings and honor the feature's verbosity setting. */
export function getOrditoAccessibilityHint(configuration: IConfigurationService, keybindings: IKeybindingService): string {
	if (!configuration.getValue<boolean>(AccessibilityVerbositySettingId.Ordito)) { return ''; }
	const help = keybindings.lookupKeybinding('editor.action.accessibilityHelp')?.getAriaLabel();
	const view = keybindings.lookupKeybinding('editor.action.accessibleView')?.getAriaLabel();
	return help && view
		? localize('ordito.accessibilityHint', "Use {0} for Accessibility Help or {1} to read the diagram as text.", help, view)
		: localize('ordito.accessibilityHintUnassigned', "Use Open Accessibility Help or Open Accessible View from the Command Palette.");
}
