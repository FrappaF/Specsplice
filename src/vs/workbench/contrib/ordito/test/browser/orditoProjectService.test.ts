import assert from 'assert';
import { messagingFixture } from '../common/messagingFixture.js';
import { stateFixture } from '../common/stateFixture.js';
import { interactionFixture } from '../common/interactionFixture.js';
import { createPureProject } from '../../common/modelProject.js';
import { switchModelStack } from '../../common/modelStack.js';
import { nodeOrdersFixture } from '../common/nodeOrdersFixture.js';
import { blueprintFixture } from '../common/blueprintFixture.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ConfirmResult, IDialogService, IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { FileChangesEvent, FileChangeType, FileOperationError, FileOperationResult, IFileContent, IFileSystemWatcher } from '../../../../../platform/files/common/files.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { OrditoProjectService } from '../../browser/orditoProjectService.js';
import { IWorkspaceContextService, IWorkspaceFoldersChangeEvent } from '../../../../../platform/workspace/common/workspace.js';
import { testWorkspace } from '../../../../../platform/workspace/test/common/testWorkspace.js';
import { projectDocuments } from './testProjectDocuments.js';
import { migrateSemanticModelToV4, migrateSemanticModelToV5 } from '../../common/modelMigration.js';
import { checkoutModel } from '../../common/checkoutModel.js';
import { libraryModel, observatoryModel } from '../common/independentProjects.js';
import { InvalidSemanticModelError } from '../../common/modelValidation.js';
import { type VisualEdit } from '../../common/visualEditing.js';

class ModelDialogs extends mock<IFileDialogService>() {
	selected: URI | undefined;
	saveTarget: URI | undefined;
	choice = ConfirmResult.CANCEL;
	override async showOpenDialog(): Promise<URI[] | undefined> { return this.selected ? [this.selected] : undefined; }
	override async showSaveConfirm(): Promise<ConfirmResult> { return this.choice; }
	override async showSaveDialog(): Promise<URI | undefined> { return this.saveTarget; }
}

class DelayedFileService extends FileService {
	delay: { resource: URI; gate: DeferredPromise<void> } | undefined;
	failCreate: URI | undefined;
	failWrite: { resource: URI; error: Error } | undefined;
	private readonly watchers = new Set<{ resource: URI; emitter: Emitter<FileChangesEvent> }>();
	get watcherCount(): number { return this.watchers.size; }
	override createWatcher(resource: URI): IFileSystemWatcher {
		const store = new DisposableStore();
		const emitter = store.add(new Emitter<FileChangesEvent>());
		const watcher = { resource, emitter };
		this.watchers.add(watcher);
		store.add(toDisposable(() => this.watchers.delete(watcher)));
		return { onDidChange: emitter.event, dispose: () => store.dispose() };
	}
	emitWatch(resource: URI): void {
		for (const watcher of this.watchers) {
			if (watcher.resource.toString() === resource.toString()) { watcher.emitter.fire(new FileChangesEvent([{ resource, type: FileChangeType.UPDATED }], false)); }
		}
	}
	override async readFile(resource: URI): Promise<IFileContent> {
		if (resource.toString() === this.delay?.resource.toString()) { await this.delay.gate.p; }
		return super.readFile(resource);
	}
	override async createFile(...args: Parameters<FileService['createFile']>): ReturnType<FileService['createFile']> {
		if (args[0].toString() === this.failCreate?.toString()) { throw new Error('Interrupted criteria creation'); }
		return super.createFile(...args);
	}
	override async writeFile(...args: Parameters<FileService['writeFile']>): ReturnType<FileService['writeFile']> {
		const failure = this.failWrite;
		if (failure && args[0].toString() === failure.resource.toString()) { throw failure.error; }
		return super.writeFile(...args);
	}
}

