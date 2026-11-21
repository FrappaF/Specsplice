import { localize } from '../../../../nls.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { equals } from '../../../../base/common/objects.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { basename, dirname, isEqual, isEqualOrParent } from '../../../../base/common/resources.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ConfirmResult, IDialogService, IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { checkoutModel } from '../common/checkoutModel.js';
import { InvalidSemanticModelError, readSemanticDraft, validateSemanticModel } from '../common/modelValidation.js';
import { migrateSemanticModel } from '../common/modelLegacyMigration.js';
import { emptyFoundation } from '../common/modelFoundation.js';
import { SemanticModelService } from '../common/semanticModelService.js';
import { DiagramContext, getViewSelectionIds, normalizeDiagramContext, resolveElementLocation, SemanticLocation, SemanticNavigationHistory } from '../common/visualNavigation.js';
import { modelProjectProfile } from '../common/modelProfiles.js';
import { modelTaskIntent } from '../common/modelWorkflow.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { generateUuid, isUUID } from '../../../../base/common/uuid.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ITextFileService, IResolvedTextFileEditorModel } from '../../../services/textfile/common/textfiles.js';
import { applyVisualEdit, VisualEdit } from '../common/visualEditing.js';
import { migrateSemanticModelToV4 } from '../common/modelMigration.js';
import { getModelReadiness, type GenerationProfile } from '../common/modelReadiness.js';
import { createPureProject, type ProjectCriteria } from '../common/modelProject.js';
import { compileModelTaskContext, type ModelTaskPacket } from '../common/modelTaskContext.js';
import { compileModelContext, type ModelContextRequest } from '../common/modelContext.js';
import { diagnosticMessage, isOrditoDiagramBlockingDiagnostic } from './orditoDiagnostics.js';
import { codeUpdateContent, mergeModelCodeChanges, savedModelChanges, type ModelCodeChange, type SavedModelChange } from '../common/modelCodeUpdate.js';
import { canonicalJson, modelDigest } from '../common/modelSerialization.js';
import { type ModelDiagnostic, type SemanticModel } from '../common/modelTypes.js';
import { SaveReason } from '../../../common/editor.js';
import { isOrditoImportedModel, isOrditoMetadataDirectory, orditoImportedModelNames, resolveOrditoMetadataDirectory } from './orditoProjectFiles.js';

export const IOrditoProjectService = createDecorator<OrditoProjectService>('orditoProjectService');

interface StoredCodeUpdate {
	version: 1;
	revision: string;
	changes: ModelCodeChange[];
}

const codeUpdateStorageKey = (modelUri: string) => `ordito.codeUpdates.pending:${modelUri}`;

interface PureStarterRecord {
	version: 1;
	projectId: string;
	identities: string[];
	criteria: string;
}

/** Match existing errors by object identity when deletions shift diagnostic array positions. */
function diagnosticIdentity(model: SemanticModel, diagnostic: ModelDiagnostic): string {
	let value: unknown = model;
	const path: (string | { key: string; value: string })[] = [];
	for (const segment of diagnostic.path.split('/').slice(1)) {
		if (Array.isArray(value) && /^(0|[1-9]\d*)$/.test(segment)) {
			const entry: unknown = value[Number(segment)];
			let identity: string | { key: string; value: string } = segment;
			if (entry !== null && typeof entry === 'object') {
				for (const key of ['id', 'elementId', 'actorId', 'name']) {
					const field: unknown = Object.getOwnPropertyDescriptor(entry, key)?.value;
					if (typeof field === 'string') { identity = { key, value: field }; break; }
				}
			} else if (typeof entry === 'string') { identity = { key: 'value', value: entry }; }
			path.push(identity);
			value = entry;
		} else {
			path.push(segment);
			value = value !== null && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, segment)?.value : undefined;
		}
	}
	return JSON.stringify([diagnostic.code, path, diagnostic.args]);
}

