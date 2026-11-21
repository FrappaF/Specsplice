import { orditoErrorNotification } from './orditoErrors.js';
import { localize, localize2 } from '../../../../nls.js';
import { isEqual } from '../../../../base/common/resources.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ITerminalService, ITerminalGroupService } from '../../terminal/browser/terminal.js';
import { openOrditoTerminal } from './orditoTerminal.js';
import { IOrditoProjectService, OrditoProjectService } from './orditoProjectService.js';

export const IOrditoProjectWorkspaceService = createDecorator<OrditoProjectWorkspace>('orditoProjectWorkspace');

/** Enter project folders through native workspace APIs, preserving multi-root workspaces and running terminals. */
export class OrditoProjectWorkspace {
	declare readonly _serviceBrand: undefined;
	constructor(
		@IOrditoProjectService private readonly project: OrditoProjectService,
		@IWorkspaceContextService private readonly context: IWorkspaceContextService,
		@IWorkspaceEditingService private readonly editing: IWorkspaceEditingService,
		@IHostService private readonly host: IHostService,
		@IStorageService private readonly storage: IStorageService,
		@ITerminalService private readonly terminals: ITerminalService,
		@ITerminalGroupService private readonly terminalGroups: ITerminalGroupService,
		@ICommandService private readonly commands: ICommandService,
		@INotificationService private readonly notifications: INotificationService
	) { }

	async align(showFiles = false): Promise<void> {
		const root = this.project.projectRoot;
		if (!root) { return; }
		this.storage.store('ordito.project.activeRoot', root.toString(), StorageScope.PROFILE, StorageTarget.MACHINE);
		const folders = this.context.getWorkspace().folders;
		if (folders.some(folder => isEqual(folder.uri, root))) { return; }
		if (folders.length > 1 || this.context.getWorkbenchState() === WorkbenchState.WORKSPACE) { await this.editing.addFolders([{ uri: root }], true); }
		else { this.project.prepareWorkspaceOpen(showFiles); await this.host.openWindow([{ folderUri: root }], { forceReuseWindow: true }); }
	}
	async files(): Promise<void> {
		await this.align(true);
		await this.commands.executeCommand('workbench.view.explorer');
		if (this.project.projectRoot) { await this.commands.executeCommand('revealInExplorer', this.project.projectRoot); }
	}
	async terminal(): Promise<void> {
		const root = this.project.projectRoot;
		if (!root) { this.notifications.info(localize('ordito.terminal.noProject', "No Specsplice project is open. The terminal uses the current workspace directory.")); }
		await openOrditoTerminal(this.terminals, this.terminalGroups, { name: localize('ordito.terminal.project', "Specsplice Project"), cwd: root });
	}
}
registerSingleton(IOrditoProjectWorkspaceService, OrditoProjectWorkspace, InstantiationType.Delayed);
for (const [id, title, method] of [
	['ordito.openFiles', localize2('ordito.files.command', "Specsplice: Open Project Files"), 'files'],
	['ordito.openTerminal', localize2('ordito.terminal.command', "Specsplice: New Project Terminal"), 'terminal']
] as const) {
	registerAction2(class extends Action2 {
		constructor() { super({ id, title, f1: true }); }
		async run(accessor: import('../../../../platform/instantiation/common/instantiation.js').ServicesAccessor): Promise<void> {
			const service = accessor.get(IOrditoProjectWorkspaceService), notifications = accessor.get(INotificationService);
			try { await service[method](); }
			catch (error) { notifications.error(orditoErrorNotification(error, 'load')); }
		}
	});
}