suite('Specsplice project context', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let storage: InMemoryStorageService;
	let files: DelayedFileService;
	let dialogs: ModelDialogs;
	let contextFolders: URI[] = [];
	let workspaceChanges: Emitter<IWorkspaceFoldersChangeEvent>;
	let confirmExisting = false;
	const workspaceContext = new class extends mock<IWorkspaceContextService>() {
		override get onDidChangeWorkspaceFolders() { return workspaceChanges.event; }
		override getWorkspace() { return testWorkspace(...contextFolders); }
	};
	const projectDialogs = new class extends mock<IDialogService>() { override async confirm() { return { confirmed: confirmExisting }; } };
	let documents: ReturnType<typeof projectDocuments>;
	const resource = URI.parse('test:/checkout.ordito.json');

	setup(async () => {
		contextFolders = []; confirmExisting = false;
		workspaceChanges = disposables.add(new Emitter<IWorkspaceFoldersChangeEvent>());
		storage = disposables.add(new InMemoryStorageService());
		files = disposables.add(new DelayedFileService(new NullLogService()));
		const provider = disposables.add(new InMemoryFileSystemProvider());
		disposables.add(files.registerProvider('test', provider));
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(checkoutModel)));
		dialogs = new ModelDialogs();
		documents = projectDocuments(files, disposables);
	});

	test('model revisions distinguish parsed blueprint updates from earlier dirty notifications and follow undo and redo', async () => {
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(blueprintFixture)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.openModelResource(resource);
		const initialRevision = project.modelRevision;
		const observations: { document: string; revision: number; present: boolean }[] = [];
		disposables.add(project.onDidChange(() => observations.push({ document: project.documentVersion, revision: project.modelRevision, present: project.model.views.some(view => view.id === 'new.blueprint') })));
		project.edit({ kind: 'c4View', view: { ...blueprintFixture.views[2], id: 'new.blueprint', name: 'New Blueprint' } });
		assert.deepStrictEqual(observations.map(entry => [entry.revision - initialRevision, entry.present]), [[0, false], [1, true]]);
		assert.strictEqual(observations[0].document, observations[1].document);
		await project.undo();
		assert.deepStrictEqual([project.modelRevision - initialRevision, project.model.views.some(view => view.id === 'new.blueprint')], [2, false]);
		await project.redo();
		assert.deepStrictEqual([project.modelRevision - initialRevision, project.model.views.some(view => view.id === 'new.blueprint')], [3, true]);
	});

	test('a new workspace restores its project and resolves imported snapshots to the source root', async () => {
		const folder = URI.parse('test:/project with spaces');
		await files.writeFile(URI.joinPath(folder, '.ordito', 'model.json'), VSBuffer.fromString(JSON.stringify(checkoutModel)));
		contextFolders = [folder];
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.restore();
		assert.deepStrictEqual([project.projectRoot?.toString(), project.model.id], [folder.toString(), checkoutModel.id]);
		const snapshot = URI.joinPath(folder, '.ordito', 'imports', 'snapshot', 'model.ordito.json');
		await files.writeFile(snapshot, VSBuffer.fromString(JSON.stringify(checkoutModel)));
		await project.openModelResource(snapshot);
		assert.strictEqual(project.projectRoot?.toString(), folder.toString());
	});
	test('Files handoff restores a standalone document and its per-diagram selections in the new folder', async () => {
		const folder = URI.parse('test:/standalone'), model = URI.joinPath(folder, 'model.json');
		await files.writeFile(model, VSBuffer.fromString(JSON.stringify(checkoutModel)));
		contextFolders = [URI.parse('test:/old')];
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.openModelResource(model);
		project.showDiagram('purchase-outcome'); project.selectElement('declined');
		project.showDiagram('cart-structure'); project.selectElement('cart');
		project.prepareWorkspaceOpen(true);
		project.dispose();
		contextFolders = [folder];
		const restored = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await restored.restore();
		assert.deepStrictEqual([restored.modelUri?.toString(), restored.activeView?.id, restored.selectedId, restored.takeWorkspaceFilesRequest(), restored.takeWorkspaceFilesRequest()], [model.toString(), 'cart-structure', 'cart', true, false]);
		restored.showDiagram('purchase-outcome'); assert.strictEqual(restored.selectedId, 'declined');
	});


	for (const missingPreviousModel of [false, true]) {
		test(`explicit folder handoff supersedes ${missingPreviousModel ? 'missing' : 'valid'} older workspace model selection`, async () => {
			const folder = URI.parse('test:/returning-project');
			const previous = URI.joinPath(folder, 'previous.json');
			const target = URI.joinPath(folder, '.ordito', 'model.json');
			contextFolders = [folder];
			if (!missingPreviousModel) { await files.writeFile(previous, VSBuffer.fromString(JSON.stringify(libraryModel))); }
			await files.writeFile(target, VSBuffer.fromString(JSON.stringify(checkoutModel)));
			storage.store('ordito.shell.model', previous.toString(), StorageScope.WORKSPACE, StorageTarget.MACHINE);
			storage.store('ordito.shell.workspace', JSON.stringify([folder.toString()]), StorageScope.WORKSPACE, StorageTarget.MACHINE);
			storage.store(`ordito.project.openContext:${folder.toString()}`, JSON.stringify({ model: target.toString(), diagram: { viewId: 'cart-structure', selections: { 'cart-structure': 'cart' } }, showFiles: true }), StorageScope.PROFILE, StorageTarget.MACHINE);
			const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
			await project.restore();
			assert.deepStrictEqual([project.modelUri?.toString(), project.model.id, project.selectedId, project.error, project.takeWorkspaceFilesRequest()], [target.toString(), checkoutModel.id, 'cart', undefined, true]);
			assert.strictEqual(storage.get(`ordito.project.openContext:${folder.toString()}`, StorageScope.PROFILE), undefined);
		});
	}

	test('native workspace changes replace the active project and empty folders clear the old model', async () => {
		const first = URI.parse('test:/first'), second = URI.parse('test:/second');
		contextFolders = [first];
		await files.writeFile(URI.joinPath(first, '.ordito/model.json'), VSBuffer.fromString(JSON.stringify(checkoutModel)));
		await files.writeFile(URI.joinPath(second, '.ordito/model.json'), VSBuffer.fromString(JSON.stringify(libraryModel)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.restore();
		contextFolders = [first, second];
		await project.followWorkspace();
		assert.strictEqual(project.projectRoot?.toString(), first.toString(), 'adding a root preserves the current project');
		contextFolders = [second];
		const switched = Event.toPromise(Event.filter(project.onDidChange, () => project.model.id === libraryModel.id && !project.loading));
		workspaceChanges.fire({ added: [], removed: [], changed: [] });
		await switched;
		assert.deepStrictEqual([project.projectRoot?.toString(), project.model.id], [second.toString(), libraryModel.id]);
		contextFolders = [URI.parse('test:/empty')];
		await project.followWorkspace();
		assert.deepStrictEqual([project.modelUri, project.section, project.model.semantics.elements.length, project.model.views.length], [undefined, 'home', 0, 0]);
	});

	test('cancelled folder switch keeps unsaved work and retry saves before opening the new folder', async () => {
		const first = URI.parse('test:/first'), second = URI.parse('test:/second');
		const source = URI.joinPath(first, '.ordito/model.json');
		contextFolders = [first];
		await files.writeFile(source, VSBuffer.fromString(JSON.stringify(checkoutModel)));
		await files.writeFile(URI.joinPath(second, '.ordito/model.json'), VSBuffer.fromString(JSON.stringify(libraryModel)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.restore();
		project.edit({ kind: 'rename', target: 'element', id: 'payment', name: 'Keep My Work' });
		contextFolders = [second];
		await project.followWorkspace();
		assert.ok(project.error?.includes('workspace folder changed'));
		assert.deepStrictEqual([project.dirty, project.editable, project.modelUri, project.projectRoot], [true, false, undefined, undefined]);
		assert.ok(!JSON.parse((await files.readFile(source)).value.toString()).semantics.elements.some((element: { name: string }) => element.name === 'Keep My Work'));
		dialogs.choice = ConfirmResult.SAVE;
		await project.retry();
		assert.strictEqual(project.model.id, libraryModel.id);
		assert.ok(JSON.parse((await files.readFile(source)).value.toString()).semantics.elements.some((element: { name: string }) => element.name === 'Keep My Work'));
	});

	test('copied workspace state cannot restore a project belonging to a different folder', async () => {
		contextFolders = [URI.parse('test:/new-folder')];
		storage.store('ordito.shell.model', resource.toString(), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storage.store('ordito.shell.workspace', JSON.stringify(['test:/old-folder']), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storage.store('ordito.shell.section', 'diagram', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.restore();
		assert.deepStrictEqual([project.modelUri, project.section, project.model.views.length], [undefined, 'home', 0]);
	});

	test('an existing project is opened only after confirmation, without overwriting its model', async () => {
		const folder = URI.parse('test:/existing');
		const model = URI.joinPath(folder, '.ordito', 'model.json');
		const original = JSON.stringify(checkoutModel);
		await files.writeFile(model, VSBuffer.fromString(original));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		assert.strictEqual(await project.createProject('Replacement', folder), false);
		confirmExisting = true;
		assert.strictEqual(await project.createProject('Replacement', folder), true);
		assert.deepStrictEqual([project.model.id, (await files.readFile(model)).value.toString()], [checkoutModel.id, original]);
	});

	for (const [metadata, modelName] of [['.ordito', 'model.ordito.json'], ['.ade', 'model.ade.json']]) {
		test(`restores the active imported snapshot from ${metadata} and rejects pointer traversal`, async () => {
			const folder = URI.parse('test:/codebase');
			contextFolders = [folder];
			const version = '11111111-1111-4111-8111-111111111111';
			const directory = URI.joinPath(folder, metadata, 'imports', version);
			await files.createFolder(directory);
			const model = URI.joinPath(directory, modelName);
			await files.writeFile(model, VSBuffer.fromString(JSON.stringify(checkoutModel)));
			const pointer = URI.joinPath(folder, metadata, 'code-project.json');
			await files.writeFile(pointer, VSBuffer.fromString(JSON.stringify({ version: 1, active: version })));
			const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
			await project.restore();
			assert.strictEqual(project.modelUri?.toString(), model.toString());
			assert.strictEqual(project.projectRoot?.toString(), folder.toString());
			assert.strictEqual(project.model.id, checkoutModel.id);
			await files.writeFile(pointer, VSBuffer.fromString(JSON.stringify({ version: 1, active: '../../other' })));
			await assert.rejects(project.openProject(folder), /Invalid code project snapshot/);
			assert.strictEqual(project.modelUri?.toString(), model.toString());
		});
	}

	test('restores diagram and independent selections after a workspace restart', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.restore();
		dialogs.selected = resource;
		await project.chooseModel();
		project.showDiagram('purchase-outcome');
		project.selectElement('declined');
		project.showDiagram('cart-structure');
		project.selectElement('cart');
		await storage.flush();
		project.dispose();
		const restored = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await restored.restore();
		assert.deepStrictEqual([restored.section, restored.activeView?.id, restored.selectedId, restored.modelUri?.toString()],
			['diagram', 'cart-structure', 'cart', resource.toString()]);
		restored.showDiagram('purchase-outcome');
		assert.strictEqual(restored.selectedId, 'declined');
	});

	test('migrates M1 selection and recovers from invalid saved presentation state', async () => {
		storage.store('ordito.shell.section', 'properties', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storage.store('ordito.shell.selection', 'payment', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storage.store('ordito.shell.diagramSelections', '{broken', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.restore();
		assert.deepStrictEqual([project.section, project.activeView?.id, project.selectedId], ['diagram', 'purchase-structure', 'payment']);
	});

	test('migrates the M2.1 branch profile and gives newer presentation keys precedence', async () => {
		storage.store('ordito.visual.home', false, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storage.store('ordito.visual.context', JSON.stringify({ viewId: 'cancellation-structure', selections: { 'purchase-structure': 'payment', 'cancellation-structure': 'order' } }), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storage.store('ordito.shell.model', resource.toString(), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.restore();
		assert.deepStrictEqual([project.section, project.activeView?.id, project.selectedId, project.dirty], ['diagram', 'cancellation-structure', 'order', false]);
		project.showDiagram('purchase-structure');
		assert.strictEqual(project.selectedId, 'payment');
		await storage.flush();
		project.dispose();
		const restored = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await restored.restore();
		assert.deepStrictEqual([restored.activeView?.id, restored.selectedId], ['purchase-structure', 'payment']);
	});

	test('ignores malformed branch profile data while preserving current selections', async () => {
		storage.store('ordito.visual.context', '{', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storage.store('ordito.shell.diagram', 'purchase-outcome', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storage.store('ordito.shell.diagramSelections', JSON.stringify({ 'purchase-outcome': 'declined' }), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.restore();
		assert.deepStrictEqual([project.activeView?.id, project.selectedId, project.error], ['purchase-outcome', 'declined', undefined]);
	});

	test('system map is a restored history destination and never overwrites per-diagram selections', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.restore();
		dialogs.selected = resource;
		await project.chooseModel();
		project.showDiagram('purchase-outcome');
		project.selectElement('declined');
		project.showSystemMap();
		assert.deepStrictEqual([project.section, project.activeView, project.dirty], ['map', undefined, false]);
		project.inspectElement('payment-contract');
		project.goBack();
		assert.strictEqual(project.section, 'map');
		project.goBack();
		assert.deepStrictEqual([project.section, project.selectedId], ['diagram', 'declined']);
		project.goForward();
		dialogs.saveTarget = URI.parse('test:/map-copy.ordito.json');
		assert.strictEqual(await project.saveAs(), true);
		await storage.flush();
		project.dispose();
		const restored = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await restored.restore();
		assert.deepStrictEqual([restored.section, restored.activeView, restored.canGoBack, restored.dirty], ['map', undefined, false, false]);
		restored.showDiagram('purchase-outcome');
		assert.strictEqual(restored.selectedId, 'declined');
	});

	test('invalid documents expose diagnostics and retry recovers without writing the source', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await files.writeFile(resource, VSBuffer.fromString('{"version":99}'));
		await project.chooseModel();
		assert.ok(project.error?.includes('Model version 99 is not supported. Supported model versions are 1, 2, 3, 4 and 5.'));
		assert.strictEqual((await files.readFile(resource)).value.toString(), '{"version":99}');
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(checkoutModel)));
		await project.retry();
		assert.deepStrictEqual([project.loading, project.error, project.activeView?.id], [false, undefined, 'purchase-structure']);
	});

	test('load errors retain typed causes for the shared error component and clear them after recovery', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await files.writeFile(resource, VSBuffer.fromString('{'));
		await project.openModelResource(resource);
		assert.ok(project.errorCause instanceof SyntaxError);
		await files.writeFile(resource, VSBuffer.fromString('{"version":5,"semantics":null}'));
		await project.retry();
		assert.ok(project.errorCause instanceof InvalidSemanticModelError);
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(checkoutModel)));
		await project.retry();
		assert.deepStrictEqual([project.error, project.errorCause], [undefined, undefined]);
		await project.openModelResource(URI.parse('test:/missing.json'));
		assert.ok(project.errorCause instanceof FileOperationError && project.errorCause.fileOperationResult === FileOperationResult.FILE_NOT_FOUND);
		await project.useDemo();
		assert.deepStrictEqual([project.error, project.errorCause], [undefined, undefined]);
	});

	test('save errors retain the original filesystem cause and clear it after a successful save', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.openModelResource(resource);
		project.edit({ kind: 'rename', target: 'element', id: 'checkout-controller', name: 'Unsaved Change' });
		const error = new FileOperationError('Write permission denied', FileOperationResult.FILE_PERMISSION_DENIED);
		files.failWrite = { resource, error };
		assert.strictEqual(await project.save(), false);
		assert.deepStrictEqual([project.saveErrorCause, project.dirty], [error, true]);
		assert.ok(project.saveError?.includes(error.message));
		files.failWrite = undefined;
		assert.strictEqual(await project.save(), true);
		assert.deepStrictEqual([project.saveError, project.saveErrorCause, project.dirty], [undefined, undefined, false]);
	});

	test('a superseded asynchronous load cannot overwrite a newer document or the demo', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		const gate = new DeferredPromise<void>();
		files.delay = { resource, gate };
		dialogs.selected = resource;
		const pending = project.chooseModel();
		await Promise.resolve();
		const second = URI.parse('test:/other.ordito.json');
		await files.writeFile(second, VSBuffer.fromString(JSON.stringify({ ...checkoutModel, id: 'other', name: 'Other' })));
		dialogs.selected = second;
		await project.chooseModel();
		await gate.complete();
		await pending;
		assert.deepStrictEqual([project.model.id, project.modelUri?.toString(), project.loading], ['other', second.toString(), false]);
		files.delay = { resource, gate: new DeferredPromise<void>() };
		dialogs.selected = resource;
		const obsolete = project.chooseModel();
		await Promise.resolve();
		await project.useDemo();
		await files.delay.gate.complete();
		await obsolete;
		assert.deepStrictEqual([project.model.id, project.modelUri, project.loading, project.error], ['checkout-example', undefined, false, undefined]);
	});

	test('switching documents resets selections even when their diagram identities coincide', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await project.chooseModel();
		project.showDiagram('purchase-outcome');
		project.selectElement('declined');
		const other = URI.parse('test:/other.ordito.json');
		await files.writeFile(other, VSBuffer.fromString(JSON.stringify(checkoutModel)));
		dialogs.selected = other;
		await project.chooseModel();
		assert.deepStrictEqual([project.activeView?.id, project.selectedId], ['purchase-structure', 'customer']);
	});

	test('choosing the demo releases navigation from a pending workspace restore', async () => {
		storage.store('ordito.shell.model', resource.toString(), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const gate = new DeferredPromise<void>();
		files.delay = { resource, gate };
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		const pending = project.restore();
		try {
			await project.useDemo();
			let ready = false;
			void project.restore().then(() => { ready = true; });
			await Promise.resolve();
			assert.strictEqual(ready, true);
		} finally {
			await gate.complete();
			await pending;
		}
		assert.deepStrictEqual([project.modelUri, project.loading, project.error], [undefined, false, undefined]);
	});

	test('explicit saves report exact model changes, while layout-only and internal saves do not suggest coding', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.openModelResource(resource);
		const saved: import('../../common/modelCodeUpdate.js').SavedModelChange[] = [];
		disposables.add(project.onDidSaveModel(change => saved.push(change)));
		const original = project.model.semantics.elements[0];
		project.edit({ kind: 'rename', target: 'element', id: original.id, name: 'New responsibility' });
		await project.save(true);
		assert.deepStrictEqual(saved[0].changes.filter(change => change.collection === 'elements').map(change => ({ before: change.before, after: change.after })), [{ before: original, after: project.model.semantics.elements[0] }]);
		assert.equal(saved.length, 1);
		await project.save(true); assert.equal(saved.length, 1);
		const view = project.model.views[0], node = view.nodes[0];
		project.edit({ kind: 'position', viewId: view.id, id: node.elementId, x: node.x + 20, y: node.y + 20 });
		await project.save(true); assert.equal(saved.length, 1);
		project.edit({ kind: 'rename', target: 'element', id: original.id, name: 'Internal save' });
		await project.save(); assert.equal(saved.length, 1);
		assert.deepStrictEqual(project.lastSavedChange?.changes[0], { collection: 'elements', id: original.id, before: original, after: project.model.semantics.elements[0] });

		const reopened = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await reopened.openModelResource(resource);
		assert.deepStrictEqual(reopened.lastSavedChange, project.lastSavedChange);
		reopened.acknowledgeCodeUpdate(saved[0]);
		assert.ok(reopened.lastSavedChange, 'an older in-flight update must not acknowledge a newer save');
		reopened.acknowledgeCodeUpdate(reopened.lastSavedChange!);
		assert.strictEqual(reopened.lastSavedChange, undefined);
	});

	test('creates an empty project without overwrites, and records feature creation as one native undo transaction', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		const folder = URI.parse('test:/project');
		assert.strictEqual(await project.createProject('Checkout', folder), true);
		assert.deepStrictEqual([project.model.version, project.model.name, project.model.views.length, project.dirty], [4, 'Checkout', 0, false]);
		project.editBatch([
			{ kind: 'feature', id: 'purchase', name: 'Confirm Purchase' },
			{ kind: 'diagram', id: 'structure', featureId: 'purchase', name: 'Struttura', viewKind: 'structure' },
			{ kind: 'diagram', id: 'flow', featureId: 'purchase', name: 'Flusso', viewKind: 'activity' }
		]);
		assert.deepStrictEqual([project.model.views.length, project.dirty, project.canUndo], [2, true, true]);
		await project.undo();
		assert.deepStrictEqual([project.model.views.length, project.model.semantics.elements.length, project.dirty, project.canRedo], [0, 0, false, true]);
		await project.redo();
		assert.strictEqual(project.model.views[1].featureId, 'purchase');
		assert.strictEqual(await project.save(), true);
		const snapshot = (await files.readFile(project.modelUri!)).value.toString();
		assert.strictEqual(await project.createProject('Replacement', folder), false);
		assert.strictEqual((await files.readFile(project.modelUri!)).value.toString(), snapshot);
	});

	test('visual edits upgrade v2 only on mutation, save and reopen preserve semantic identity and layout', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await project.chooseModel();
		assert.strictEqual(project.model.version, 2);
		project.edit({ kind: 'rename', target: 'element', id: 'payment', name: 'Autorizza pagamento' });
		project.edit({ kind: 'position', viewId: 'purchase-structure', id: 'payment', x: -100, y: 260 });
		assert.deepStrictEqual([project.model.version, project.dirty], [3, true]);
		await project.undo();
		assert.strictEqual(project.model.views[0].nodes.find(node => node.elementId === 'payment')!.x, 520);
		await project.redo();
		assert.strictEqual(await project.save(), true);
		await project.retry();
		assert.deepStrictEqual([project.model.semantics.elements.find(element => element.id === 'payment')!.name, project.model.views[0].nodes.find(node => node.elementId === 'payment')!.x, project.dirty], ['Autorizza pagamento', -100, false]);
	});

	test('contract editing shares identity across details and diagrams with native undo, redo and persistence', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await project.chooseModel();
		project.inspectElement('payment-contract');
		const behavior = { inputs: [{ name: 'amount', type: 'Money', required: true }], outputs: [], preconditions: ['Amount is positive'], postconditions: [], errors: [], permissions: [], acceptanceCriteria: [] };
		project.edit({ kind: 'behavior', id: 'payment-contract', behavior });
		const edited = structuredClone(project.model);
		await project.undo();
		assert.deepStrictEqual([project.model.version, project.model.semantics.elements.find(element => element.id === 'payment-contract')!.behavior, project.dirty], [2, undefined, false]);
		await project.redo();
		assert.deepStrictEqual(project.model, edited);
		project.edit({ kind: 'include', id: 'payment-contract', viewId: 'purchase-structure' });
		project.revealElement('payment-contract', 'purchase-structure');
		assert.deepStrictEqual([project.section, project.selectedId, project.model.semantics.elements.find(element => element.id === project.selectedId)!.behavior], ['diagram', 'payment-contract', behavior]);
		await project.save();
		await project.retry();
		assert.deepStrictEqual([project.model.semantics.elements.find(element => element.id === 'payment-contract')!.behavior, project.dirty], [behavior, false]);
	});

	test('sequence order and shared messages use native undo, save, restart and context repair', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await project.chooseModel();
		project.editBatch([
			{ kind: 'diagram', id: 'sequence', name: 'Purchase Sequence', viewKind: 'sequence', featureId: 'purchase' },
			{ kind: 'sequenceMessage', viewId: 'sequence', id: 'checkout-confirm' },
			{ kind: 'sequenceMessage', viewId: 'sequence', id: 'confirm-order' }
		]);
		project.showDiagram('sequence');
		project.selectElement('checkout-controller');
		project.edit({ kind: 'sequenceOrder', viewId: 'sequence', id: 'confirm-order', target: 'message', direction: -1 });
		await project.undo();
		assert.deepStrictEqual(project.activeView!.relationIds, ['checkout-confirm', 'confirm-order']);
		await project.redo();
		project.edit({ kind: 'condition', id: 'confirm-order', condition: 'Authorized payment' });
		await project.save();
		await storage.flush();
		project.dispose();
		const restarted = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await restarted.restore();
		assert.deepStrictEqual([restarted.activeView!.kind, restarted.activeView!.relationIds, restarted.selectedId, restarted.dirty], ['sequence', ['confirm-order', 'checkout-confirm'], 'checkout-controller', false]);
		restarted.showDiagram('purchase-structure');
		assert.strictEqual(restarted.model.semantics.relations.find(relation => relation.id === 'confirm-order')!.condition, 'Authorized payment');
		restarted.showDiagram('sequence');
		restarted.edit({ kind: 'sequenceRemove', viewId: 'sequence', id: 'checkout-controller', target: 'participant' });
		assert.deepStrictEqual([restarted.activeView!.relationIds, restarted.model.semantics.elements.length, restarted.model.semantics.relations.length, restarted.selectedId], [[], checkoutModel.semantics.elements.length, checkoutModel.semantics.relations.length, 'checkout']);
	});

	test('resource state views share transitions and persist native history and repaired selection', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await project.chooseModel();
		project.editBatch([
			{ kind: 'stateDiagram', id: 'states', name: 'Order States', featureId: 'purchase', resourceId: 'order' },
			{ kind: 'stateLifecycle', viewId: 'states', resourceId: 'order' }
		]);
		await project.undo();
		assert.strictEqual(project.model.version, 2);
		await project.redo();
		project.showDiagram('states');
		project.selectElement('pending');
		project.edit({ kind: 'renameRelation', id: 'order-confirmed', name: 'Payment Accepted' });
		await project.save();
		await storage.flush();
		project.dispose();
		const restored = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await restored.restore();
		assert.deepStrictEqual([restored.activeView!.kind, restored.activeView!.relationIds, restored.selectedId, restored.dirty], ['state', ['order-confirmed', 'order-declined'], 'pending', false]);
		const semantics = structuredClone(restored.model.semantics);
		restored.edit({ kind: 'exclude', viewId: 'states', id: 'pending', target: 'element' });
		assert.deepStrictEqual([restored.model.semantics, restored.activeView!.relationIds, restored.selectedId], [semantics, [], 'order']);
		await restored.undo();
		assert.deepStrictEqual(restored.activeView!.relationIds, ['order-confirmed', 'order-declined']);
		restored.showDiagram('purchase-outcome');
		assert.strictEqual(restored.model.semantics.relations.find(relation => relation.id === 'order-confirmed')!.name, 'Payment Accepted');
	});

	test('resource creation and its state diagram are atomic when a later batch edit is invalid', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await project.chooseModel();
		const before = structuredClone(project.model);
		assert.throws(() => project.editBatch([
			{ kind: 'resource', id: 'shipment', name: 'Shipment', parentId: 'purchase' },
			{ kind: 'stateDiagram', id: 'shipment-state', name: 'Shipment States', featureId: 'missing', resourceId: 'shipment' }
		]));
		assert.deepStrictEqual([project.model, project.dirty, project.canUndo], [before, false, false]);
	});

	test('impact is a read-only navigation destination that restores through history, save copy and restart', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await project.chooseModel();
		project.showImpact('payment-contract');
		assert.deepStrictEqual([project.section, project.selectedId, project.activeView, project.dirty, project.model.version], ['impact', 'payment-contract', undefined, false, 2]);
		project.goBack();
		assert.strictEqual(project.section, 'diagram');
		project.goForward();
		assert.strictEqual(project.section, 'impact');
		project.edit({ kind: 'rename', id: 'payment-contract', target: 'element', name: 'Payment Contract Updated' });
		dialogs.saveTarget = URI.parse('test:/impact-copy.json');
		assert.strictEqual(await project.saveAs(), true);
		await storage.flush();
		project.dispose();
		const restored = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await restored.restore();
		assert.deepStrictEqual([restored.section, restored.selectedId, restored.activeView, restored.modelUri!.toString(), restored.model.semantics.elements.find(element => element.id === 'payment-contract')!.name, restored.dirty], ['impact', 'payment-contract', undefined, dialogs.saveTarget.toString(), 'Payment Contract Updated', false]);
		restored.edit({ kind: 'deleteElement', id: 'payment-contract' });
		assert.strictEqual(restored.section, 'diagram');
	});

	test('changing documents clears impact even when identities coincide and failed loads do not expose the old report', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await project.chooseModel();
		project.showImpact('payment-contract');
		const other = URI.parse('test:/other-impact.json');
		await files.writeFile(other, VSBuffer.fromString(JSON.stringify({ ...checkoutModel, id: 'other' })));
		dialogs.selected = other;
		await project.chooseModel();
		assert.deepStrictEqual([project.section, project.canGoBack, project.dirty], ['diagram', false, false]);
		project.showImpact('payment-contract');
		await files.writeFile(other, VSBuffer.fromString('{"version":99}'));
		await project.retry();
		assert.ok(project.error);
	});

	test('independent project files with overlapping IDs retain their own topology and inspector context', async () => {
		const library = URI.parse('test:/independent-library.json');
		const observatory = URI.parse('test:/independent-observatory.json');
		await files.writeFile(library, VSBuffer.fromString(JSON.stringify(libraryModel)));
		await files.writeFile(observatory, VSBuffer.fromString(JSON.stringify(observatoryModel)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = library;
		await project.chooseModel();
		assert.deepStrictEqual(project.model, libraryModel);
		project.showDiagram('states');
		project.selectElement('active');
		project.showImpact('contract');
		dialogs.saveTarget = URI.parse('test:/independent-copy.json');
		await project.saveAs();
		await storage.flush();
		project.dispose();
		const restored = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await restored.restore();
		assert.deepStrictEqual([restored.model, restored.section, restored.selectedId, restored.dirty], [libraryModel, 'impact', 'contract', false]);
		dialogs.selected = observatory;
		await restored.chooseModel();
		assert.deepStrictEqual([restored.model, restored.section, restored.activeView, restored.selectedId, restored.canGoBack], [observatoryModel, 'diagram', undefined, '', false]);
		restored.edit({ kind: 'diagram', id: 'structure', name: 'Acquisizioni', featureId: 'feature', viewKind: 'structure' });
		restored.edit({ kind: 'include', viewId: 'structure', id: 'scheduler' });
		await restored.save();
		dialogs.selected = library;
		await restored.chooseModel();
		assert.deepStrictEqual(restored.model, libraryModel);
	});

	test('empty projects create independent resource lifecycles with native undo and round-trip persistence', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.createProject('Stazione oceanografica', URI.parse('test:/marine-laboratory'));
		assert.deepStrictEqual([project.model.semantics.elements, project.model.views, project.model.codeMappings, project.model.verifications], [[], [], [], []]);
		project.editBatch([
			{ kind: 'feature', id: 'acquisition', name: 'Acquisizione' },
			{ kind: 'resource', id: 'sample', name: 'Campione', parentId: 'acquisition' },
			{ kind: 'stateDiagram', id: 'sample-states', name: 'Stati del campione', featureId: 'acquisition', resourceId: 'sample' },
			{ kind: 'element', id: 'fresh', name: 'Nuovo', elementKind: 'state', parentId: 'sample', viewId: 'sample-states' },
			{ kind: 'element', id: 'archived', name: 'Archiviato', elementKind: 'state', parentId: 'sample', viewId: 'sample-states' },
			{ kind: 'relation', id: 'archive', name: 'Archivia', relationKind: 'transition', from: 'fresh', to: 'archived', condition: 'Misura valida', viewId: 'sample-states' }
		]);
		project.showDiagram('sample-states');
		project.selectElement('archived');
		await project.undo();
		assert.strictEqual(project.model.semantics.elements.length, 0);
		await project.redo();
		await project.save();
		await project.retry();
		assert.deepStrictEqual([project.model.name, project.model.semantics.elements.map(element => element.id), project.model.semantics.relations.map(relation => relation.id), project.dirty], ['Stazione oceanografica', ['acquisition', 'sample', 'fresh', 'archived'], ['archive'], false]);
	});

	test('saving a copy preserves diagram and selections across source revert and workspace restart', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await project.chooseModel();
		project.showDiagram('cart-structure');
		project.selectElement('cart');
		project.showDiagram('purchase-outcome');
		project.selectElement('declined');
		project.edit({ kind: 'rename', target: 'element', id: 'declined', name: 'Declined in Copy' });
		const target = URI.parse('test:/copy.ordito.json');
		dialogs.saveTarget = target;
		assert.strictEqual(await project.saveAs(), true);
		await storage.flush();
		project.dispose();
		const restored = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await restored.restore();
		const outcome = { resource: restored.modelUri?.toString(), view: restored.activeView?.id, selected: restored.selectedId, dirty: restored.dirty, name: restored.model.semantics.elements.find(element => element.id === 'declined')?.name };
		restored.showDiagram('cart-structure');
		assert.deepStrictEqual({ ...outcome, otherSelection: restored.selectedId, source: JSON.parse((await files.readFile(resource)).value.toString()) },
			{ resource: target.toString(), view: 'purchase-outcome', selected: 'declined', dirty: false, name: 'Declined in Copy', otherSelection: 'cart', source: checkoutModel });
	});

	test('a completed save copy cannot reopen a project superseded during file IO', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await project.chooseModel();
		const target = URI.parse('test:/copy.ordito.json');
		dialogs.saveTarget = target;
		const started = new DeferredPromise<void>();
		const saved = new DeferredPromise<URI>();
		documents.textFiles.saveAs = async () => { started.complete(); return saved.p; };
		const copying = project.saveAs();
		await started.p;
		await project.useDemo();
		saved.complete(target);
		assert.deepStrictEqual({ result: await copying, resource: project.modelUri, loading: project.loading, model: project.model },
			{ result: false, resource: undefined, loading: false, model: checkoutModel });
	});

	test('semantic exploration reaches unplaced contracts and restores exact perspectives without dirtying the model', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await project.chooseModel();
		project.revealElement('payment', 'purchase-outcome');
		project.revealElement('payment-contract');
		assert.deepStrictEqual([project.section, project.activeView, project.selectedId, project.dirty], ['element', undefined, 'payment-contract', false]);
		project.goBack();
		assert.deepStrictEqual([project.section, project.activeView?.id, project.selectedId], ['diagram', 'purchase-outcome', 'payment']);
		project.goForward();
		project.inspectElement('purchase');
		project.revealElement('payment', 'purchase-structure');
		assert.deepStrictEqual([project.activeView?.id, project.selectedId, project.canGoForward, project.model], ['purchase-structure', 'payment', false, checkoutModel]);
	});

	test('inspector context survives save copy and restart while history remains local to the new document', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await project.chooseModel();
		project.inspectElement('payment-contract');
		project.edit({ kind: 'rename', target: 'element', id: 'payment-contract', name: 'Payment Contract' });
		dialogs.saveTarget = URI.parse('test:/copy.ordito.json');
		await project.saveAs();
		await storage.flush();
		project.dispose();
		const restored = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await restored.restore();
		assert.deepStrictEqual([restored.section, restored.selectedId, restored.activeView, restored.canGoBack, restored.model.semantics.elements.find(element => element.id === 'payment-contract')?.name,
			JSON.parse((await files.readFile(resource)).value.toString())], ['element', 'payment-contract', undefined, false, 'Payment Contract', checkoutModel]);
	});

	test('deleting inspected identities repairs context and opening another file clears navigation history', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await project.chooseModel();
		project.inspectElement('payment-contract');
		project.edit({ kind: 'deleteElement', id: 'payment-contract' });
		assert.deepStrictEqual([project.section, project.activeView?.id], ['diagram', 'purchase-structure']);
		await project.undo();
		const other = URI.parse('test:/other.ordito.json');
		await files.writeFile(other, VSBuffer.fromString(JSON.stringify({ ...checkoutModel, id: 'other' })));
		project.inspectElement('payment-contract');
		dialogs.selected = other;
		await project.chooseModel();
		assert.deepStrictEqual([project.section, project.modelUri?.toString(), project.canGoBack, project.canGoForward], ['diagram', other.toString(), false, false]);
	});

	test('correlated watcher reloads clean inspectors, preserves dirty edits and is released when leaving the document', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await project.chooseModel();
		project.inspectElement('payment-contract');
		const updated = structuredClone(checkoutModel);
		updated.semantics.elements.find(element => element.id === 'payment-contract')!.name = 'External Contract';
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(updated)));
		const changed = Event.toPromise(Event.filter(project.onDidChange, () => project.model.semantics.elements.some(element => element.name === 'External Contract')));
		files.emitWatch(resource);
		await changed;
		project.edit({ kind: 'rename', target: 'element', id: 'payment-contract', name: 'Local Contract' });
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(checkoutModel)));
		files.emitWatch(resource);
		assert.deepStrictEqual([project.section, project.selectedId, project.dirty, project.model.semantics.elements.find(element => element.id === 'payment-contract')!.name], ['element', 'payment-contract', true, 'Local Contract']);
		dialogs.choice = ConfirmResult.DONT_SAVE;
		await project.useDemo();
		assert.strictEqual(files.watcherCount, 0);
	});

	test('watcher recovers a failed new-file open without reusing selections from the previous document', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await project.chooseModel();
		project.revealElement('declined');
		const missing = URI.parse('test:/missing.ordito.json');
		dialogs.selected = missing;
		await project.chooseModel();
		assert.ok(project.error);
		await files.writeFile(missing, VSBuffer.fromString(JSON.stringify(checkoutModel)));
		const repaired = Event.toPromise(Event.filter(project.onDidChange, () => !project.loading && !project.error));
		files.emitWatch(missing);
		await repaired;
		assert.deepStrictEqual([project.activeView?.id, project.selectedId, project.canGoBack], ['purchase-structure', 'customer', false]);
	});

	test('cancelled document replacement preserves dirty edits; discard restores the original file', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		dialogs.selected = resource;
		await project.chooseModel();
		project.edit({ kind: 'rename', target: 'element', id: 'payment', name: 'Changed' });
		await project.useDemo();
		assert.deepStrictEqual([project.modelUri?.toString(), project.dirty, project.model.semantics.elements.find(element => element.id === 'payment')!.name], [resource.toString(), true, 'Changed']);
		dialogs.choice = ConfirmResult.DONT_SAVE;
		await project.useDemo();
		assert.deepStrictEqual([project.modelUri, project.dirty, project.model], [undefined, false, checkoutModel]);
		assert.deepStrictEqual(JSON.parse((await files.readFile(resource)).value.toString()), checkoutModel);
	});
	test('v4 upgrade is explicit, recoverable through native undo, and stable after save/reopen', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		const original = (await files.readFile(resource)).value.toString();
		await project.openModelResource(resource);
		assert.strictEqual(project.model.version, 2, 'opening does not migrate a legacy document');
		project.upgradeToV4();
		const upgraded = project.model;
		assert.deepStrictEqual([upgraded.version, project.dirty, project.hasStructuralErrors], [4, true, false]);
		assert.strictEqual((await files.readFile(resource)).value.toString(), original, 'migration does not save implicitly');
		await project.undo();
		assert.strictEqual(project.model.version, 2);
		await project.redo();
		assert.deepStrictEqual(project.model, upgraded);
		assert.strictEqual(await project.save(), true);
		await project.openModelResource(resource);
		assert.deepStrictEqual(project.model, upgraded);
		assert.notStrictEqual(project.readiness('checkout-controller').state, 'generationReady');
	});

	test('referentially invalid v4 drafts remain editable, saveable and recoverable without allocating new IDs', async () => {
		const model = migrateSemanticModelToV4(checkoutModel);
		model.semantics.relations.push({ id: 'draft.invalid', kind: 'dependency', from: 'checkout-controller', to: 'not-declared', name: 'Incomplete' });
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(model)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		assert.strictEqual(await project.openModelResource(resource), true);
		assert.deepStrictEqual([project.error, project.hasStructuralErrors, project.editable, project.activeView], [undefined, true, true, undefined]);
		project.edit({ kind: 'rename', target: 'element', id: 'checkout-controller', name: 'Recoverable Draft' });
		assert.strictEqual(await project.save(), true);
		await project.undo();
		assert.deepStrictEqual(project.model, model);
		await project.redo();
		const edited = project.model;
		await project.save();
		await project.openModelResource(resource);
		assert.deepStrictEqual(project.model, edited);
		assert.strictEqual(project.hasStructuralErrors, true);
	});

	for (const migrate of [migrateSemanticModelToV4, migrateSemanticModelToV5]) {
		const version = migrate(checkoutModel).version;
		test(`invalid v${version} visual changes preserve diagram context, document bytes and native undo history`, async () => {
			const model = migrate(checkoutModel), bytes = JSON.stringify(model);
			await files.writeFile(resource, VSBuffer.fromString(bytes));
			const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
			await project.openModelResource(resource);
			project.showDiagram('purchase-structure'); project.selectElement('checkout-controller');
			const document = await documents.textFiles.files.resolve(resource), revision = project.documentVersion;
			const edits: [string, VisualEdit][] = [
				['ownership', { kind: 'ownership', entry: { id: 'invalid.owner', elementId: 'checkout-controller', ownerId: 'customer', role: 'architecture' } }],
				['incompatibleRelation', { kind: 'updateRelation', id: 'checkout-confirm', from: 'cart', to: 'customer', relationKind: 'invocation', name: 'Invalid' }],
				['viewEndpoint', { kind: 'updateRelation', id: 'checkout-confirm', from: 'checkout', to: 'payment-contract', relationKind: 'invocation', name: 'Absent endpoint' }],
				['duplicateId', { kind: 'feature', id: 'purchase', name: 'Duplicate' }]
			];
			for (const [code, edit] of edits) {
				assert.throws(() => project.edit(edit), function matchesDiagnostic(error: unknown) { return error instanceof InvalidSemanticModelError && error.diagnostics.some(diagnostic => diagnostic.code === code); });
				assert.deepStrictEqual([project.model, document.textEditorModel.getValue(), project.documentVersion, project.activeView?.id, project.selectedId, project.dirty, project.canUndo, project.hasDiagramErrors], [model, bytes, revision, 'purchase-structure', 'checkout-controller', false, false, false]);
			}
			assert.strictEqual((await files.readFile(resource)).value.toString(), bytes);
		});

		test(`v${version} drafts permit existing errors and validate a coherent final batch before recording one undo`, async () => {
			const model = migrate(checkoutModel);
			model.semantics.relations.push({ id: 'draft.invalid', kind: 'dependency', from: 'checkout-controller', to: 'not-declared', name: 'Incomplete' });
			await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(model)));
			const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
			await project.openModelResource(resource);
			project.edit({ kind: 'rename', target: 'element', id: 'checkout-controller', name: 'Recoverable Draft' });
			const renamed = project.model, revision = project.documentVersion;
			assert.throws(() => project.edit({ kind: 'updateRelation', id: 'draft.invalid', from: 'checkout-controller', to: 'another-missing', relationKind: 'dependency', name: 'Still incomplete' }), function matchesDiagnostic(error: unknown) { return error instanceof InvalidSemanticModelError && error.diagnostics.some(diagnostic => diagnostic.args.includes('another-missing')); });
			assert.deepStrictEqual([project.model, project.documentVersion, project.hasDiagramErrors], [renamed, revision, true]);
			project.editBatch([
				{ kind: 'updateRelation', id: 'draft.invalid', from: 'checkout-controller', to: 'shipment', relationKind: 'dependency', name: 'Shipment dependency' },
				{ kind: 'resource', id: 'shipment', name: 'Shipment', parentId: 'purchase' }
			]);
			const repaired = project.model;
			assert.deepStrictEqual([project.error, project.hasStructuralErrors, project.hasDiagramErrors, project.activeView?.id], [undefined, false, false, 'purchase-structure']);
			await project.undo(); assert.deepStrictEqual(project.model, renamed);
			await project.undo(); assert.deepStrictEqual(project.model, model);
			await project.redo(); await project.redo(); assert.deepStrictEqual(project.model, repaired);
			await project.save(); await project.openModelResource(resource);
			assert.deepStrictEqual([project.model, project.hasDiagramErrors], [repaired, false]);
		});

		test(`v${version} draft repairs preserve unchanged diagnostics when earlier elements, relations, views and nodes are removed`, async () => {
			const model = migrate(checkoutModel);
			model.semantics.elements.unshift({ id: 'early.element', kind: 'feature', name: 'Earlier Element' });
			model.semantics.elements.find(element => element.id === 'checkout-controller')!.behavior!.inputs[0].typeId = 'missing.type';
			model.semantics.relations.unshift({ id: 'early.relation', kind: 'dependency', from: 'customer', to: 'checkout', name: 'Earlier Relationship' });
			model.semantics.relations.push({ id: 'late.relation', kind: 'dependency', from: 'checkout-controller', to: 'missing.element', name: 'Incomplete' });
			model.views.unshift({ id: 'early.view', name: 'Earlier Diagram', kind: 'structure', nodes: [], relationIds: [] });
			model.views.push({ id: 'late.view', name: 'Incomplete Diagram', kind: 'structure', nodes: ['customer', 'checkout', 'checkout-controller', 'missing.node'].map(elementId => ({ elementId, x: 0, y: 0 })), relationIds: ['checkout-confirm', 'missing.relation'] });
			await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(model)));
			const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
			await project.openModelResource(resource);
			const repairs: VisualEdit[] = [
				{ kind: 'deleteElement', id: 'early.element' },
				{ kind: 'deleteRelation', id: 'early.relation' },
				{ kind: 'deleteDiagram', id: 'early.view' },
				{ kind: 'exclude', viewId: 'late.view', id: 'customer', target: 'element' },
				{ kind: 'exclude', viewId: 'late.view', id: 'checkout-confirm', target: 'relation' }
			];
			for (const edit of repairs) { project.edit(edit); }
			assert.deepStrictEqual([project.hasDiagramErrors, project.dirty, project.model.views.at(-1)?.relationIds], [true, true, ['missing.relation']]);
			for (let index = 0; index < repairs.length; index++) { await project.undo(); }
			assert.deepStrictEqual(project.model, model);
		});

		test(`v${version} draft edits cannot add another occurrence of an existing duplicate-identity error`, async () => {
			const model = migrate(checkoutModel);
			model.semantics.elements.push({ id: 'duplicate', kind: 'feature', name: 'First' }, { id: 'duplicate', kind: 'feature', name: 'Second' });
			await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(model)));
			const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
			await project.openModelResource(resource);
			const revision = project.documentVersion;
			assert.throws(() => project.edit({ kind: 'feature', id: 'duplicate', name: 'Third' }), InvalidSemanticModelError);
			assert.deepStrictEqual([project.model, project.documentVersion, project.dirty, project.canUndo], [model, revision, false, false]);
		});
	}

	test('published v5 imports open, reload and restore without migration or source changes', async () => {
		const folder = URI.parse('test:/published-import');
		const snapshot = '11111111-1111-4111-8111-111111111111';
		const modelUri = URI.joinPath(folder, '.ordito', 'imports', snapshot, 'model.ordito.json');
		const model = migrateSemanticModelToV5(checkoutModel);
		const bytes = JSON.stringify(model);
		await files.writeFile(modelUri, VSBuffer.fromString(bytes));
		await files.writeFile(URI.joinPath(folder, '.ordito', 'code-project.json'), VSBuffer.fromString(JSON.stringify({ version: 1, active: snapshot })));
		contextFolders = [folder];
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.openProject(folder);
		await project.retry();
		assert.deepStrictEqual([project.error, project.hasStructuralErrors, project.model, project.projectRoot?.toString(), project.dirty], [undefined, false, model, folder.toString(), false]);
		await project.save();
		await storage.flush();
		project.dispose();
		const restored = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await restored.restore();
		assert.deepStrictEqual([restored.error, restored.model, (await files.readFile(modelUri)).value.toString()], [undefined, model, bytes]);
	});

	test('startup opens the published import rather than the inventory snapshot saved in the shell', async () => {
		const folder = URI.parse('test:/published-import');
		const inventorySnapshot = '11111111-1111-4111-8111-111111111111';
		const publishedSnapshot = '22222222-2222-4222-8222-222222222222';
		const inventory = URI.joinPath(folder, '.ordito', 'imports', inventorySnapshot, 'model.ordito.json');
		const published = URI.joinPath(folder, '.ordito', 'imports', publishedSnapshot, 'model.ordito.json');
		const pointer = URI.joinPath(folder, '.ordito', 'code-project.json');
		const model = migrateSemanticModelToV5(checkoutModel);
		const inventoryBytes = JSON.stringify({ ...model, views: [] });
		await files.writeFile(inventory, VSBuffer.fromString(inventoryBytes));
		await files.writeFile(published, VSBuffer.fromString(JSON.stringify(model)));
		await files.writeFile(pointer, VSBuffer.fromString(JSON.stringify({ version: 1, active: publishedSnapshot })));
		contextFolders = [folder];
		storage.store('ordito.shell.model', inventory.toString(), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storage.store('ordito.shell.section', 'home', StorageScope.WORKSPACE, StorageTarget.MACHINE);

		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.restore();

		assert.deepStrictEqual([project.modelUri?.toString(), project.section, project.activeView?.id, project.dirty], [published.toString(), 'diagram', model.views[0].id, false]);
		assert.strictEqual((await files.readFile(inventory)).value.toString(), inventoryBytes);
	});

	test('v5 reference errors remain recoverable drafts, while malformed v5 shapes are rejected', async () => {
		const model = migrateSemanticModelToV5(checkoutModel);
		model.semantics.relations.push({ id: 'draft.v5', kind: 'dependency', from: 'checkout-controller', to: 'missing', name: 'Incomplete' });
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(model)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.openModelResource(resource);
		assert.deepStrictEqual([project.error, project.hasStructuralErrors, project.editable, project.activeView], [undefined, true, true, undefined]);
		project.edit({ kind: 'rename', target: 'element', id: 'checkout-controller', name: 'Recoverable v5 Draft' });
		await project.save();
		await project.undo();
		assert.deepStrictEqual(project.model, model);
		await files.writeFile(resource, VSBuffer.fromString('{"version":5,"semantics":null}'));
		await project.revert();
		assert.ok(project.error?.includes('semantics'));
		assert.strictEqual((await files.readFile(resource)).value.toString(), '{"version":5,"semantics":null}');
	});

	test('unchanged visual edits preserve the saved document version and undo the last actual change directly', async () => {
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(nodeOrdersFixture)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.openModelResource(resource);
		const before = project.model, element = before.semantics.elements[0], version = project.documentVersion;
		project.editBatch([]); project.edit({ kind: 'rename', target: 'element', id: element.id, name: element.name });
		assert.strictEqual(project.documentVersion, version); assert.strictEqual(project.dirty, false);
		project.edit({ kind: 'rename', target: 'element', id: element.id, name: 'Actual Change' });
		const changedVersion = project.documentVersion;
		project.edit({ kind: 'rename', target: 'element', id: element.id, name: 'Actual Change' });
		assert.strictEqual(project.documentVersion, changedVersion);
		await project.undo(); assert.deepStrictEqual(project.model, before); assert.strictEqual(project.dirty, false);
	});

	test('blueprint operations and ADR revisions round-trip in one native undo transaction', async () => {
		const model = structuredClone(blueprintFixture);
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(model)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.openModelResource(resource);
		const operation = structuredClone(model.foundation.blueprint!.operations[0]); operation.name = 'submitOrder';
		const decision = structuredClone(model.foundation.decisions[0]); decision.revision = 'adr.2'; decision.record!.decision = 'Clarified rationale';
		project.editBatch([{ kind: 'blueprint', section: 'operations', entry: operation }, { kind: 'decision', entry: decision, expectedRevision: 'adr.1' }]);
		const edited = project.model;
		await project.undo(); assert.deepStrictEqual(project.model, model);
		await project.redo(); assert.deepStrictEqual(project.model, edited);
		assert.strictEqual(await project.save(), true);
		await project.openModelResource(resource); assert.deepStrictEqual(project.model, edited);
		assert.throws(() => project.edit({ kind: 'decision', entry: decision, expectedRevision: 'adr.1' }), /stale/);
		assert.deepStrictEqual(project.model, edited);
	});

	test('a required interface draft saves, reopens and can be repaired with undo', async () => {
		const model = structuredClone(blueprintFixture);
		model.foundation.blueprint!.connections = [];
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(model)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.openModelResource(resource);
		assert.deepStrictEqual([project.error, project.hasStructuralErrors, project.editable], [undefined, true, true]);
		project.edit({ kind: 'description', id: 'component.checkout', description: 'Draft responsibility' });
		assert.strictEqual(await project.save(), true); await project.openModelResource(resource);
		assert.strictEqual(project.hasStructuralErrors, true);
	});

	test('a required interface can be authored before its provider while keeping its diagram available', async () => {
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(blueprintFixture)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.openModelResource(resource);
		project.showDiagram('c4.l1');
		const port = { ...blueprintFixture.foundation.blueprint!.ports.find(port => port.id === 'port.required')!, id: 'port.pending' };
		project.edit({ kind: 'blueprint', section: 'ports', entry: port });
		assert.deepStrictEqual([project.hasStructuralErrors, project.hasDiagramErrors, project.activeView?.id], [true, false, 'c4.l1']);
		assert.ok(project.diagnostics.some(message => message.includes('has no provider connection')));
		await project.save(); await project.openModelResource(resource);
		assert.deepStrictEqual([project.hasStructuralErrors, project.hasDiagramErrors, project.activeView?.id], [true, false, 'c4.l1']);
		const connection = { ...blueprintFixture.foundation.blueprint!.connections[0], id: 'connection.pending', requiredPortId: port.id };
		project.edit({ kind: 'blueprint', section: 'connections', entry: connection });
		assert.deepStrictEqual([project.hasStructuralErrors, project.hasDiagramErrors, project.activeView?.id], [false, false, 'c4.l1']);
		await project.undo();
		assert.deepStrictEqual([project.hasStructuralErrors, project.hasDiagramErrors, project.activeView?.id], [true, false, 'c4.l1']);
	});

	test('pure predicates save, undo and reopen through the native document without replacing stable IDs', async () => {
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(nodeOrdersFixture)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.openModelResource(resource);
		const predicate = structuredClone(nodeOrdersFixture.foundation.predicates![0]); predicate.nodes[1] = { id: 'zero', kind: 'literal', typeId: 'type.quantity', value: 1 };
		project.edit({ kind: 'predicate', entry: predicate }); const edited = project.model;
		await project.undo(); assert.deepStrictEqual(project.model, nodeOrdersFixture); await project.redo();
		await project.save(); await project.openModelResource(resource); assert.deepStrictEqual(project.model, edited);
	});

	test('structural context preview is local, leaves document bytes unchanged and hides stale data', async () => {
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(nodeOrdersFixture)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.openModelResource(resource); const before = project.model;
		const packet = await project.prepareStructuralContext('operation.submit', 'Inspect the declared predicate');
		assert.deepStrictEqual([project.model, project.dirty, project.taskPreview?.seal, packet.metrics.calls], [before, false, packet.seal, 0]);
		project.edit({ kind: 'description', id: 'component.checkout', description: 'Revised responsibility' }); assert.strictEqual(project.taskPreview, undefined);
	});

	test('an unsupported future document cannot be saved through the semantic editor', async () => {
		const source = JSON.stringify({ ...checkoutModel, version: 5 });
		await files.writeFile(resource, VSBuffer.fromString(source));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		assert.strictEqual(await project.openModelResource(resource), false);
		assert.strictEqual(await project.save(), false);
		project.upgradeToV4();
		assert.strictEqual((await files.readFile(resource)).value.toString(), source);
	});

	test('first pure feature is created from an empty project with independent criteria and native undo', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.createProject('Quantity Domain', URI.parse('test:/pure-project'));
		const identity = project.model.id; await project.createPureFeature();
		assert.strictEqual(project.model.id, identity);
		assert.strictEqual(project.model.version === 4 && project.model.foundation.predicates?.length, 1);
		const criteria = JSON.parse((await files.readFile(URI.parse('test:/pure-project/.ordito/criteria.json'))).value.toString());
		assert.deepStrictEqual(criteria.cases.map((entry: { expected: boolean | null | string }) => entry.expected), [false, false, true, true, null, 'typeError', 'typeError', 'typeError']);
		await project.undo(); assert.strictEqual(project.model.semantics.elements.length, 0); await project.redo();
		const starter = project.model;
		await project.undo(); await project.createPureFeature(); assert.deepStrictEqual(project.model, starter);
		assert.deepStrictEqual(JSON.parse((await files.readFile(URI.parse('test:/pure-project/.ordito/criteria.json'))).value.toString()), criteria);
		await project.undo(); await files.del(URI.parse('test:/pure-project/.ordito/criteria.json'));
		await project.createPureFeature(); assert.deepStrictEqual(project.model, starter);
		assert.deepStrictEqual(JSON.parse((await files.readFile(URI.parse('test:/pure-project/.ordito/criteria.json'))).value.toString()), criteria);
		await project.save(); await project.openProject(URI.parse('test:/pure-project'));
		assert.strictEqual(project.model.version === 4 && project.model.foundation.predicates?.length, 1);
	});

	test('pure starter never replaces an existing specification', async () => {
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs)); await project.openModelResource(resource);
		await assert.rejects(project.createPureFeature(), /empty version 4/); assert.deepStrictEqual(project.model, checkoutModel);
	});

	test('pure starter retry preserves edited criteria and a new service never claims an existing file', async () => {
		const root = URI.parse('test:/pure-retry'), criteria = URI.joinPath(root, '.ordito', 'criteria.json');
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.createProject('Retry', root); await project.save();
		await project.createPureFeature(); await project.undo();
		await files.writeFile(criteria, VSBuffer.fromString('independent user criteria'));
		await assert.rejects(project.createPureFeature(), /criteria changed/);
		assert.strictEqual((await files.readFile(criteria)).value.toString(), 'independent user criteria');
		await project.save();
		const reopened = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await reopened.openProject(root);
		await assert.rejects(reopened.createPureFeature());
		assert.strictEqual((await files.readFile(criteria)).value.toString(), 'independent user criteria');
	});

	test('pure starter identities survive undo, save, and reopening with fresh workspace storage', async () => {
		const root = URI.parse('test:/pure-reload'), criteria = URI.joinPath(root, '.ordito', 'criteria.json');
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.createProject('Reload', root); await project.createPureFeature();
		const starter = project.model, criteriaText = (await files.readFile(criteria)).value.toString();
		await project.undo(); await project.save(); project.dispose();
		const reopened = disposables.add(new OrditoProjectService(disposables.add(new InMemoryStorageService()), files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await reopened.openProject(root); await reopened.createPureFeature();
		assert.deepStrictEqual({ model: reopened.model, criteria: (await files.readFile(criteria)).value.toString() }, { model: starter, criteria: criteriaText });
		await reopened.undo(); assert.strictEqual(reopened.model.semantics.elements.length, 0);
		await reopened.redo(); assert.deepStrictEqual(reopened.model, starter);
	});

	test('pure starter resumes interrupted criteria creation after reopening', async () => {
		const root = URI.parse('test:/pure-interrupted'), criteria = URI.joinPath(root, '.ordito', 'criteria.json');
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.createProject('Interrupted', root); await project.save();
		files.failCreate = criteria;
		await assert.rejects(project.createPureFeature(), /Interrupted criteria creation/);
		const manifest = (await files.readFile(URI.joinPath(root, '.ordito', 'pure-starter.json'))).value.toString();
		assert.strictEqual(project.model.semantics.elements.length, 0);
		files.failCreate = undefined; project.dispose();
		const reopened = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await reopened.openProject(root); await reopened.createPureFeature();
		assert.deepStrictEqual({ manifest: (await files.readFile(URI.joinPath(root, '.ordito', 'pure-starter.json'))).value.toString(), elements: reopened.model.semantics.elements.length }, { manifest, elements: 4 });
	});

	test('pure starter migrates unchanged legacy criteria without rewriting them', async () => {
		const root = URI.parse('test:/pure-legacy'), criteria = URI.joinPath(root, '.ordito', 'criteria.json');
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.createProject('Legacy', root); await project.createPureFeature();
		const criteriaText = (await files.readFile(criteria)).value.toString();
		await project.undo(); await project.save(); await files.del(URI.joinPath(root, '.ordito', 'pure-starter.json')); project.dispose();
		const reopened = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await reopened.openProject(root); await reopened.createPureFeature();
		assert.strictEqual((await files.readFile(criteria)).value.toString(), criteriaText);
		assert.strictEqual(reopened.model.version === 4 && reopened.model.foundation.predicates?.[0].id, JSON.parse(criteriaText).cases[0].predicateId);
		assert.strictEqual(await files.exists(URI.joinPath(root, '.ordito', 'pure-starter.json')), true);
	});

	test('pure starter rejects malformed or foreign provenance without changing criteria', async () => {
		const root = URI.parse('test:/pure-invalid'), criteria = URI.joinPath(root, '.ordito', 'criteria.json'), manifest = URI.joinPath(root, '.ordito', 'pure-starter.json');
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.createProject('Invalid', root); await project.createPureFeature();
		const criteriaText = (await files.readFile(criteria)).value.toString(), provenance = JSON.parse((await files.readFile(manifest)).value.toString());
		await project.undo();
		for (const invalid of ['{', JSON.stringify({ ...provenance, projectId: 'another-project' }), JSON.stringify({ ...provenance, identities: provenance.identities.slice(1) })]) {
			await files.writeFile(manifest, VSBuffer.fromString(invalid));
			await assert.rejects(project.createPureFeature(), /starter data changed or is invalid/);
			assert.deepStrictEqual({ criteria: (await files.readFile(criteria)).value.toString(), elements: project.model.semantics.elements.length }, { criteria: criteriaText, elements: 0 });
		}
	});

	test('linked sequence selections use projected participants and exact steps without manual nodes', async () => {
		const model = structuredClone(interactionFixture); model.views = [{ id: 'sequence', name: 'Checkout Sequence', kind: 'sequence', nodes: [], relationIds: [], interactionId: 'interaction.checkout' }];
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(model)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs)); await project.openModelResource(resource);
		project.showDiagram('sequence');
		for (const id of ['checkout.4', 'message.charge', 'frame.outcome', 'branch.approved']) { project.selectElement(id); assert.strictEqual(project.selectedId, id); }
		project.selectElement('unrelated'); assert.strictEqual(project.selectedId, 'branch.approved');
		project.showSystemMap(); project.goBack(); assert.strictEqual(project.selectedId, 'branch.approved');
		await project.openModelResource(resource); assert.strictEqual(project.selectedId, 'branch.approved');
		assert.strictEqual(project.dirty, false); assert.deepStrictEqual(project.model, model);
	});

	test('executable interaction edits preserve hierarchy, save, reopen and participate in native undo/redo', async () => {
		const model = structuredClone(interactionFixture); model.views = [{ id: 'sequence', name: 'Checkout Sequence', kind: 'sequence', nodes: [], relationIds: [], interactionId: 'interaction.checkout' }];
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(model)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs)); await project.openModelResource(resource);
		const interaction = structuredClone(model.foundation.interactions[0]); interaction.execution!.revision = '2';
		const frames = model.foundation.frames.filter(frame => interaction.frameIds.includes(frame.id)).map(frame => structuredClone(frame));
		const frame = frames.find(frame => frame.kind === 'alt')!; if (frame.kind === 'alt') { const node = frame.operands[0].guard!.nodes.find(node => node.kind === 'literal')!; if (node.kind === 'literal') { node.value = 'pending'; } }
		const entry = { interaction, frames, occurrences: model.foundation.occurrences.filter(call => interaction.occurrenceIds.includes(call.id)), expectedRevision: '1' };
		project.editBatch([{ kind: 'interaction', entry }, { kind: 'viewInteraction', viewId: 'sequence', interactionId: interaction.id }]); const edited = project.model;
		await project.undo(); assert.deepStrictEqual(project.model, model); await project.redo(); assert.deepStrictEqual(project.model, edited);
		await project.save(); await project.openModelResource(resource); assert.deepStrictEqual(project.model, edited); assert.throws(() => project.edit({ kind: 'interaction', entry }), /revision changed/);
	});

	test('flat machine edits save/reopen with native undo/redo and stale revision protection', async () => {
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(stateFixture)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs)); await project.openModelResource(resource);
		const entry = structuredClone(stateFixture.foundation.stateMachines![0]); entry.revision = '2'; entry.transitions[0].priority = 5;
		project.editBatch([{ kind: 'stateMachine', entry, expectedRevision: '1' }, { kind: 'viewStateMachine', viewId: 'view.lifecycle', stateMachineId: entry.id }]); const edited = project.model;
		await project.undo(); assert.deepStrictEqual(project.model, stateFixture); await project.redo(); assert.deepStrictEqual(project.model, edited); await project.save(); await project.openModelResource(resource); assert.deepStrictEqual(project.model, edited); assert.throws(() => project.edit({ kind: 'stateMachine', entry, expectedRevision: '1' }), /revision changed/);
	});

	test('messaging topology saves/reopens and uses native undo/redo with stale policy protection', async () => {
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(messagingFixture)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs)); await project.openModelResource(resource);
		const entry = structuredClone(messagingFixture.foundation.messaging![0]); entry.revision = '2'; entry.subscriptions[0].ackWaitMs = 1000;
		project.editBatch([{ kind: 'messaging', entry, expectedRevision: '1' }, { kind: 'viewMessaging', viewId: 'view.messaging', messagingId: entry.id }]); const edited = project.model;
		await project.undo(); assert.deepStrictEqual(project.model, messagingFixture); await project.redo(); assert.deepStrictEqual(project.model, edited); await project.save(); await project.openModelResource(resource); assert.deepStrictEqual(project.model, edited); assert.throws(() => project.edit({ kind: 'messaging', entry, expectedRevision: '1' }), /revision changed/);
	});

	test('task clarification uses native undo/redo, survives save/reopen, and seals the current intent in preview', async () => {
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(nodeOrdersFixture)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.openModelResource(resource);
		const entry = { id: 'task.quantity', target: { kind: 'operation' as const, id: 'operation.submit' }, revision: '1', text: 'Strict quantity rule', clarifications: [], history: [] };
		project.edit({ kind: 'taskIntent', entry });
		project.edit({ kind: 'taskIntent', expectedRevision: '1', entry: { ...entry, revision: '2', clarifications: [{ question: 'Zero?', answer: 'Reject zero' }] } });
		const edited = project.model; await project.undo(); assert.strictEqual(project.model.version === 4 && project.model.foundation.tasks![0].revision, '1');
		await project.redo(); assert.deepStrictEqual(project.model, edited); await project.save(); await project.openModelResource(resource); assert.deepStrictEqual(project.model, edited);
		const packet = await project.prepareStructuralContext('operation.submit', 'fallback'); const value = JSON.parse(packet.bytes);
		assert.deepStrictEqual(value.intent, { revision: '2', text: 'Strict quantity rule', clarifications: [{ question: 'Zero?', answer: 'Reject zero' }] });
	});

	test('runtime binding batch is one native undo, invalidates preview and survives save/reopen with Bun context', async () => {
		let serial = 0; const portable = createPureProject('Portable Quantity', () => 'portable.' + ++serial).model, operationId = portable.foundation.blueprint!.operations[0].id;
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(portable)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.openModelResource(resource); const initial = project.model; if (initial.version !== 4) { throw new Error('Expected v4'); }
		await project.prepareStructuralContext(operationId, 'Keep same business rule'); const oldSeal = project.taskPreview!.seal;
		project.editBatch(switchModelStack(initial, 'bun.esm').foundation.platform.bindings.map(entry => ({ kind: 'platformBinding', entry })));
		assert.strictEqual(project.taskPreview, undefined); const edited = project.model; await project.undo(); assert.deepStrictEqual(project.model, initial); await project.redo(); assert.deepStrictEqual(project.model, edited);
		await project.save(); await project.openModelResource(resource); const packet = await project.prepareStructuralContext(operationId, 'Keep same business rule'); assert.notStrictEqual(packet.seal, oldSeal); assert.ok(packet.bytes.includes('bun.esm')); assert.deepStrictEqual(project.model, edited);
	});

	test('Node-specific normative ADR remains binding and blocks Bun context until explicitly revised', async () => {
		await files.writeFile(resource, VSBuffer.fromString(JSON.stringify(nodeOrdersFixture)));
		const project = disposables.add(new OrditoProjectService(storage, files, dialogs, documents.textFiles, documents.textModels, workspaceContext, projectDialogs));
		await project.openModelResource(resource); const model = project.model; if (model.version !== 4) { throw new Error('Expected v4'); }
		project.editBatch(switchModelStack(model, 'bun.esm').foundation.platform.bindings.map(entry => ({ kind: 'platformBinding', entry })));
		await assert.rejects(project.prepareStructuralContext('operation.submit', 'Keep same business rule'), /decisionUnsatisfied/);
	});

});