/** Workspace-owned editable model and visual context shared by native workbench surfaces. */
export class OrditoProjectService extends Disposable {
	declare readonly _serviceBrand: undefined;
	private readonly changeEmitter = this._register(new Emitter<void>());
	readonly onDidChange = this.changeEmitter.event;
	private readonly savedEmitter = this._register(new Emitter<SavedModelChange>());
	readonly onDidSaveModel = this.savedEmitter.event;
	private savedModel: SemanticModel | undefined;
	private savedChange: SavedModelChange | undefined;
	get lastSavedChange(): SavedModelChange | undefined { return this.savedChange?.modelUri === this.modelUri?.toString() ? structuredClone(this.savedChange) : undefined; }
	acknowledgeCodeUpdate(change: SavedModelChange): void {
		if (this.savedChange?.modelUri === change.modelUri && canonicalJson(this.savedChange.changes) === canonicalJson(change.changes)) {
			this.savedChange = undefined;
			this.storageService.remove(codeUpdateStorageKey(change.modelUri), StorageScope.WORKSPACE);
		}
	}
	private silentSave = 0;
	private recordingSave: Promise<void> = Promise.resolve();
	private structuralPreview: { version: string; packet: ModelTaskPacket } | undefined;
	get taskPreview(): ModelTaskPacket | undefined { return this.structuralPreview?.version === this.documentVersion ? this.structuralPreview.packet : undefined; }
	private readonly modelDisposables = this._register(new DisposableStore());
	private readonly watchDisposables = this._register(new DisposableStore());
	private document: IResolvedTextFileEditorModel | undefined;
	private _saveError: string | undefined;
	private _saveErrorCause: unknown;
	private readonly semantics = new SemanticModelService(checkoutModel);
	private context: DiagramContext;
	private generation = 0;
	private restoring: Promise<void> | undefined;
	private initialized = false;
	private workspaceChangePending = false;
	private switchingWorkspace: Promise<void> | undefined;
	private _section: SemanticLocation['section'];
	private inspectionId = '';
	private readonly navigation = new SemanticNavigationHistory();
	private _modelUri: URI | undefined;
	private workspaceFilesPending = false;
	private _loading = false;
	private _error: string | undefined;
	private _errorCause: unknown;
	private _diagnostics: string[] = [];
	private _hasStructuralErrors = false;
	private _hasDiagramErrors = false;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IFileService private readonly fileService: IFileService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@ITextFileService private readonly textFiles: ITextFileService,
		@ITextModelService private readonly textModels: ITextModelService,
		@IWorkspaceContextService private readonly workspace: IWorkspaceContextService,
		@IDialogService private readonly dialogs: IDialogService
	) {
		super();
		// Read the M2.1 branch's presentation keys only as fallbacks for an older profile.
		let legacyContext: DiagramContext = { viewId: checkoutModel.views[0].id, selections: {} };
		try {
			const saved: DiagramContext = JSON.parse(storageService.get('ordito.visual.context', StorageScope.WORKSPACE, '{}'));
			if (saved && typeof saved.viewId === 'string' && saved.selections && typeof saved.selections === 'object' && !Array.isArray(saved.selections)) {
				legacyContext = { viewId: saved.viewId, selections: Object.fromEntries(Object.entries(saved.selections).filter(([, value]) => typeof value === 'string')) };
			}
		} catch { /* Ignore corrupt state from the read-only shell. */ }
		const section = storageService.get('ordito.shell.section', StorageScope.WORKSPACE)
			?? (storageService.getBoolean('ordito.visual.home', StorageScope.WORKSPACE, true) ? 'home' : 'diagram');
		this._section = section === 'home' || section === 'map' || section === 'element' || section === 'impact' ? section : 'diagram';
		this.inspectionId = storageService.get('ordito.shell.inspection', StorageScope.WORKSPACE, '');
		let selections: Record<string, string> = {};
		try {
			const saved: Record<string, string> = JSON.parse(storageService.get('ordito.shell.diagramSelections', StorageScope.WORKSPACE) ?? JSON.stringify(legacyContext.selections));
			if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
				selections = Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === 'string'));
			}
		} catch { /* Recover from obsolete or corrupt presentation state. */ }
		const viewId = storageService.get('ordito.shell.diagram', StorageScope.WORKSPACE, legacyContext.viewId);
		if (!Object.hasOwn(selections, viewId)) {
			selections[viewId] = storageService.get('ordito.shell.selection', StorageScope.WORKSPACE, '');
		}
		this.context = { viewId, selections };
		this.navigation.reset(this.location);
		const resource = storageService.get('ordito.shell.model', StorageScope.WORKSPACE);
		const folders = this.workspace.getWorkspace().folders;
		const active = storageService.get('ordito.project.activeRoot', StorageScope.PROFILE);
		const handoffFolder = folders.find(folder => folder.uri.toString() === active) ?? (folders.length === 1 ? folders[0] : undefined);
		const handoff = handoffFolder && storageService.get(`ordito.project.openContext:${handoffFolder.uri.toString()}`, StorageScope.PROFILE);
		// An explicit folder handoff supersedes that folder's older editor selection.
		if (resource && !handoff) {
			try {
				const candidate = URI.parse(resource);
				const owner = storageService.get('ordito.shell.workspace', StorageScope.WORKSPACE);
				if (owner === this.workspaceIdentity || this.belongsToWorkspace(candidate) || !owner && !this.workspace.getWorkspace().folders.length) { this._modelUri = candidate; }
			} catch { /* Ignore obsolete workspace URI. */ }
		}
		this._register(storageService.onWillSaveState(() => {
			storageService.store('ordito.shell.section', this._section, StorageScope.WORKSPACE, StorageTarget.MACHINE);
			storageService.store('ordito.shell.workspace', this.workspaceIdentity, StorageScope.WORKSPACE, StorageTarget.MACHINE);
			storageService.store('ordito.shell.model', this.modelUri?.toString(), StorageScope.WORKSPACE, StorageTarget.MACHINE);
			storageService.store('ordito.shell.diagram', this.context.viewId, StorageScope.WORKSPACE, StorageTarget.MACHINE);
			storageService.store('ordito.shell.diagramSelections', JSON.stringify(this.context.selections), StorageScope.WORKSPACE, StorageTarget.MACHINE);
			storageService.store('ordito.shell.inspection', this.inspectionId, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}));
		const sync = this._register(new RunOnceScheduler(() => { void this.followWorkspace(); }, 0));
		let observedWorkspace = this.workspaceIdentity;
		const changed = () => {
			if (observedWorkspace !== this.workspaceIdentity) { observedWorkspace = this.workspaceIdentity; sync.schedule(); }
		};
		if (workspace.onDidChangeWorkspaceFolders) { this._register(workspace.onDidChangeWorkspaceFolders(changed)); }
		if (workspace.onDidChangeWorkbenchState) { this._register(workspace.onDidChangeWorkbenchState(changed)); }
	}

	private get workspaceIdentity(): string { return JSON.stringify(this.workspace.getWorkspace().folders.map(folder => folder.uri.toString())); }
	private belongsToWorkspace(resource: URI): boolean { return this.workspace.getWorkspace().folders.some(folder => isEqualOrParent(resource, folder.uri)); }
	get workspaceFolder(): URI | undefined { return this.workspace.getWorkspace().folders[0]?.uri; }

	/** Follow native File > Open Folder and in-place workspace folder changes. */
	async followWorkspace(): Promise<void> {
		if (this.switchingWorkspace) { await this.switchingWorkspace; return this.followWorkspace(); }
		if (!this.workspaceChangePending && this._modelUri && this.belongsToWorkspace(this._modelUri)) { return; }
		this.switchingWorkspace = this.replaceWorkspaceProject();
		try { await this.switchingWorkspace; } finally { this.switchingWorkspace = undefined; }
	}

	private async replaceWorkspaceProject(): Promise<void> {
		// Hide the old diagram immediately, but retain a dirty document until save/discard.
		++this.generation;
		this.watchDisposables.clear();
		this.workspaceChangePending = true;
		this._loading = false;
		this._section = 'diagram';
		this.changeEmitter.fire();
		if (!await this.prepareToReplace()) { return; }
		++this.generation;
		this.modelDisposables.clear();
		this.document = undefined;
		this._modelUri = undefined;
		this.workspaceChangePending = false;
		this._error = undefined;
		this._errorCause = undefined;
		this._saveError = undefined;
		this._saveErrorCause = undefined;
		this._diagnostics = [];
		this._hasStructuralErrors = false;
		this._hasDiagramErrors = false;
		this.inspectionId = '';
		this.clearWorkspaceModel();
		try { await this.restoreWorkspaceProject(); }
		catch (error) { this._section = 'diagram'; this._errorCause = error; this._error = localize('ordito.workspace.openFailed', "Could not open the project in this folder: {0}", String(error.message ?? error)); this.changeEmitter.fire(); }
	}

	private clearWorkspaceModel(): void {
		this._hasStructuralErrors = false;
		this._hasDiagramErrors = false;
		this._diagnostics = [];
		this.semantics.replace({ version: 4, foundation: emptyFoundation(), id: generateUuid(), name: this.workspaceFolder ? basename(this.workspaceFolder) : localize('ordito.emptyWorkspace', "Workspace"), semantics: { elements: [], relations: [] }, views: [], codeMappings: [], verifications: [] });
		this.context = { viewId: '', selections: {} };
		this._section = 'home';
		this.navigation.reset(this.location);
		this.changeEmitter.fire();
	}

	get dirty(): boolean { return this.document?.isDirty() ?? false; }
	get documentVersion(): string { return `${this.modelUri?.toString() ?? ''}:${this.document?.textEditorModel.getVersionId() ?? 0}`; }
	get modelRevision(): number { return this.semantics.revision; }
	get editable(): boolean { return !!this.document && !this.document.isReadonly() && !this.loading && !this.error; }
	get saveError(): string | undefined { return this._saveError; }
	get saveErrorCause(): unknown { return this._saveErrorCause; }
	get canUndo(): boolean { return this.document?.textEditorModel.canUndo() ?? false; }
	get canRedo(): boolean { return this.document?.textEditorModel.canRedo() ?? false; }
	get section(): SemanticLocation['section'] { return this._section; }
	get modelUri(): URI | undefined { return this.workspaceChangePending ? undefined : this._modelUri; }
	/** Imported snapshots belong to the project above its metadata directory. */
	get projectRoot(): URI | undefined {
		if (!this.modelUri) { return undefined; }
		let current = dirname(this.modelUri);
		while (dirname(current).path !== current.path) {
			if (isOrditoMetadataDirectory(current)) { return dirname(current); }
			current = dirname(current);
		}
		return dirname(this.modelUri);
	}
	get restoringContext(): boolean { return !this.initialized || this._loading; }
	get loading(): boolean { return this._loading; }
	get error(): string | undefined { return this.workspaceChangePending ? localize('ordito.workspace.pending', "The workspace folder changed. Save or discard changes to the previous project before continuing. Choose Retry to continue opening the current folder.") : this._error; }
	get errorCause(): unknown { return this.workspaceChangePending ? this.error : this._errorCause; }
	get hasStructuralErrors(): boolean { return this._hasStructuralErrors; }
	get hasDiagramErrors(): boolean { return this._hasDiagramErrors; }
	get diagnostics(): readonly string[] { return this._diagnostics; }
	get model() { return this.semantics.getSnapshot(); }
	get activeView() { if (this.hasDiagramErrors) { return undefined; } return this.section === 'element' || this.section === 'impact' || this.section === 'map' ? undefined : this.model.views.find(view => view.id === this.context.viewId); }
	get selectedId(): string { return this.section === 'element' || this.section === 'impact' ? this.inspectionId : this.context.selections[this.context.viewId] ?? ''; }
	get canGoBack(): boolean { return !this.loading && !this.error && !this.hasDiagramErrors && this.navigation.canGo(this.model, -1); }
	get canGoForward(): boolean { return !this.loading && !this.error && !this.hasDiagramErrors && this.navigation.canGo(this.model, 1); }
	private get location(): SemanticLocation {
		if (this.section === 'home' || this.section === 'map') { return { section: this.section }; }
		if (this.section === 'element') { return { section: 'element', elementId: this.inspectionId }; }
		if (this.section === 'impact') { return { section: 'impact', elementId: this.inspectionId }; }
		return { section: 'diagram', viewId: this.context.viewId, ...(this.selectedId ? { elementId: this.selectedId } : {}) };
	}
	private publishNavigation(): void { this.navigation.push(this.location); this.changeEmitter.fire(); }

	/** Reveal an identity in the preferred diagram, or inspect it when no diagram contains it. */
	revealElement(id: string, viewId = this.context.viewId): boolean {
		if (this.loading || this.error) { return false; }
		const location = resolveElementLocation(this.model, id, viewId);
		if (!location) { return false; }
		this.applyLocation(location);
		this.publishNavigation();
		return true;
	}
	inspectElement(id: string): void {
		if (this.loading || this.error || !this.model.semantics.elements.some(element => element.id === id)) { return; }
		this.applyLocation({ section: 'element', elementId: id });
		this.publishNavigation();
	}
	showImpact(id = this.selectedId): void {
		if (this.loading || this.error || !this.model.semantics.elements.some(element => element.id === id)) { return; }
		this.applyLocation({ section: 'impact', elementId: id });
		this.publishNavigation();
	}
	private applyLocation(location: SemanticLocation): void {
		this._section = location.section;
		if (location.section === 'element' || location.section === 'impact') { this.inspectionId = location.elementId; }
		if (location.section === 'diagram') {
			this.context.viewId = location.viewId;
			if (location.elementId) { this.context.selections[location.viewId] = location.elementId; }
		}
	}
	goBack(): void { this.go(-1); }
	goForward(): void { this.go(1); }
	private go(direction: -1 | 1): void {
		if (this.loading || this.error) { return; }
		const location = this.navigation.go(this.model, direction);
		if (location) { this.applyLocation(location); this.changeEmitter.fire(); }
	}

	/** Called by both surfaces; restoration starts at most once. */
	restore(): Promise<void> {
		if (!this.initialized) {
			this.initialized = true;
			if (this._modelUri) {
				this.restoring = this.restoreSelectedModel(this._modelUri);
			} else {
				this.restoring = this.restoreWorkspaceProject();
				this.context = normalizeDiagramContext(this.model, this.context);
				if ((this.section === 'element' || this.section === 'impact') && !this.model.semantics.elements.some(element => element.id === this.inspectionId)) { this._section = 'diagram'; }
				this.navigation.replace(this.location);
			}
		}
		return this.restoring ?? Promise.resolve();
	}

	private async restoreSelectedModel(resource: URI): Promise<void> {
		const imports = dirname(dirname(resource));
		const metadata = dirname(imports);
		if (!isOrditoImportedModel(resource) || basename(imports) !== 'imports' || !isOrditoMetadataDirectory(metadata) || !this.belongsToWorkspace(resource)) {
			return this.loadModel(resource);
		}
		const generation = this.generation;
		let active = resource;
		try {
			active = await this.activeCodeProjectModel(await resolveOrditoMetadataDirectory(this.fileService, dirname(metadata))) ?? resource;
		} catch { /* Keep the selected document available if the project pointer is unreadable. */ }
		if (generation !== this.generation) { return; }
		if (isEqual(active, resource)) {
			await this.loadModel(resource);
		} else {
			const location = this.section === 'home' ? { section: 'diagram' as const, viewId: this.context.viewId } : this.location;
			await this.loadModel(active, { diagram: this.context, location });
		}
	}

	/** Carry the current visual document through a native folder-window reload. */
	prepareWorkspaceOpen(showFiles = false): void {
		const root = this.projectRoot;
		if (!root || !this.modelUri) { return; }
		this.storageService.store(`ordito.project.openContext:${root.toString()}`, JSON.stringify({ model: this.modelUri.toString(), diagram: this.context, location: this.location, showFiles }), StorageScope.PROFILE, StorageTarget.MACHINE);
	}

	/** A folder handoff requests the Files surface only once, after model restoration. */
	takeWorkspaceFilesRequest(): boolean {
		const pending = this.workspaceFilesPending;
		this.workspaceFilesPending = false;
		return pending;
	}

	private async restoreWorkspaceProject(): Promise<void> {
		const generation = this.generation;
		const folders = this.workspace?.getWorkspace().folders ?? [];
		const active = this.storageService.get('ordito.project.activeRoot', StorageScope.PROFILE);
		const folder = folders.find(folder => folder.uri.toString() === active) ?? (folders.length === 1 ? folders[0] : undefined);
		if (folder && generation === this.generation && !this._modelUri) {
			const key = `ordito.project.openContext:${folder.uri.toString()}`;
			const pending = this.storageService.get(key, StorageScope.PROFILE);
			if (pending) {
				this.storageService.remove(key, StorageScope.PROFILE);
				try {
					const context: { model?: string; diagram?: Partial<DiagramContext>; location?: SemanticLocation; showFiles?: boolean } = JSON.parse(pending);
					if (typeof context.model === 'string' && typeof context.diagram?.viewId === 'string' && context.diagram.selections && typeof context.diagram.selections === 'object' && !Array.isArray(context.diagram.selections)) {
						const resource = URI.parse(context.model);
						if (isEqualOrParent(resource, folder.uri)) {
							const diagram = { viewId: context.diagram.viewId, selections: Object.fromEntries(Object.entries(context.diagram.selections).filter(([, value]) => typeof value === 'string')) };
							await this.loadModel(resource, { diagram, location: { section: 'diagram', viewId: diagram.viewId } });
							if (context.location?.section === 'map') { this.showSystemMap(); }
							else if (context.location?.section === 'home') { this.showHome(); }
							else if (context.location?.section === 'element' && typeof context.location.elementId === 'string') { this.inspectElement(context.location.elementId); }
							else if (context.location?.section === 'impact' && typeof context.location.elementId === 'string') { this.showImpact(context.location.elementId); }
							this.workspaceFilesPending = context.showFiles === true;
							return;
						}
					}
				} catch { /* Ignore obsolete or corrupt handoffs and restore the folder normally. */ }
			}
		}
		const metadata = folder && await resolveOrditoMetadataDirectory(this.fileService, folder.uri);
		if (folder && metadata && (await this.fileService.exists(URI.joinPath(metadata, 'code-project.json')) || await this.fileService.exists(URI.joinPath(metadata, 'model.json'))) && generation === this.generation && !this._modelUri) {
			await this.openProject(folder.uri);
		} else if (folders.length && generation === this.generation && !this._modelUri) { this.clearWorkspaceModel(); }
	}

	showSystemMap(): void {
		if (this.loading || this.error) { return; }
		this._section = 'map';
		this.publishNavigation();
	}

	showHome(): void {
		this._section = 'home';
		this.publishNavigation();
	}

	showDiagram(viewId: string): void {
		if (this._loading || this._error || !this.model.views.some(view => view.id === viewId)) { return; }
		this.context.viewId = viewId;
		this._section = 'diagram';
		this.publishNavigation();
	}

	selectElement(elementId: string): void {
		if (!this.activeView || !getViewSelectionIds(this.model, this.activeView).includes(elementId)) { return; }
		this.context.selections[this.context.viewId] = elementId;
		this.publishNavigation();
	}

	async useDemo(): Promise<void> {
		if (!await this.prepareToReplace()) { return; }
		++this.generation;
		this.restoring = undefined;
		this.initialized = true;
		this.modelDisposables.clear();
		this.watchDisposables.clear();
		this.document = undefined;
		this._saveError = undefined;
		this._saveErrorCause = undefined;
		this._modelUri = undefined;
		this.workspaceChangePending = false;
		this._error = undefined;
		this._errorCause = undefined;
		this._loading = false;
		this._diagnostics = [];
		this._hasStructuralErrors = false;
		this._hasDiagramErrors = false;
		this.semantics.replace(checkoutModel);
		this.context = normalizeDiagramContext(checkoutModel, { viewId: '', selections: {} });
		this._section = 'diagram';
		this.inspectionId = '';
		this.navigation.reset(this.location);
		this.changeEmitter.fire();
	}

	async chooseModel(): Promise<void> {
		const resources = await this.fileDialogService.showOpenDialog({
			title: localize('ordito.choose', "Open Specsplice Model"), canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
			filters: [{ name: localize('ordito.modelFilter', "Specsplice Model"), extensions: ['json'] }]
		});
		if (resources?.[0] && await this.prepareToReplace()) {
			this.restoring = undefined;
			this._section = 'diagram';
			await this.loadModel(resources[0]);
		}
	}

	async openModelResource(resource: URI): Promise<boolean> {
		if (!await this.prepareToReplace()) { return false; }
		await this.loadModel(resource);
		return !this.error;
	}

	async retry(): Promise<void> {
		if (this.workspaceChangePending) { await this.followWorkspace(); }
		else if (this._modelUri) { await this.loadModel(this._modelUri); }
		else { await this.restoreWorkspaceProject(); }
	}

	/** Local structural disclosure only; provider/model selection is explicit before any future live task. */
	async prepareStructuralContext(operationId: string, text: string): Promise<ModelTaskPacket> {
		const model = this.model; if ((model.version !== 4 && model.version !== 5)) { throw new Error(localize('ordito.task.upgrade', "Structural context requires model version 4.")); }
		const version = this.documentVersion;
		const packet = await compileModelTaskContext(model, { version: 1, target: { kind: 'operation', id: operationId }, mode: 'analysis', profileId: modelProjectProfile(model).profile.id, intent: modelTaskIntent(model, 'operation', operationId, text), provider: { id: 'local-preview', model: 'none', configurationRevision: '1' }, baselineRevision: 'structural-preview-v1', delta: [], writeScope: { objects: [{ kind: 'operation', id: operationId }], files: [], createOperationsUnder: [] }, retrievalScope: { objects: [], files: [] }, sources: [], budget: { maxInputBytes: 196608, maxContextBytes: 262144, outputReserveBytes: 65536, overheadReserveBytes: 0 } });
		if (this.documentVersion !== version) { throw new Error(localize('ordito.task.stale', "The project changed. Prepare context again.")); }
		this.structuralPreview = { version, packet }; this.changeEmitter.fire(); return packet;
	}

	/** First authored feature and independent test data, available before any code import or chat. */
	get canCreatePureFeature(): boolean {
		return this.editable && !!this.document && (this.model.version === 4 || this.model.version === 5) && !this.model.semantics.elements.length && !!this.projectRoot;
	}

	async createPureFeature(): Promise<void> {
		if (!this.canCreatePureFeature) { throw new Error(localize('ordito.pure.empty', "Create an empty version 4 or 5 project first.")); }
		const version = this.documentVersion;
		const projectId = this.model.id, name = this.model.name;
		const metadata = await resolveOrditoMetadataDirectory(this.fileService, this.projectRoot!);
		const target = URI.joinPath(metadata, 'criteria.json');
		const manifest = URI.joinPath(metadata, 'pure-starter.json');
		const invalidStarter = () => new Error(localize('ordito.pure.invalidStarter', "The starter data changed or is invalid. Preserve it before creating another starter."));
		let prior: PureStarterRecord | undefined;
		if (await this.fileService.exists(manifest)) {
			try {
				const value: Partial<PureStarterRecord> = JSON.parse((await this.fileService.readFile(manifest, { limits: { size: 16384 } })).value.toString());
				if (value?.version !== 1 || value.projectId !== projectId || !Array.isArray(value.identities) || value.identities.length > 64 || value.identities.some(id => typeof id !== 'string' || !isUUID(id)) || new Set(value.identities).size !== value.identities.length || typeof value.criteria !== 'string') { throw invalidStarter(); }
				prior = { version: 1, projectId: value.projectId, identities: value.identities, criteria: value.criteria };
			} catch { throw invalidStarter(); }
		}
		const existingCriteria = await this.fileService.exists(target) ? (await this.fileService.readFile(target, { limits: { size: 16384 } })).value.toString() : undefined;
		const legacyIds = new Map<number, string>();
		if (!prior && existingCriteria !== undefined) {
			// Older starters have no manifest. Recover only their canonical test
			// data's references; arbitrary or edited criteria remain untouched.
			try {
				const value: Partial<ProjectCriteria> = JSON.parse(existingCriteria);
				const first = value?.cases?.[0];
				const input = first?.input && Object.keys(first.input);
				if (!first || !input || input.length !== 1 || ![first.predicateId, first.criterionId, input[0]].every(id => typeof id === 'string' && isUUID(id))) { throw invalidStarter(); }
				legacyIds.set(6, input[0]); legacyIds.set(10, first.predicateId); legacyIds.set(11, first.criterionId);
			} catch { throw invalidStarter(); }
		}
		const identities: string[] = [];
		const identity = () => {
			const id = prior ? prior.identities[identities.length] : legacyIds.get(identities.length) ?? generateUuid();
			if (!id) { throw invalidStarter(); }
			identities.push(id); return id;
		};
		const { model, criteria } = createPureProject(name, identity); model.id = projectId;
		const feature = model.semantics.elements.find(element => element.kind === 'feature')!;
		const system = model.semantics.elements.find(element => element.kind === 'system')!;
		const container = model.semantics.elements.find(element => element.kind === 'container')!;
		model.views = [{ id: identity(), name: localize('ordito.pure.structure', "Quantity Validation · Structure"), kind: 'structure', featureId: feature.id, subjectId: system.id, contextIds: [], nodes: [{ elementId: container.id, x: 80, y: 80 }], relationIds: [] }];
		const criteriaText = prior?.criteria ?? existingCriteria ?? JSON.stringify(criteria, null, '\t') + '\n';
		try {
			if (!equals(JSON.parse(criteriaText), criteria) || prior && prior.identities.length !== identities.length || new Set(identities).size !== identities.length) { throw invalidStarter(); }
		} catch { throw invalidStarter(); }
		if (version !== this.documentVersion) { throw new Error(localize('ordito.pure.stale', "The project changed while preparing the feature.")); }
		if (!prior) {
			// Publish provenance before editing the model or creating criteria so
			// interruption and reload can resume with exactly the same identities.
			await this.fileService.createFile(manifest, VSBuffer.fromString(JSON.stringify({ version: 1, projectId: model.id, identities, criteria: criteriaText } satisfies PureStarterRecord)), { overwrite: false });
		}
		if (await this.fileService.exists(target)) {
			if ((await this.fileService.readFile(target, { limits: { size: 16384 } })).value.toString() !== criteriaText) { throw new Error(localize('ordito.pure.criteriaChanged', "The starter criteria changed. Preserve them before creating another starter.")); }
		} else {
			await this.fileService.createFile(target, VSBuffer.fromString(criteriaText), { overwrite: false });
		}
		if (version !== this.documentVersion) { throw new Error(localize('ordito.pure.stale', "The project changed while preparing the feature.")); }
		this.replaceDocument(model); this.showDiagram(model.views[0].id);
	}

	/** Missing fields are computed per target and never written as a generation-ready flag. */
	readiness(targetId: string, profile?: GenerationProfile) {
		if (!profile && (this.model.version === 4 || this.model.version === 5)) { try { profile = modelProjectProfile(this.model).profile; } catch { /* Incomplete or mixed runtime remains a structural draft. */ } }
		return getModelReadiness(this.model, targetId, profile);
	}

	/** Shared initial packet compiler; callers supply a registered, trusted adapter profile. */
	prepareContext(request: ModelContextRequest) { return compileModelContext(this.model, request); }

	/** Explicit user action on the native undo stack; opening a legacy document never upgrades it. */
	upgradeToV4(): void {
		if (!this.editable || !this.document || (this.model.version === 4 || this.model.version === 5)) { return; }
		this.replaceDocument(migrateSemanticModelToV4(this.model, generateUuid));
	}

	private replaceDocument(next: object): void {
		if (!this.document) { return; }
		const text = this.document.textEditorModel;
		text.pushStackElement();
		text.pushEditOperations([], [{ range: text.getFullModelRange(), text: JSON.stringify(next, null, '\t') + '\n' }], () => null);
		text.pushStackElement();
	}

	/** Every visual edit is one transaction in the native text model's undo stack. */
	edit(edit: VisualEdit): void {
		this.editBatch([edit]);
	}

	/** Check the final transaction before touching the document; existing drafts can still be repaired. */
	editBatch(edits: readonly VisualEdit[]): void {
		if (!this.editable || !this.document) { return; }
		const current = this.model;
		const next = edits.reduce((model, edit) => applyVisualEdit(model, edit), current);
		if (equals(next, current)) { return; }
		const errors = validateSemanticModel(next).filter(isOrditoDiagramBlockingDiagnostic);
		if (errors.length) {
			const existing = new Map<string, number>();
			for (const diagnostic of validateSemanticModel(current).filter(isOrditoDiagramBlockingDiagnostic)) {
				const key = diagnosticIdentity(current, diagnostic);
				existing.set(key, (existing.get(key) ?? 0) + 1);
			}
			const introduced = errors.filter(diagnostic => {
				const key = diagnosticIdentity(next, diagnostic), count = existing.get(key) ?? 0;
				if (!count) { return true; }
				existing.set(key, count - 1);
				return false;
			});
			if (introduced.length) { throw new InvalidSemanticModelError(introduced); }
		}
		this.replaceDocument(next);
	}

	async undo(): Promise<void> { await this.document?.textEditorModel.undo(); }
	async redo(): Promise<void> { await this.document?.textEditorModel.redo(); }

	async save(suggestCodeUpdate = false): Promise<boolean> {
		if (!this.document || this._error) { return false; }
		const document = this.document;
		if (!suggestCodeUpdate) { this.silentSave++; }
		try {
			const success = await document.save();
			await this.recordingSave;
			if (document === this.document) {
				this._saveError = success ? undefined : localize('ordito.saveFailed', "The project could not be saved. Check disk changes and permissions, or save a copy.");
				this._saveErrorCause = success ? undefined : this._saveError;
				this.changeEmitter.fire();
			}
			return success;
		} catch (error) {
			if (document === this.document) {
				this._saveErrorCause = error;
				this._saveError = localize('ordito.saveError', "Could not save the project: {0}", String(error.message ?? error));
				this.changeEmitter.fire();
			}
			return false;
		} finally { if (!suggestCodeUpdate) { this.silentSave--; } }
	}

	private async recordSavedModel(resource: URI, generation: number, suggest: boolean): Promise<void> {
		const value = JSON.parse((await this.fileService.readFile(resource)).value.toString());
		const model = value.version === 4 || value.version === 5 ? readSemanticDraft(value) : migrateSemanticModel(value).model;
		if (generation !== this.generation || this.modelUri?.toString() !== resource.toString()) { return; }
		const delta = this.savedModel ? savedModelChanges(this.savedModel, model) : [];
		this.savedModel = structuredClone(model);
		if (!delta.length) { return; }
		const modelUri = resource.toString();
		const changes = mergeModelCodeChanges(this.savedChange?.modelUri === modelUri ? this.savedChange.changes : [], delta);
		const revision = changes.length ? await modelDigest(canonicalJson(codeUpdateContent(model))) : undefined;
		if (generation !== this.generation || this.modelUri?.toString() !== modelUri) { return; }
		if (revision) {
			const stored: StoredCodeUpdate = { version: 1, revision, changes };
			this.savedChange = { modelUri, model: structuredClone(model), changes };
			this.storageService.store(codeUpdateStorageKey(modelUri), JSON.stringify(stored), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} else {
			this.savedChange = undefined;
			this.storageService.remove(codeUpdateStorageKey(modelUri), StorageScope.WORKSPACE);
		}
		if (suggest && this.savedChange && !validateSemanticModel(model).some(entry => entry.severity === 'error')) { this.savedEmitter.fire(structuredClone(this.savedChange)); }
	}

	private async restoreSavedChange(resource: URI, model: SemanticModel): Promise<SavedModelChange | undefined> {
		const modelUri = resource.toString();
		const stored = this.storageService.get(codeUpdateStorageKey(modelUri), StorageScope.WORKSPACE);
		if (!stored) { return; }
		try {
			const entry: StoredCodeUpdate = JSON.parse(stored);
			const image = (value: unknown) => value === null || (typeof value === 'object' && !Array.isArray(value));
			if (entry.version === 1 && Array.isArray(entry.changes) && entry.changes.length && entry.changes.every(change => change &&
				typeof change.collection === 'string' && typeof change.id === 'string' && image(change.before) && image(change.after) && (change.before || change.after)) &&
				entry.revision === await modelDigest(canonicalJson(codeUpdateContent(model)))) {
				return { modelUri, model, changes: entry.changes };
			}
		} catch { /* Ignore obsolete or corrupt local update context. */ }
		return undefined;
	}

	async saveAs(): Promise<boolean> {
		if (!this._modelUri || !this.document || this.error) { return false; }
		const source = this._modelUri;
		const document = this.document;
		const target = await this.fileDialogService.showSaveDialog({ title: localize('ordito.saveCopy', "Save Project Copy"), defaultUri: source });
		if (!target || document !== this.document || source.toString() !== this._modelUri?.toString() || target.toString() === source.toString()) { return false; }
		const context = { diagram: { viewId: this.context.viewId, selections: { ...this.context.selections } }, location: this.location };
		const generation = this.generation;
		const saved = await this.textFiles.saveAs(source, target);
		if (!saved || generation !== this.generation || document !== this.document || source.toString() !== this._modelUri?.toString()) { return false; }
		await this.loadModel(saved, context);
		return !this.error;
	}

	async revert(): Promise<void> {
		await this.document?.revert();
		this._saveError = undefined;
		this._saveErrorCause = undefined;
		if (this._modelUri) { await this.loadModel(this._modelUri); }
	}

	private async prepareToReplace(): Promise<boolean> {
		if (!this.dirty) { return true; }
		const choice = await this.fileDialogService.showSaveConfirm([this.model.name]);
		if (choice === ConfirmResult.CANCEL) { return false; }
		if (choice === ConfirmResult.SAVE) { return this.save(); }
		await this.document?.revert();
		return true;
	}

	async createProject(name: string, folder: URI): Promise<boolean> {
		if (!name.trim()) { return false; }
		const directory = await resolveOrditoMetadataDirectory(this.fileService, folder);
		const resource = URI.joinPath(directory, 'model.json');
		if (await this.fileService.exists(resource) || await this.fileService.exists(URI.joinPath(directory, 'code-project.json'))) {
			if (!this.dialogs) { throw new Error(localize('ordito.existingProject.error', "This folder already contains a Specsplice project. Use Open Project or choose another folder.")); }
			if (!(await this.dialogs.confirm({ message: localize('ordito.existingProject', "This Folder Already Contains a Specsplice Project."), detail: localize('ordito.existingProject.detail', "Open the existing project or cancel and choose another folder. Its model will be preserved."), primaryButton: localize('ordito.existingProject.open', "Open Project") })).confirmed) { return false; }
			await this.openProject(folder);
			return !this.error;
		}
		if (!await this.prepareToReplace()) { return false; }
		const model = { version: 4, foundation: emptyFoundation(), id: generateUuid(), name, semantics: { elements: [], relations: [] }, views: [], codeMappings: [], verifications: [] };
		await this.fileService.createFolder(directory);
		await this.fileService.createFile(resource, VSBuffer.fromString(JSON.stringify(model, null, '\t') + '\n'), { overwrite: false });
		this._section = 'diagram';
		await this.loadModel(resource);
		return !this.error;
	}

	async openProject(folder: URI): Promise<void> {
		if (await this.prepareToReplace()) {
			this._section = 'diagram';
			const metadata = await resolveOrditoMetadataDirectory(this.fileService, folder);
			await this.loadModel(await this.activeCodeProjectModel(metadata) ?? URI.joinPath(metadata, 'model.json'));
		}
	}

	private async activeCodeProjectModel(metadata: URI): Promise<URI | undefined> {
		const pointer = URI.joinPath(metadata, 'code-project.json');
		if (!await this.fileService.exists(pointer)) { return undefined; }
		const value = JSON.parse((await this.fileService.readFile(pointer)).value.toString());
		if (value.version !== 1 || typeof value.active !== 'string' || !/^[a-f0-9-]{36}$/.test(value.active)) { throw new Error(localize('ordito.code.invalidPointer', "Invalid code project snapshot.")); }
		const snapshot = URI.joinPath(metadata, 'imports', value.active);
		const current = URI.joinPath(snapshot, orditoImportedModelNames[0]);
		if (await this.fileService.exists(current)) { return current; }
		const legacy = URI.joinPath(snapshot, orditoImportedModelNames[1]);
		return await this.fileService.exists(legacy) ? legacy : current;
	}

	private readDocument(document: IResolvedTextFileEditorModel): void {
		try {
			const value = JSON.parse(document.textEditorModel.getValue());
			if (value && typeof value === 'object' && Object.hasOwn(value, 'version') && ![1, 2, 3, 4, 5].includes(value.version)) {
				throw new Error(localize('ordito.unsupportedModelVersion', "Model version {0} is not supported. Supported model versions are 1, 2, 3, 4 and 5.", String(value.version)));
			}
			const draft = value?.version === 4 || value?.version === 5 ? readSemanticDraft(value) : undefined;
			const result = draft ? { model: draft, diagnostics: validateSemanticModel(draft) } : migrateSemanticModel(value);
			this.semantics.replace(result.model);
			this._hasStructuralErrors = result.diagnostics.some(item => item.severity === 'error');
			this._hasDiagramErrors = result.diagnostics.some(isOrditoDiagramBlockingDiagnostic);
			this.context = normalizeDiagramContext(result.model, this.context);
			if ((this.section === 'element' || this.section === 'impact') && !result.model.semantics.elements.some(element => element.id === this.inspectionId)) {
				this._section = 'diagram';
				this.inspectionId = '';
			}
			this.navigation.replace(this.location);
			this._diagnostics = result.diagnostics.map(diagnostic => diagnosticMessage(diagnostic, result.model));
			this._error = undefined;
			this._errorCause = undefined;
		} catch (error) {
			this._errorCause = error;
			this._error = error instanceof InvalidSemanticModelError ? error.diagnostics.map(diagnostic => diagnosticMessage(diagnostic)).join('\n')
				: localize('ordito.loadFailed', "Could not read the selected model: {0}", String(error.message ?? error));
		}
		this.changeEmitter.fire();
	}

	private async loadModel(resource: URI, copiedContext?: { diagram: DiagramContext; location: SemanticLocation }): Promise<void> {
		const generation = ++this.generation;
		let reloadRequested = false;
		this.watchDisposables.clear();
		const sameDocument = this._modelUri?.toString() === resource.toString();
		if (!sameDocument) {
			this.navigation.reset({ section: 'home' });
			this.context = copiedContext?.diagram ?? { viewId: '', selections: {} };
			this.inspectionId = '';
			if (copiedContext) { this.applyLocation(copiedContext.location); }
			else if (this.section === 'element' || this.section === 'impact') { this._section = 'diagram'; }
		}
		this.initialized = true;
		this.restoring = undefined;
		this._modelUri = resource;
		this.workspaceChangePending = false;
		this._loading = true;
		this._error = undefined;
		this._errorCause = undefined;
		this._saveError = undefined;
		this._saveErrorCause = undefined;
		this.changeEmitter.fire();
		try {
			const watcher = this.watchDisposables.add(this.fileService.createWatcher(resource, { recursive: false, excludes: [] }));
			this.watchDisposables.add(watcher.onDidChange(event => {
				if (generation !== this.generation || !event.contains(resource)) { return; }
				if (this.loading) { reloadRequested = true; }
				else { void this.reloadWatchedModel(resource, generation); }
			}));
			const document = await this.textFiles.files.resolve(resource);
			if (generation !== this.generation) { return; }
			if (!document.isResolved()) { throw new Error('Unresolved project document'); }
			const reference = await this.textModels.createModelReference(resource);
			if (generation !== this.generation) { reference.dispose(); return; }
			this.modelDisposables.clear();
			this.modelDisposables.add(reference);
			this.document = document;
			this.modelDisposables.add(document.onDidChangeContent(() => { if (generation === this.generation) { this.readDocument(document); } }));
			this.modelDisposables.add(document.onDidChangeDirty(() => this.changeEmitter.fire()));
			this.modelDisposables.add(document.onDidChangeReadonly(() => this.changeEmitter.fire()));
			this.modelDisposables.add(document.onDidSave(event => {
				this._saveError = undefined; this._saveErrorCause = undefined; this.changeEmitter.fire();
				const suggest = !this.silentSave && event.reason === SaveReason.EXPLICIT;
				this.recordingSave = this.recordingSave.then(() => this.recordSavedModel(resource, generation, suggest)).catch(() => { /* Invalid saved drafts cannot request code generation. */ });
			}));
			this.readDocument(document);
			const savedModel = structuredClone(this.model);
			this.savedModel = savedModel;
			this.savedChange = undefined;
			const savedChange = !this.error ? await this.restoreSavedChange(resource, savedModel) : undefined;
			if (generation === this.generation && this.savedModel === savedModel) { this.savedChange = savedChange; }
		} catch (error) {
			if (generation !== this.generation) { return; }
			this._errorCause = error;
			this._error = localize('ordito.loadFailed', "Could not read the selected model: {0}", String(error.message ?? error));
		} finally {
			if (generation === this.generation) {
				this._loading = false;
				this.changeEmitter.fire();
				if (reloadRequested) { void this.reloadWatchedModel(resource, generation); }
			}
		}
	}

	/** Correlated file watching also covers restored inspectors and models outside the workspace. */
	private async reloadWatchedModel(resource: URI, generation: number): Promise<void> {
		if (generation !== this.generation || this.document?.isDirty()) { return; }
		if (!this.document?.isResolved() || this.document.textEditorModel.uri.toString() !== resource.toString()) { await this.loadModel(resource); return; }
		try {
			const document = await this.textFiles.files.resolve(resource, { reload: { async: false } });
			if (generation === this.generation && document === this.document && document.isResolved() && !document.isDirty()) { this.readDocument(document); }
		} catch (error) {
			if (generation !== this.generation || this.document?.isDirty()) { return; }
			this._errorCause = error;
			this._error = localize('ordito.refreshFailed', "Could not refresh the model from disk: {0}", String(error.message ?? error));
			this.changeEmitter.fire();
		}
	}

	override dispose(): void {
		++this.generation;
		super.dispose();
	}
}

registerSingleton(IOrditoProjectService, OrditoProjectService, InstantiationType.Delayed);
