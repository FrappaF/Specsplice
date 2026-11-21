import { localize, localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { OrditoInput } from './orditoInput.js';
import { OrditoStartup } from './orditoStartup.js';
import { OrditoEditor } from './orditoEditor.js';
import { OrditoProjectService, IOrditoProjectService } from './orditoProjectService.js';
import { ORDITO_VIEW_CONTAINER_ID, ORDITO_VIEW_ID, OrditoView } from './orditoView.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { UndoCommand, RedoCommand } from '../../../../editor/browser/editorExtensions.js';
import './orditoEditing.js';
import './orditoNavigation.js';
import { OrditoAccessibilityHelp, OrditoAccessibleView, registerOrditoAccessibleStartup } from './orditoAccessibility.js';
import { AccessibleViewRegistry } from '../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { IWorkingCopyEditorService } from '../../../services/workingCopy/common/workingCopyEditorService.js';
import { IWorkingCopyIdentifier, NO_TYPE_ID } from '../../../services/workingCopy/common/workingCopy.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { Extensions as ConfigurationMigrationExtensions, IConfigurationMigrationRegistry } from '../../../common/configuration.js';
import { OrditoDiagramLayout } from './orditoDiagramLayout.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IConfigurationService, ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { defaultDiagramCheckpointTimeoutMinutes, diagramCheckpointReasoningEfforts, maxDiagramCheckpointTimeoutMinutes } from '../common/codeBridge.js';
import { defaultDiagramCheckpointReasoningEffort, diagramCheckpointReasoningEffortSetting, diagramCheckpointTimeoutSetting, diagramExplorationBudgetSetting } from '../common/diagramExplorationSettings.js';
import { defaultProjectDiagramExplorationBudget, maximumDiagramExplorationBudget, minimumDiagramExplorationBudget } from '../common/diagramExplorationBudget.js';
import { orditoMetadataNames } from './orditoProjectFiles.js';

class OrditoCompatibility extends Disposable {
	static readonly ID = 'workbench.contrib.orditoCompatibility';

	constructor(@IStorageService storage: IStorageService) {
		super();
		for (const id of CommandsRegistry.getCommands().keys()) {
			if (id.startsWith('ordito.')) {
				this._register(CommandsRegistry.registerCommandAlias(`ade.${id.slice('ordito.'.length)}`, id));
			}
		}
		for (const scope of [StorageScope.PROFILE, StorageScope.WORKSPACE]) {
			for (const target of [StorageTarget.MACHINE, StorageTarget.USER]) {
				for (const key of storage.keys(scope, target)) {
					if (!key.startsWith('ade.')) { continue; }
					const currentKey = `ordito.${key.slice('ade.'.length)}`;
					const value = storage.get(key, scope);
					if (value === undefined) { continue; }
					if (storage.get(currentKey, scope) === undefined) { storage.store(currentKey, value, scope, target); }
					storage.remove(key, scope);
				}
			}
		}
	}
}
registerWorkbenchContribution2(OrditoCompatibility.ID, OrditoCompatibility, WorkbenchPhase.BlockStartup);

class OrditoWorkingCopyEditor extends Disposable {
	static readonly ID = 'workbench.contrib.orditoWorkingCopyEditor';
	constructor(
		@IWorkingCopyEditorService workingCopies: IWorkingCopyEditorService,
		@IOrditoProjectService project: OrditoProjectService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		const handles = (copy: IWorkingCopyIdentifier) =>
			copy.typeId === NO_TYPE_ID && copy.resource.toString() === project.modelUri?.toString();
		this._register(workingCopies.registerHandler({
			handles,
			isOpen: (copy, editor) => handles(copy) && editor instanceof OrditoInput,
			createEditor: () => instantiationService.createInstance(OrditoInput)
		}));
	}
}
registerWorkbenchContribution2(OrditoWorkingCopyEditor.ID, OrditoWorkingCopyEditor, WorkbenchPhase.BlockStartup);

class OrditoUndoRedo extends Disposable {
	static readonly ID = 'workbench.contrib.orditoUndoRedo';
	constructor(
		@IEditorService editorService: IEditorService,
		@IOrditoProjectService project: OrditoProjectService
	) {
		super();
		this._register(UndoCommand.addImplementation(105, 'ordito', () => editorService.activeEditor instanceof OrditoInput ? project.undo() : false));
		this._register(RedoCommand.addImplementation(105, 'ordito', () => editorService.activeEditor instanceof OrditoInput ? project.redo() : false));
	}
}
registerWorkbenchContribution2(OrditoUndoRedo.ID, OrditoUndoRedo, WorkbenchPhase.AfterRestored);

class OrditoAccessibility extends Disposable {
	static readonly ID = 'workbench.contrib.orditoAccessibility';
	constructor() {
		super();
		for (const implementation of [new OrditoAccessibleView(), new OrditoAccessibilityHelp()]) {
			this._register(AccessibleViewRegistry.register(implementation));
			this._register(registerOrditoAccessibleStartup(implementation));
		}
	}
}
registerWorkbenchContribution2(OrditoAccessibility.ID, OrditoAccessibility, WorkbenchPhase.BlockStartup);

const orditoContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: ORDITO_VIEW_CONTAINER_ID,
	title: localize2('ordito.systemFeatures', "System and Features"),
	icon: Codicon.typeHierarchy,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [ORDITO_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: ORDITO_VIEW_CONTAINER_ID,
	order: -1
}, ViewContainerLocation.Sidebar, { isDefault: true });

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: ORDITO_VIEW_ID,
	name: localize2('ordito.systemFeatures', "System and Features"),
	ctorDescriptor: new SyncDescriptor(OrditoView),
	canToggleVisibility: false,
	canMoveView: true
}], orditoContainer);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(OrditoEditor, OrditoEditor.ID, localize('ordito.editor', "Specsplice")), [new SyncDescriptor(OrditoInput)]
);

