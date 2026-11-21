import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ServiceIdentifier } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { InMemoryStorageService, IStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceEditingService } from '../../../../services/workspaces/common/workspaceEditing.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { ITerminalService, ITerminalGroupService } from '../../../terminal/browser/terminal.js';
import { IOrditoProjectService } from '../../browser/orditoProjectService.js';
import { OrditoProjectWorkspace } from '../../browser/orditoProjectWorkspace.js';

suite('Specsplice project workspace tools', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture(initialFolders: URI[] = []) {
		const instantiation = store.add(new TestInstantiationService());
		const stub = <T extends object>(id: ServiceIdentifier<T>, values: object) => instantiation.stub(id, Object.assign(new (mock<T>())(), values));
		const storage = store.add(new InMemoryStorageService());
		let root = URI.file('/projects/project with spaces');
		const updates: object[] = [], terminals: object[] = [], commands: object[] = [], terminalSteps: string[] = [];
		stub(IOrditoProjectService, { get projectRoot() { return root; }, prepareWorkspaceOpen: () => {} });
		// Retain the getter through the mock rather than copying its current value.
		Object.defineProperty(instantiation.get(IOrditoProjectService), 'projectRoot', { get: () => root });
		stub(IWorkspaceContextService, { getWorkspace: () => testWorkspace(...initialFolders), getWorkbenchState: () => initialFolders.length > 1 ? WorkbenchState.WORKSPACE : initialFolders.length ? WorkbenchState.FOLDER : WorkbenchState.EMPTY });
		stub(IWorkspaceEditingService, { updateFolders: async (index: number, count: number, folders: object[]) => { updates.push({ index, count, folders }); }, addFolders: async (folders: object[]) => { updates.push({ add: folders }); } });
		stub(IHostService, { openWindow: async (folders: object[], options: object) => { updates.push({ open: folders, options }); } });
		instantiation.stub(IStorageService, storage);
		stub(ITerminalService, { createTerminal: async (options: { config: object }) => { terminalSteps.push('created'); terminals.push({ config: options.config }); return { focusWhenReady: async () => { terminalSteps.push('focused'); } }; }, setActiveInstance: () => { terminalSteps.push('active'); } });
		stub(ITerminalGroupService, { showPanel: async () => { terminalSteps.push('panel-shown'); } });
		stub(ICommandService, { executeCommand: async (...args: object[]) => { commands.push(args); } });
		stub(INotificationService, { info: () => {} });
		return { service: instantiation.createInstance(OrditoProjectWorkspace), storage, updates, terminals, terminalSteps, commands, root, changeRoot: (value: URI) => { root = value; } };
	}
	test('a different single-folder workspace is replaced through its native API and the active root is saved', async () => {
		const f = fixture([URI.file('/old-project')]); await f.service.align();
		assert.deepStrictEqual(f.updates, [{ open: [{ folderUri: f.root }], options: { forceReuseWindow: true } }]);
		assert.strictEqual(f.storage.get('ordito.project.activeRoot', StorageScope.PROFILE), f.root.toString());
	});
	test('multi-root folders are preserved and an already-present project is not added again', async () => {
		const a = URI.file('/a'), b = URI.file('/b');
		const f = fixture([a, b]); await f.service.align();
		assert.deepStrictEqual(f.updates, [{ add: [{ uri: f.root }] }]);
		const existing = fixture([f.root]); await existing.service.align(); assert.deepStrictEqual(existing.updates, []);
	});
	test('new terminals use the current project without changing previously created terminal configurations', async () => {
		const f = fixture(); await f.service.terminal();
		assert.deepStrictEqual(f.terminalSteps, ['created', 'active', 'panel-shown', 'focused']);
		const next = URI.file('/projects/next'); f.changeRoot(next); await f.service.terminal();
		assert.deepStrictEqual(f.terminals, [{ config: { name: 'Specsplice Project', cwd: f.root } }, { config: { name: 'Specsplice Project', cwd: next } }]);
	});
});