class OrditoSerializer implements IEditorSerializer {
	canSerialize(): boolean { return true; }
	serialize(editor: EditorInput): string { return JSON.stringify({ name: editor.getName() }); }
	deserialize(instantiationService: IInstantiationService, serialized: string): EditorInput {
		const input = instantiationService.createInstance(OrditoInput);
		try {
			const saved = JSON.parse(serialized);
			if (typeof saved?.name === 'string' && saved.name.trim()) { input.restoreName(saved.name); }
		} catch { /* Older sessions did not persist a caption. */ }
		return input;
	}
}
const editorFactory = Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory);
editorFactory.registerEditorSerializer(OrditoInput.ID, OrditoSerializer);
editorFactory.registerEditorSerializer('workbench.editor.ade', OrditoSerializer);

class OrditoResolver extends Disposable {
	static readonly ID = 'workbench.contrib.orditoResolver';
	constructor(
		@IEditorResolverService resolver: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		for (const pattern of ['ordito-home:/**', 'ade-home:/**']) {
			this._register(resolver.registerEditor(pattern, {
				id: OrditoInput.ID, label: localize('ordito.label', "Specsplice"), priority: RegisteredEditorPriority.exclusive
			}, { singlePerResource: true }, {
				createEditorInput: () => ({ editor: instantiationService.createInstance(OrditoInput), options: { pinned: true } })
			}));
		}
	}
}
registerWorkbenchContribution2(OrditoResolver.ID, OrditoResolver, WorkbenchPhase.BlockStartup);

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ordito.showHome', title: localize2('ordito.showHome', "Specsplice: Open Home"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IOrditoProjectService).showHome();
		const editorService = accessor.get(IEditorService);
		const pane = await editorService.openEditor({ resource: OrditoInput.RESOURCE, options: { pinned: true, revealIfOpened: true } });
		if (pane instanceof OrditoEditor) { pane.showWorkspace(); }
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({ id: 'ordito.showDiagram', title: localize2('ordito.return', "Specsplice: Return to Model"), f1: true,
			keybinding: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyD, weight: KeybindingWeight.WorkbenchContrib } });
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const project = accessor.get(IOrditoProjectService);
		const editorService = accessor.get(IEditorService);
		await project.restore();
		if (project.activeView) { project.showDiagram(project.activeView.id); }
		const pane = await editorService.openEditor({ resource: OrditoInput.RESOURCE, options: { pinned: true, revealIfOpened: true } });
		if (pane instanceof OrditoEditor) { pane.showWorkspace(); }
	}
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ordito.showNavigation', title: localize2('ordito.showNavigation', "Specsplice: Show Diagram Navigation"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> { await accessor.get(IViewsService).openViewContainer(ORDITO_VIEW_CONTAINER_ID, true); }
});
CommandsRegistry.registerCommandAlias('ordito.returnToDiagram', 'ordito.showDiagram');

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ordito.ai.prepareReviewedCode', title: localize2('ordito.featureCode.command', "Specsplice: Prepare Reviewed Code from Diagrams"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const project = accessor.get(IOrditoProjectService);
		const editorService = accessor.get(IEditorService);
		await project.restore();
		const pane = await editorService.openEditor({ resource: OrditoInput.RESOURCE, options: { pinned: true, revealIfOpened: true } });
		if (pane instanceof OrditoEditor) { await pane.prepareReviewedCodeFromDiagrams(); }
	}
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ordito.openModel', title: localize2('ordito.openModel', "Specsplice: Open Model"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const project = accessor.get(IOrditoProjectService);
		const editorService = accessor.get(IEditorService);
		await project.chooseModel();
		await editorService.openEditor({ resource: OrditoInput.RESOURCE, options: { pinned: true, revealIfOpened: true } });
	}
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ordito.upgradeModelV4', title: localize2('ordito.upgradeModelV4', "Specsplice: Upgrade Model to Version 4"), f1: true }); }
	run(accessor: ServicesAccessor): void { accessor.get(IOrditoProjectService).upgradeToV4(); }
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ordito.openModelSource', title: localize2('ordito.openModelSource', "Specsplice: Edit Model Specification"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const resource = accessor.get(IOrditoProjectService).modelUri;
		if (resource) { await accessor.get(IEditorService).openEditor({ resource, options: { override: 'default', pinned: true } }); }
	}
});

// Compatibility command for the semantic shell introduced in M1.
registerAction2(class extends Action2 {
	constructor() { super({ id: 'ordito.workbench.open', title: localize2('ordito.openProjectHome', "Specsplice: Open Project Home"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IOrditoProjectService).showHome();
		await accessor.get(IEditorService).openEditor({ resource: OrditoInput.RESOURCE, options: { pinned: true, revealIfOpened: true } });
	}
});

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerDefaultConfigurations([
	{ overrides: {
		'workbench.startupEditor': 'orditoHome',
		'workbench.welcomePage.experimentalOnboarding': false,
		'workbench.secondarySideBar.defaultVisibility': 'hidden',
		'files.readonlyInclude': Object.fromEntries(orditoMetadataNames.flatMap(name => [
			[`**/${name}/reports/**`, true],
			[`**/${name}/structural/sessions/*/review/**`, true],
			[`**/${name}/collaboration/*/review/**`, true]
		]))
	} }
]);

registerWorkbenchContribution2(OrditoStartup.ID, OrditoStartup, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(OrditoDiagramLayout.ID, OrditoDiagramLayout, WorkbenchPhase.AfterRestored);

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ordito.toggleWorkbench', title: localize2('ordito.toggleWorkbench', "Specsplice: Toggle IDE Tools"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const configuration = accessor.get(IConfigurationService);
		await configuration.updateValue('ordito.focusDiagrams', configuration.getValue<boolean>('ordito.focusDiagrams') === false, ConfigurationTarget.WORKSPACE);
	}
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ordito.toggleNavigation', title: localize2('ordito.toggleNavigation', "Specsplice: Toggle Diagram Navigation"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const layout = accessor.get(IWorkbenchLayoutService);
		if (layout.isVisible(Parts.SIDEBAR_PART)) { layout.setPartHidden(true, Parts.SIDEBAR_PART); }
		else { await accessor.get(IViewsService).openView(ORDITO_VIEW_ID, true); }
	}
});


Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'ordito', title: 'Specsplice', type: 'object', properties: {
		'ordito.focusDiagrams': { type: 'boolean', default: true, description: localize('ordito.focusDiagrams', "Keep diagram work focused. IDE tools return when you open another editor or choose Show IDE.") },
		'ordito.codeUpdates.suggestAfterSave': { type: 'boolean', default: true, description: localize('ordito.codeUpdates.suggestAfterSave', "Show an action to update the codebase after saving diagram changes. Update Codebase from Diagrams remains available in the Code tab and Command Palette.") },
		'ordito.diagramImport.incremental': { type: 'boolean', default: true, description: localize('ordito.incremental.setting', "Explore architecture in a persistent Codex conversation with local tools and independent diagram drafts. Disable to use the legacy import pipeline.") },
		[diagramCheckpointTimeoutSetting]: {
			type: 'integer',
			minimum: 1,
			maximum: maxDiagramCheckpointTimeoutMinutes,
			default: defaultDiagramCheckpointTimeoutMinutes,
			scope: ConfigurationScope.APPLICATION,
			description: localize('ordito.diagram.attemptMinutesSetting', "Maximum minutes for each attempt at a step in automatic diagram generation. The remaining exploration budget can end the attempt sooner.")
		},
		[diagramCheckpointReasoningEffortSetting]: {
			type: 'string',
			enum: [...diagramCheckpointReasoningEfforts],
			default: defaultDiagramCheckpointReasoningEffort,
			scope: ConfigurationScope.APPLICATION,
			description: localize('ordito.diagram.reasoningEffortSetting', "Reasoning effort for automatic Codex diagram generation, audit, and corrections. Choose inherit to use the Codex CLI configuration.")
		},
		[diagramExplorationBudgetSetting]: {
			type: 'object',
			scope: ConfigurationScope.APPLICATION,
			default: { ...defaultProjectDiagramExplorationBudget },
			description: localize('ordito.diagram.defaultBudgetSetting', "Limits for new diagram explorations. Use Set Default Exploration Budget in Specsplice AI Settings to choose a preset or enter values in KiB and minutes."),
			additionalProperties: false,
			required: ['maxToolCalls', 'maxReadBytes', 'maxDurationMs', 'maxModelTurns'],
			properties: {
				maxToolCalls: { type: 'integer', minimum: minimumDiagramExplorationBudget.maxToolCalls, maximum: maximumDiagramExplorationBudget.maxToolCalls },
				maxReadBytes: { type: 'integer', minimum: minimumDiagramExplorationBudget.maxReadBytes, maximum: maximumDiagramExplorationBudget.maxReadBytes },
				maxDurationMs: { type: 'integer', minimum: minimumDiagramExplorationBudget.maxDurationMs, maximum: maximumDiagramExplorationBudget.maxDurationMs },
				maxModelTurns: { type: 'integer', minimum: minimumDiagramExplorationBudget.maxModelTurns, maximum: maximumDiagramExplorationBudget.maxModelTurns }
			}
		}
	}
});

Registry.as<IConfigurationMigrationRegistry>(ConfigurationMigrationExtensions.ConfigurationMigration).registerConfigurationMigrations([
	'ordito.focusDiagrams', 'ordito.codeUpdates.suggestAfterSave', 'ordito.diagramImport.incremental',
	diagramCheckpointTimeoutSetting, diagramCheckpointReasoningEffortSetting, diagramExplorationBudgetSetting
].map(currentKey => {
	const key = `ade.${currentKey.slice('ordito.'.length)}`;
	return {
		key,
		includeApplication: true,
		migrateFn: (value, accessor) => accessor(currentKey) === undefined
			? [[currentKey, { value }], [key, { value: undefined }]]
			: [[key, { value: undefined }]]
	};
}));
