import { orditoErrorNotification } from '../browser/orditoErrors.js';
import { localize, localize2 } from '../../../../nls.js';
import { Disposable, DisposableStore, MutableDisposable, type IDisposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { URI } from '../../../../base/common/uri.js';
import { dirname, isEqualOrParent, relativePath } from '../../../../base/common/resources.js';
import { getCaseInsensitive } from '../../../../base/common/objects.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService, NotificationPriority, Severity } from '../../../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { AgentHostCodexAgentCodexHomeSettingId } from '../../../../platform/agentHost/common/agentService.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IUtilityProcessWorkerWorkbenchService } from '../../../services/utilityProcess/electron-browser/utilityProcessWorkerWorkbenchService.js';
import { IFilesConfigurationService } from '../../../services/filesConfiguration/common/filesConfigurationService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IShellEnvironmentService } from '../../../services/environment/electron-browser/shellEnvironmentService.js';
import { IOrditoProjectService, OrditoProjectService } from '../browser/orditoProjectService.js';
import { IOrditoCodeService } from '../browser/orditoCodeService.js';
import { OrditoInput } from '../browser/orditoInput.js';
import { isSourceEvidenceModel } from '../common/modelFoundation.js';
import { IOrditoProjectWorkspaceService, OrditoProjectWorkspace } from '../browser/orditoProjectWorkspace.js';
import { IOrditoOperationService, OrditoOperationService } from '../browser/orditoOperationService.js';
import { isOrditoImportedModel, orditoMetadataNames, resolveOrditoMetadataDirectory } from '../browser/orditoProjectFiles.js';
import { orditoCodeChannel, orditoCodeProtocolVersion, CliAccountState, CliRuntimeEnvironment, CodeBridgeProtocol, CodeAiProgress, CodeContext, CodeEvidence, CodeHistory, CodePreview, CodeRename, CodeRequest, CodeResolution, CodeScope, CodeSource } from '../common/codeBridge.js';

/** Native orchestration: deterministic evidence, reviewed AI proposals and recoverable paired publication. */
export class OrditoCodeService extends Disposable implements IOrditoCodeService {
	declare readonly _serviceBrand: undefined;
	readonly available = true;
	private readonly changes = this._register(new Emitter<void>());
	readonly onDidChange = this.changes.event;
	private readonly aiProgress = this._register(new Emitter<CodeAiProgress>());
	readonly onDidAiProgress = this.aiProgress.event;
	private readonly progressSubscription = this._register(new MutableDisposable<IDisposable>());
	private readonly watchers = this._register(new DisposableStore());
	context: CodeContext | undefined;
	get busy(): boolean { return this.operations.busy || this.contextLoading; }
	private contextLoading = false;
	private refreshing: Promise<void> | undefined;
	status = localize('ordito.code.initialStatus', "Sync Project Reconciles Model and Code with AI");
	changed = false;
	private channel: Promise<IChannel> | undefined;
	private observed = '';
	private contextGeneration = 0;
	private readonly bundles = new Map<string, string[]>();

	constructor(
		@IOrditoProjectService private readonly project: OrditoProjectService,
		@IUtilityProcessWorkerWorkbenchService private readonly workers: IUtilityProcessWorkerWorkbenchService,
		@IFileDialogService private readonly dialogs: IFileDialogService,
		@IQuickInputService private readonly quickInput: IQuickInputService,
		@INotificationService private readonly notifications: INotificationService,
		@IProgressService private readonly progress: IProgressService,
		@IFileService private readonly files: IFileService,
		@IEditorService private readonly editors: IEditorService,
		@IShellEnvironmentService private readonly shellEnvironment: IShellEnvironmentService,
		@IOrditoProjectWorkspaceService private readonly workspace: OrditoProjectWorkspace,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IOrditoOperationService private readonly operations: OrditoOperationService,
		@ICommandService private readonly commands: ICommandService,
		@IFilesConfigurationService private readonly filesConfiguration: IFilesConfigurationService
	) {
		super();
		this._register(operations.onDidChange(() => this.changes.fire()));
		this._register(project.onDidChange(() => { void this.refresh(); }));
		void this.refresh();
	}
	private getChannel(): Promise<IChannel> {
		return this.channel ??= this.workers.createWorker({ moduleId: 'vs/workbench/contrib/ordito/node/orditoCodeWorkerMain', type: 'ordito-code', name: localize('ordito.code.worker', "Specsplice Code Analysis") }).then(async worker => {
			this._register(worker);
			void worker.onDidTerminate.then(() => { this.channel = undefined; });
			const channel = worker.client.getChannel(orditoCodeChannel);
			try {
				const protocol = await channel.call<CodeBridgeProtocol | undefined>('protocol');
				if (protocol?.version !== orditoCodeProtocolVersion || !Array.isArray(protocol.operations) || !['exploration', 'diagramPrepare', 'diagramStep', 'diagramApprovePlan', 'codeUpdate'].every(operation => protocol.operations.includes(operation))) { throw new Error('Incompatible code bridge protocol'); }
			} catch {
				worker.dispose();
				throw new Error(localize('ordito.code.incompatibleEngine', "The Specsplice analysis engine is out of date or incompatible with this interface. For a development build, run npm run build-fast -- --client-only in the Specsplice repository, then fully quit and reopen Specsplice. For an installed application, update or reinstall the complete application."));
			}
			this.progressSubscription.value = channel.listen<CodeAiProgress>('aiProgress')(event => this.aiProgress.fire(event));
			return channel;
		}).catch(error => { this.channel = undefined; throw error; });
	}
	private async request<T>(request: CodeRequest, token = CancellationToken.None): Promise<T> {
		const channel = await this.getChannel();
		return JSON.parse(await channel.call<string>('execute', JSON.stringify(request), token));
	}
	async executeCollaboration(request: string, token = CancellationToken.None): Promise<string> {
		return (await this.getChannel()).call<string>('collaborate', { request, runtime: await this.cliRuntime() }, token);
	}
	async executeReconciliation(request: CodeRequest, token = CancellationToken.None): Promise<string> {
		const channel = await this.getChannel();
		const input = JSON.stringify(request);
		// Read-only status can inspect the journal while the active request owns the CLI environment.
		if (request.operation === 'exploration' && JSON.parse(request.request)?.action === 'status') {
			return channel.call<string>('execute', input, token);
		}
		return channel.call<string>('reconcile', { request: input, runtime: await this.cliRuntime() }, token);
	}
	private async cliRuntime(): Promise<CliRuntimeEnvironment> {
		const env = await this.shellEnvironment.getShellEnv();
		return { path: getCaseInsensitive(env, 'PATH') as string | undefined, pathExt: getCaseInsensitive(env, 'PATHEXT') as string | undefined, codexHome: this.configuration.getValue<string>(AgentHostCodexAgentCodexHomeSettingId) || getCaseInsensitive(env, 'CODEX_HOME') as string | undefined };
	}
	async checkCliAccount(provider: 'codex' | 'claude', executable: string): Promise<CliAccountState> {
		return (await this.getChannel()).call('checkCliAccount', { provider, executable, ...await this.cliRuntime() });
	}
	async resolveCli(executable: string): Promise<string | undefined> {
		const env = await this.shellEnvironment.getShellEnv();
		return (await this.getChannel()).call<string | undefined>('resolveCli', {
			executable, path: getCaseInsensitive(env, 'PATH') as string | undefined, pathExt: getCaseInsensitive(env, 'PATHEXT') as string | undefined
		});
	}
	private async run(title: string, task: (token: CancellationToken) => Promise<void>): Promise<boolean> {
		const operation = this.operations.acquire('code');
		if (!operation) { this.notifications.info(localize('ordito.code.busy', "Another Specsplice operation is running. Wait for it to finish or cancel it before running Sync.")); return false; }
		this.status = title; this.changes.fire();
		const cancellation = new CancellationTokenSource();
		try {
			await this.progress.withProgress({ location: ProgressLocation.Notification, title, cancellable: true }, () => task(cancellation.token), () => cancellation.cancel());
			if (cancellation.token.isCancellationRequested) { this.status = localize('ordito.code.cancelledOperation', "Code Operation Cancelled"); }
			else if (this.status === title) { this.status = localize('ordito.code.operationDone', "{0} · Completed", title); }
			return !cancellation.token.isCancellationRequested;
		}
		catch (error) { this.status = localize('ordito.code.failed', "Code analysis failed: {0}", String(error.message ?? error)); if (!/abort|cancel/i.test(String(error))) { this.notifications.error(orditoErrorNotification(error, 'code', this.project.model)); } return false; }
		finally { cancellation.dispose(); operation.dispose(); this.changes.fire(); }
	}
	private setContext(context: CodeContext | undefined): void {
		this.context = context; this.changed = false; this.watchers.clear();
		if (context) {
			const root = URI.file(context.sourceRoot);
			const metadataDirectories = orditoMetadataNames.map(name => URI.joinPath(root, name));
			this.watchers.add(this.files.watch(root, { recursive: true, excludes: [...orditoMetadataNames.map(name => `**/${name}/**`), '**/.git/**', '**/node_modules/**'] }));
			this.watchers.add(this.files.onDidFilesChange(event => {
				if (!this.changed && [...event.rawAdded, ...event.rawUpdated, ...event.rawDeleted].some(resource => isEqualOrParent(resource, root) && !metadataDirectories.some(directory => isEqualOrParent(resource, directory)))) { this.changed = true; this.changes.fire(); }
			}));
		}
		this.changes.fire();
	}
	private async refresh(): Promise<void> {
		const resource = this.project.modelUri;
		const key = resource?.toString() ?? '';
		if (this.project.loading || this.project.error) {
			++this.contextGeneration; this.observed = ''; this.contextLoading = false; this.refreshing = undefined; this.setContext(undefined); return;
		}
		if (key === this.observed) { await this.refreshing; return; }
		this.observed = key;
		const generation = ++this.contextGeneration;
		const current = () => this.observed === key && this.contextGeneration === generation;
		if (!resource || resource.scheme !== 'file' || !isOrditoImportedModel(resource)) { this.contextLoading = false; this.refreshing = undefined; this.status = localize('ordito.code.notLinked', "Import a Codebase to Enable Project Sync"); this.setContext(undefined); return; }
		this.contextLoading = true;
		this.status = localize('ordito.code.loadingContext', "Reading the Linked Codebase…");
		this.setContext(undefined);
		this.refreshing = (async () => {
			try {
				const context = await this.request<CodeContext>({ operation: 'inspect', snapshot: dirname(resource).fsPath });
				if (current()) { this.status = localize('ordito.code.contextReady', "Linked Codebase Ready · Sync Project Reviews the Entire Configured Scope"); this.setContext(context); }
			} catch (error) { if (current()) { this.observed = ''; this.status = orditoErrorNotification(error, 'code', this.project.model); this.setContext(undefined); } }
			finally { if (this.contextGeneration === generation) { this.contextLoading = false; this.changes.fire(); } }
		})();
		await this.refreshing;
	}
	async openContext(context: CodeContext): Promise<void> {
		await this.openContextAndConfirm(context);
	}
	private async openContextAndConfirm(context: CodeContext): Promise<boolean> {
		const sameProject = this.context?.sourceRoot === context.sourceRoot;
		const viewId = sameProject ? this.project.activeView?.id : undefined;
		const selectedId = sameProject ? this.project.selectedId : undefined;
		if (await this.project.openModelResource(URI.file(context.model))) {
			this.observed = this.project.modelUri!.toString(); this.setContext(context);
			if (context.diagramState === 'diagrams' && this.project.activeView) { this.project.showDiagram(this.project.model.views.some(view => view.id === viewId) ? viewId! : this.project.activeView.id); if (selectedId && this.project.model.semantics.elements.some(element => element.id === selectedId)) { this.project.selectElement(selectedId); } } else { this.project.showHome(); }
			await this.editors.openEditor({ resource: OrditoInput.RESOURCE, options: { pinned: true, revealIfOpened: true } });
			return true;
		}
		return false;
	}
	async importCodebase(): Promise<void> {
		const selected = await this.dialogs.showOpenDialog({ title: localize('ordito.code.import', "Import Codebase"), canSelectFiles: false, canSelectFolders: true, canSelectMany: false });
		if (!selected?.[0] || selected[0].scheme !== 'file') { return; }
		const mode = await this.quickInput.pick([
			{ label: localize('ordito.code.auto', "Structure and Available Semantic Analysis"), description: localize('ordito.code.auto.detail', "16 syntax profiles; built-in JavaScript/TypeScript compiler; optional SCIP indexes"), syntaxOnly: false },
			{ label: localize('ordito.code.syntax', "Structure Only"), description: localize('ordito.code.syntax.detail', "Declarations and textual contracts; references stay unresolved"), syntaxOnly: true }
		], { title: localize('ordito.code.import', "Import Codebase"), placeHolder: localize('ordito.code.accountFree', "Local deterministic analysis. No account or AI is required.") });
		if (!mode) { return; }
		const opened: { context?: CodeContext } = {};
		const completed = await this.run(localize('ordito.code.importing', "Importing Codebase"), async token => {
			const context = await this.request<CodeContext>({ operation: 'import', root: selected[0].fsPath, syntaxOnly: mode.syntaxOnly }, token);
			if (!token.isCancellationRequested && await this.openContextAndConfirm(context)) { opened.context = context; }
		});
		const context = opened.context;
		if (completed && context && this.context?.snapshot === context.snapshot && this.context.model === context.model && this.context.sourceRoot === context.sourceRoot && this.project.modelUri?.toString() === URI.file(context.model).toString()) { await this.workspace.align(); }
	}
	async ensureProjectContext(): Promise<boolean> {
		await this.refreshing;
		if (this.busy) { return false; }
		if (this.context) { return true; }
		const root = this.project.projectRoot, resource = this.project.modelUri;
		if (!root || !resource) { await this.importCodebase(); return !!this.context; }
		if (root.scheme !== 'file' || resource.scheme !== 'file' || !await this.project.save() || this.project.modelUri?.toString() !== resource.toString()) { return false; }
		const modelFile = relativePath(root, resource);
		if (!modelFile) { return false; }
		await this.run(localize('ordito.code.indexingProject', "Reading the Current Project Codebase"), async token => {
			const context = await this.request<CodeContext>({ operation: 'import', root: root.fsPath, modelFile }, token);
			if (this.project.modelUri?.toString() === resource.toString()) { await this.openContext(context); }
		});
		return !!this.context;
	}
	async sync(direction?: 'model' | 'code'): Promise<void> {
		if (this.project.model.version === 5 && this.context && direction !== 'model' && this.configuration.getValue<boolean>('ordito.diagramImport.incremental') !== false) { await this.commands.executeCommand(this.context.diagramState === 'diagrams' ? 'ordito.ai.updateDiagrams' : 'ordito.ai.resumeDiagrams'); return; }
		if ((this.project.model.version === 4 || this.project.model.version === 5)) { this.notifications.info(localize('ordito.code.v4Profile', "Legacy Sync Is Unavailable for This Model Format. Use Architecture Exploration for Imported Diagrams, or Prepare Model to Code Review for Executable Project Specifications. You Can Continue Editing and Saving the Draft.")); return; }
		await this.refreshing;
		if (this.busy) { this.notifications.info(localize('ordito.code.syncBusy', "Wait for the active Specsplice operation to finish before preparing Sync.")); return; }
		if (!this.context) {
			this.status = localize('ordito.code.noLinkedProject', "No Codebase Is Linked. Import the Project Folder Before Running Sync.");
			this.notifications.info(this.status); this.changes.fire();
			await this.importCodebase();
			return;
		}
		await this.reviewSync([], this.context?.scope, [], undefined, direction);
	}
	private async openSyncReport(root: string, token: string, name: string, contents: string): Promise<void> {
		const identity = /^[\w-]+$/.test(token) ? token : generateUuid();
		const resource = URI.joinPath(await resolveOrditoMetadataDirectory(this.files, URI.file(root)), 'reports', identity, name);
		await this.files.createFolder(URI.joinPath(resource, '..'));
		await this.files.writeFile(resource, VSBuffer.fromString(contents + '\n'));
		await this.filesConfiguration.updateReadonly(resource, { value: localize('ordito.code.review.readonly', "This is a saved Sync review. Prepare a new context to change its inputs.") });
		await this.editors.openEditor({ resource, options: { pinned: true, override: 'default' } });
	}
	private async reviewSync(renames: CodeRename[] = [], scope = this.context?.scope, resolutions: CodeResolution[] = [], reviewed?: CodePreview, direction?: 'model' | 'code'): Promise<void> {
		const current = this.context;
		if (!current || this.busy) { this.notifications.info(localize('ordito.code.syncBusy', "Wait for the active Specsplice operation to finish before preparing Sync.")); return; }
		if (current.diagramState === 'index' || isSourceEvidenceModel(this.project.model) || !this.project.model.views.some(view => view.nodes.length > 0)) {
			await this.commands.executeCommand('ordito.ai.buildDiagrams');
			return;
		}
		if (this.project.dirty && !await this.project.save()) { return; }
		const version = this.project.documentVersion;
		let preview: CodePreview | undefined = reviewed;
		if (!preview) { await this.run(localize('ordito.code.preparing', "Preparing Reconciliation Evidence"), async token => { preview = await this.request<CodePreview>({ operation: 'preview', snapshot: current.snapshot, scope, renames, bundles: this.bundles.get(current.sourceRoot) }, token); }); }
		if (!preview) { return; }
		const result = preview;
		if (direction && result.reconciliation?.status === 'aligned') { this.notifications.info(localize('ordito.code.noChanges', "Diagrams and Code Are Already Aligned.")); return; }
		if (direction && !reviewed && !result.conflicts.length) {
			const proposal = await this.commands.executeCommand<CodePreview | undefined>('ordito.ai.reconcile', result, resolutions, direction);
			if (proposal && version === this.project.documentVersion && this.context?.snapshot === current.snapshot) { await this.reviewSync(renames, scope, resolutions, proposal, direction); }
			return;
		}
		const states = {
			aligned: localize('ordito.code.aligned', "Aligned · No Semantic or Source Changes"),
			pending: localize('ordito.code.pending', "Pending · Review the AI Reconciliation"),
			conflict: localize('ordito.code.conflict', "In Conflict · Resolve Changes Before Applying"),
			verificationFailed: localize('ordito.code.verificationFailed', "Verification Failed · Review the Evidence and Retry")
		};
		this.status = result.reconciliation ? states[result.reconciliation.status] : localize('ordito.code.previewReady', "Sync Preview Ready · Review Changes Before Applying");
		this.changes.fire();
		const summary = localize('ordito.code.summary', "Files: {0} added, {1} changed, {2} removed; {3} parsed, {4} reused. Symbols: +{5} / ~{6} / −{7}. Dependencies: +{8} / ~{9} / −{10}. Review {11} views.", result.files.added.length, result.files.changed.length, result.files.removed.length, result.parsed.length, result.reused.length, result.declarations.added.length, result.declarations.changed.length, result.declarations.removed.length, result.dependencies.added.length, result.dependencies.changed.length, result.dependencies.removed.length, result.impact.viewIds.length);
		const options: (IQuickPickItem & { action: string })[] = [];
		if (!result.ai || result.reconciliation?.status === 'verificationFailed' && !result.ai.questions.length) { options.push({ label: localize('ordito.code.proposeAI', "Review Sync Context"), detail: localize('ordito.code.proposeAI.detail', "No AI Request Yet"), action: 'ai' }); }
		if (result.ai && !result.ai.questions.length && result.reconciliation?.status === 'pending') { options.push({ label: direction === 'model' ? localize('ordito.code.applyCode', "Apply Code Changes") : localize('ordito.code.apply', "Apply Sync"), description: localize('ordito.code.applyFiles', "Files: {0}", new Set(result.reconciliation.sourceEdits.map(edit => edit.file)).size), detail: localize('ordito.code.runtimeTestsNotRun', "Runtime Tests Not Run"), action: 'apply' }); }
		if (result.ai?.sourceEdits.length) { options.push({ label: localize('ordito.code.inspectDiff', "Inspect Code Changes"), action: 'diff' }); }
		if (result.conflicts.length) { options.push({ label: localize('ordito.code.blocked', "Sync Blocked — Review Conflicts"), detail: result.conflicts.map(item => `${item.code}: ${item.path}`).join('; '), action: 'conflicts' }); }
		if (result.ai?.questions.length || result.reconciliation?.diagnostics.length) { options.push({ label: localize('ordito.code.questions', "Questions and Validation"), detail: [result.ai?.questions.length ? localize('ordito.code.questionCount', "Questions: {0}", result.ai.questions.length) : '', result.reconciliation?.diagnostics.length ? localize('ordito.code.diagnosticCount', "Diagnostics: {0}", result.reconciliation.diagnostics.length) : ''].filter(Boolean).join(' · '), action: 'questions' }); }
		if (result.ai?.questions.length) { options.push({ label: localize('ordito.code.clarify', "Answer Sync Questions"), detail: localize('ordito.code.clarify.detail', "No AI Request Yet"), action: 'clarify' }); }
		if (result.declarations.removed.length && result.declarations.added.length) { options.push({ label: localize('ordito.code.rename', "Confirm a Symbol Rename"), detail: localize('ordito.code.rename.detail', "Choose the previous and current declaration to preserve its identity."), action: 'rename' }); }
		options.push({ label: localize('ordito.code.coverage', "Coverage and Evidence"), detail: localize('ordito.code.coverageCounts', "Files: {0} · Views: {1}", result.context.files.length, result.impact.viewIds.length), action: 'inspect' }, { label: localize('ordito.code.cancel', "Cancel"), action: 'cancel' });
		const choice = await this.quickInput.pick(options, { ignoreFocusLost: true, title: direction === 'model' ? localize('ordito.code.reviewCode', "Review Code Changes") : localize('ordito.code.preview', "Sync Preview"), placeHolder: localize('ordito.code.chooseReview', "Choose a Review") });
		if (choice?.action === 'diff') {
			const edits = result.ai?.sourceEdits as { file: string; search: string; replacement: string }[];
			const codeBlock = (text: string) => {
				const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)));
				return `${fence}\n${text}\n${fence}`;
			};
			const contents = ['# ' + localize('ordito.code.diff.title', "Sync Code Changes"), result.ai?.summary, ...edits.flatMap(edit => [`## ${edit.file}`, '### ' + localize('ordito.code.before', "Before"), codeBlock(edit.search), '### ' + localize('ordito.code.after', "After"), codeBlock(edit.replacement)])].join('\n\n');
			await this.openSyncReport(current.sourceRoot, result.token, localize('ordito.code.diff.file', "Sync Code Changes.md"), contents);
			await this.reviewSync(renames, scope, resolutions, result, direction);
		} else if (choice?.action === 'ai') {
			const proposal = await this.commands.executeCommand<CodePreview | undefined>('ordito.ai.reconcile', result, resolutions, direction);
			if (proposal && version === this.project.documentVersion && this.context?.snapshot === current.snapshot) { await this.reviewSync(renames, scope, resolutions, proposal, direction); }
		} else if (choice?.action === 'questions') {
			const contents = ['# ' + localize('ordito.code.questions.title', "Sync Questions and Validation"), '## ' + localize('ordito.code.questions.open', "Open Questions"), (result.ai?.questions ?? []).map(question => `- ${question}`).join('\n') || localize('ordito.code.questions.none', "No Open Questions."), '## ' + localize('ordito.code.questions.validation', "Validation Results"), (result.reconciliation?.diagnostics ?? []).map(diagnostic => `- ${diagnostic}`).join('\n') || localize('ordito.code.questions.noDiagnostics', "No Validation Diagnostics Reported.")].join('\n\n');
			await this.openSyncReport(current.sourceRoot, result.token, localize('ordito.code.questions.file', "Sync Questions and Validation.md"), contents);
			await this.reviewSync(renames, scope, resolutions, result, direction);
		} else if (choice?.action === 'clarify') {
			const proposal = await this.commands.executeCommand<CodePreview | undefined>('ordito.ai.reconcile', result, resolutions, direction);
			if (proposal && this.context?.snapshot === current.snapshot) { await this.reviewSync(renames, scope, resolutions, proposal, direction); }
		} else if (choice?.action === 'rename') {
			const old = await this.quickInput.pick(current.declarations.filter(item => result.declarations.removed.includes(item.id)).map(item => ({ label: item.name, description: item.evidence.file, declaration: item })), { ignoreFocusLost: true, title: localize('ordito.code.rename.old', "Choose the Previous Declaration") });
			if (!old) { return; }
			const next = await this.quickInput.pick(result.context.declarations.filter(item => result.declarations.added.includes(item.id) && item.kind === old.declaration.kind).map(item => ({ label: item.name, description: item.evidence.file, declaration: item })), { ignoreFocusLost: true, title: localize('ordito.code.rename.new', "Choose the Renamed Declaration") });
			if (next) { await this.reviewSync([...renames, { fromId: old.declaration.id, toSourceId: next.declaration.sourceId }], scope, [], undefined, direction); }
		} else if (choice?.action === 'apply') {
			if (version !== this.project.documentVersion || this.context?.snapshot !== current.snapshot) { this.notifications.warn(localize('ordito.code.stale', "The model changed. Run Sync again to review a fresh preview.")); return; }
			await this.run(localize('ordito.code.applying', "Reconciling Model and Code"), async token => { await this.openContext(await this.request<CodeContext>({ operation: 'apply', token: result.token }, token)); this.status = localize('ordito.code.synced', "Aligned · Project Synced · {0}", summary); this.notifications.notify({ severity: Severity.Info, message: localize('ordito.code.syncedQuiet', "Code and Diagrams Updated"), priority: NotificationPriority.SILENT }); });
		} else if (choice?.action === 'conflicts') {
			const labels: Record<string, string> = {
				manualEdit: localize('ordito.code.conflict.manual', "Your Model Edits Overlap the Source Update"),
				identityAmbiguity: localize('ordito.code.conflict.identity', "Symbol Identity Is Ambiguous"),
				incompleteSource: localize('ordito.code.conflict.source', "Source Analysis Is Incomplete"),
				invalidModel: localize('ordito.code.conflict.model', "The Updated Model Would Be Invalid"),
				incompleteSemantic: localize('ordito.code.conflict.semantic', "Refresh the Attached Semantic Indexes"),
				concurrentContract: localize('ordito.code.conflict.contract', "Model and Code Changed the Same Contract")
			};
			const conflict = await this.quickInput.pick(result.conflicts.map(item => ({ label: labels[item.code] ?? item.code, description: item.path, detail: localize('ordito.code.conflict.values', "Common: {0}\nModel: {1}\nCode: {2}", item.base ?? '', item.current ?? '', item.incoming ?? ''), conflict: item })), { title: localize('ordito.code.conflicts', "Sync Conflicts"), ignoreFocusLost: true, matchOnDescription: true, matchOnDetail: true });
			if (conflict) {
				const resolution = await this.quickInput.pick([
					{ label: localize('ordito.code.chooseModel', "Preserve Model Intent"), choice: 'model' as const },
					{ label: localize('ordito.code.chooseCode', "Preserve Code Behavior"), choice: 'code' as const }
				], { title: localize('ordito.code.resolve', "Choose the Intent for the AI Proposal"), placeHolder: conflict.description, ignoreFocusLost: true });
				if (resolution) { await this.reviewSync(renames, scope, [...resolutions.filter(item => item.path !== conflict.conflict.path), { path: conflict.conflict.path, choice: resolution.choice }], result, direction); }
			}
		} else if (choice?.action === 'inspect') { await this.showEvidence(result.context); }
		else { this.status = localize('ordito.code.cancelled', "Sync Cancelled · Model Unchanged"); this.changes.fire(); }
	}
	private async reviewInventory(scope: CodeScope, bundles?: string[]): Promise<void> {
		const current = this.context;
		if (!current || this.busy || this.project.dirty && !await this.project.save()) { return; }
		const version = this.project.documentVersion;
		let preview: CodePreview | undefined;
		await this.run(localize('ordito.code.inventoryPreparing', "Preparing Source Inventory Preview"), async token => { preview = await this.request<CodePreview>({ operation: 'preview', snapshot: current.snapshot, scope, inventoryOnly: true, bundles: bundles ?? this.bundles.get(current.sourceRoot) }, token); });
		if (!preview) { return; }
		const result = preview;
		const summary = localize('ordito.code.inventorySummary', "Files: +{0} / ~{1} / −{2}; {3} moved. Symbols: +{4} / ~{5} / −{6}. Dependencies: +{7} / ~{8} / −{9}. {10} files parsed; {11} reused. Include: {12}. Exclude: {13}.", result.files.added.length, result.files.changed.length, result.files.removed.length, result.files.renamed?.length ?? 0, result.declarations.added.length, result.declarations.changed.length, result.declarations.removed.length, result.dependencies.added.length, result.dependencies.changed.length, result.dependencies.removed.length, result.parsed.length, result.reused.length, scope.include.join(', ') || localize('ordito.code.noSources', "None (No Source Paths)"), scope.exclude.join(', ') || localize('ordito.code.none', "None"));
		let choice: { action: string } | undefined;
		do {
			choice = await this.quickInput.pick([
				{ label: localize('ordito.code.inventoryApply', "Apply Source Inventory"), detail: localize('ordito.code.inventoryApply.detail', "Save a new analysis snapshot. Authored diagrams and source files are preserved."), action: 'apply' },
				{ label: localize('ordito.code.coverage', "Coverage and Evidence"), detail: summary, action: 'inspect' },
				{ label: localize('ordito.code.cancel', "Cancel"), action: 'cancel' }
			], { title: localize('ordito.code.inventoryPreview', "Source Inventory Preview"), placeHolder: summary, ignoreFocusLost: true });
			if (choice?.action === 'inspect') { await this.showEvidence(result.context); }
		} while (choice?.action === 'inspect');
		if (choice?.action !== 'apply') { return; }
		if (version !== this.project.documentVersion || this.context?.snapshot !== current.snapshot) { this.notifications.warn(localize('ordito.code.inventoryStale', "The project changed. Prepare a fresh source inventory preview.")); return; }
		await this.run(localize('ordito.code.inventoryApplying', "Updating Source Inventory"), async token => { await this.openContext(await this.request<CodeContext>({ operation: 'apply', token: result.token }, token)); if (bundles) { this.bundles.set(current.sourceRoot, bundles); } });
	}
	async configure(): Promise<void> {
		const context = this.context;
		if (!context || this.busy) { return; }
		const include = await this.quickInput.input({ title: localize('ordito.code.scope.include', "Include Source Paths"), prompt: localize('ordito.code.scope.glob', "Comma-separated glob patterns relative to the codebase. Leave empty to include no source paths."), value: context.scope.include.join(', ') });
		if (include === undefined) { return; }
		const exclude = await this.quickInput.input({ title: localize('ordito.code.scope.exclude', "Exclude Source Paths"), prompt: localize('ordito.code.scope.ignore', "Comma-separated Git ignore patterns; .gitignore and .orditoignore also apply"), value: context.scope.exclude.join(', ') });
		if (exclude === undefined) { return; }
		const patterns = (text: string) => text.split(',').map(item => item.trim()).filter(Boolean);
		const scope = { ...context.scope, include: patterns(include), exclude: patterns(exclude) };
		if (context.diagramState === 'index' || this.project.model.version === 4 || this.project.model.version === 5 || isSourceEvidenceModel(this.project.model)) { await this.reviewInventory(scope); }
		else { await this.reviewSync([], scope); }
	}
	async attachIndex(): Promise<void> {
		const context = this.context;
		if (!context || this.busy) { return; }
		const paths = await this.dialogs.showOpenDialog({ title: localize('ordito.code.index', "Attach Fresh SCIP Bundles"), canSelectFiles: true, canSelectFolders: false, canSelectMany: true, filters: [{ name: localize('ordito.code.scipFilter', "SCIP JSON"), extensions: ['json'] }] });
		if (!paths?.length || paths.some(path => path.scheme !== 'file')) { return; }
		const bundles = paths.map(path => path.fsPath);
		if (context.diagramState === 'index' || this.project.model.version === 4 || this.project.model.version === 5 || isSourceEvidenceModel(this.project.model)) { await this.reviewInventory(context.scope, bundles); }
		else { this.bundles.set(context.sourceRoot, bundles); await this.sync(); }
	}
	async recover(): Promise<void> {
		const context = this.context;
		if (!context || this.busy) { return; }
		const history = await this.request<CodeHistory>({ operation: 'history', snapshot: context.snapshot });
		const interrupted = history.operations?.filter(item => item.status === 'reconciling' || item.status === 'undoing') ?? [];
		if (interrupted.length) {
			const operation = await this.quickInput.pick(interrupted.map(item => ({ label: item.created, description: item.origin, id: item.id })), { title: localize('ordito.code.recoverTransaction', "Recover Interrupted Reconciliation"), ignoreFocusLost: true });
			if (operation) { await this.run(localize('ordito.code.recoveringTransaction', "Recovering Model and Source Changes"), async token => { await this.openContext(await this.request<CodeContext>({ operation: 'recoverSync', snapshot: context.snapshot, id: operation.id }, token)); }); }
			return;
		}
		const choice = await this.quickInput.pick(history.snapshots.filter(item => item.directory !== context.snapshot).map(item => ({ label: item.created ? new Date(item.created).toLocaleString() : item.directory.split(/[\\/]/).pop()!, description: item.files === undefined ? item.revision.slice(0, 12) : localize('ordito.code.snapshotSummary', "Files: {0} · Declarations: {1} · Revision: {2}", item.files, item.declarations ?? 0, item.revision.slice(0, 12)), detail: item.directory, directory: item.directory })), { ignoreFocusLost: true, title: localize('ordito.code.recover', "Restore Model Snapshot"), placeHolder: localize('ordito.code.recover.detail', "Restores the model and index. Source files keep their current contents.") });
		if (!choice || this.project.dirty && !await this.project.save()) { return; }
		await this.run(localize('ordito.code.restoring', "Restoring Snapshot"), async token => { await this.openContext(await this.request<CodeContext>({ operation: 'restore', snapshot: context.snapshot, target: choice.directory }, token)); });
	}
	async undoSync(): Promise<void> {
		const context = this.context;
		if (!context || this.busy || this.project.dirty && !await this.project.save()) { return; }
		const history = await this.request<CodeHistory>({ operation: 'history', snapshot: context.snapshot });
		const operation = history.operations?.find(item => item.status === 'applied' && item.to === context.snapshot);
		if (!operation) { this.notifications.info(localize('ordito.code.noUndo', "The Active Snapshot Has No Applied Reconciliation to Undo.")); return; }
		const choice = await this.quickInput.pick([{ label: localize('ordito.code.undoConfirm', "Undo Model and Source Changes"), detail: operation.created, apply: true }, { label: localize('ordito.code.cancel', "Cancel"), apply: false }], { title: localize('ordito.code.undo', "Undo Last Sync"), ignoreFocusLost: true });
		if (choice?.apply) { await this.run(localize('ordito.code.undoing', "Undoing Reconciliation"), async token => { await this.openContext(await this.request<CodeContext>({ operation: 'undoSync', snapshot: context.snapshot, id: operation.id }, token)); }); }
	}
	async inspect(elementId?: string): Promise<void> { if (this.context) { await this.showEvidence(this.context, elementId); } }
	private async showEvidence(context: CodeContext, elementId?: string): Promise<void> {
		const items: (IQuickPickItem & { evidence?: CodeEvidence; analysis?: boolean })[] = [];
		if (!elementId) { items.push({ label: localize('ordito.code.fullAnalysis', "Open Full Analysis Details"), detail: localize('ordito.code.fullAnalysis.detail', "Saved inventory, parser counts, textual contracts, imports, revisions and analysis providers"), analysis: true }); }
		const names = new Map([...context.files.filter(file => file.elementId).map(file => [file.elementId!, file.path] as const), ...context.declarations.map(item => [item.id, item.name] as const)]);
		const definitions = new Set<string>();
		if (this.project.model.version === 5 && elementId) {
			const foundation = this.project.model.foundation;
			const ids = new Set(foundation.assertions.filter(assertion => assertion.subject.id === elementId).flatMap(assertion => assertion.evidenceIds ?? []));
			for (const occurrence of foundation.occurrences.filter(occurrence => occurrence.id === elementId || occurrence.from === elementId || occurrence.to === elementId)) { for (const id of occurrence.evidenceIds ?? []) { ids.add(id); } }
			for (const record of foundation.evidence?.filter(record => ids.has(record.id)) ?? []) { items.push({ label: record.file, description: `${record.start}–${record.end}`, detail: localize('ordito.code.explorationEvidence', "Versioned Evidence · {0} · {1}", record.nature, record.producer), evidence: { file: record.file, revision: record.revision, start: record.start, end: record.end, line: 1, endLine: 1 } }); }
		}
		const selectedFiles = new Set(this.project.model.codeMappings.filter(mapping => mapping.elementId === elementId).map(mapping => mapping.file));
		const selectedFile = context.files.find(file => file.elementId === elementId)?.path;
		if (selectedFile) { selectedFiles.add(selectedFile); }
		for (const item of context.declarations) {
			if (elementId && item.id !== elementId && !selectedFiles.has(item.evidence.file)) { continue; }
			items.push({ label: item.name, description: `${item.evidence.file}:${item.evidence.line}`, detail: localize('ordito.code.fact', "Extracted declaration · {0}", item.kind), evidence: item.evidence });
		}
		for (const edge of context.dependencies) {
			if (elementId && edge.id !== elementId && edge.from !== elementId && edge.to !== elementId && !edge.references.some(reference => selectedFiles.has(reference.source.file))) { continue; }
			const name = (id: string) => names.get(id) ?? id;
			for (const reference of edge.references) {
				items.push({ label: `${name(edge.from)} → ${name(edge.to)}`, description: `${reference.source.file}:${reference.source.line}`, detail: localize('ordito.code.reference', "Static reference · {0} · target {1}:{2}", reference.provider, reference.target.file, reference.target.line), evidence: reference.source });
				const key = JSON.stringify(reference.target);
				if (!definitions.has(key)) {
					definitions.add(key);
					items.push({ label: localize('ordito.code.definition', "Target Definition: {0}", name(edge.to)), description: `${reference.target.file}:${reference.target.line}`, evidence: reference.target });
				}
			}
		}
		if (elementId) {
			for (const file of selectedFiles) {
				if (items.some(item => item.evidence?.file === file)) { continue; }
				const mapping = this.project.model.codeMappings.find(mapping => mapping.elementId === elementId && mapping.file === file);
				if (!mapping) { continue; }
				items.push({ label: file, detail: localize('ordito.code.semanticEvidence', "Source Evidence for This Responsibility · AI Interpretation, Not a Compiler Binding"), evidence: { file, revision: mapping.revision, start: 0, end: 0, line: 1, endLine: 1 } });
			}
		}
		if (!elementId) {
			for (const file of context.files) {
				const revision = file.status === 'excluded' ? undefined : file.revision ?? context.declarations.find(item => item.evidence.file === file.path)?.evidence.revision;
				items.push({ label: file.path, description: [file.language, file.status].filter(Boolean).join(' · '), detail: [revision ? localize('ordito.code.openSource', "Open Source File") : localize('ordito.code.unreadSource', "Source navigation is unavailable because this file was not read during analysis."), ...file.diagnostics].join('; '), ...(revision ? { evidence: { file: file.path, revision, start: 0, end: 0, line: 1, endLine: 1 } } : {}) });
			}
			const diagnosticNames: Record<string, string> = {
				outsideScope: localize('ordito.code.outsideScope', "Outside Analysis Scope"),
				missingDocument: localize('ordito.code.missingDocument', "No Static Reference Index for This File"),
				missingDefinition: localize('ordito.code.missingDefinition', "Static Reference Has No Definition"),
				unboundDefinition: localize('ordito.code.unboundDefinition', "Compiler Definition Has No Extracted Declaration"),
				unboundReference: localize('ordito.code.unboundReference', "Static Reference Has No Mapped Declaration"),
				ambiguousSymbol: localize('ordito.code.ambiguousSymbol', "Ambiguous Static Symbol"),
				unresolvedRelationship: localize('ordito.code.unresolvedRelationship', "Unresolved Static Relationship")
			};
			for (const diagnostic of context.diagnostics) {
				const match = /^(.*): (\w+)$/.exec(diagnostic);
				items.push(match && diagnosticNames[match[2]] ? { label: `${match[1]}: ${diagnosticNames[match[2]]}`, detail: diagnostic } : { label: diagnostic });
			}
		}
		if (!items.length) { items.push({ label: localize('ordito.code.noEvidence', "No Extracted Code Evidence for This Element") }); }
		const choice = await this.quickInput.pick(items, { ignoreFocusLost: true, title: localize('ordito.code.evidence', "Code Coverage and Evidence"), matchOnDescription: true, matchOnDetail: true, placeHolder: localize('ordito.code.evidence.detail', "{0} files · {1} declarations · {2} dependencies. Extracted facts; runtime behavior and responsibilities are unobserved.", context.files.length, context.declarations.length, context.dependencies.length) });
		if (!choice) { return; }
		if (choice.analysis) {
			if (context.revision !== this.context?.revision) { this.notifications.info(localize('ordito.code.analysisPreview', "Apply the source inventory preview before opening its saved analysis details.")); return; }
			let resource = URI.joinPath(URI.file(context.snapshot), 'code-index.json');
			if (((await this.files.stat(resource)).size ?? 0) <= 8 * 1024 * 1024) {
				const index = JSON.parse((await this.files.readFile(resource)).value.toString());
				const changes = URI.joinPath(URI.file(context.snapshot), 'sync-report.json');
				if (await this.files.exists(changes)) { index.changes = JSON.parse((await this.files.readFile(changes)).value.toString()); }
				resource = URI.joinPath(await resolveOrditoMetadataDirectory(this.files, URI.file(context.sourceRoot)), 'reports', generateUuid(), localize('ordito.code.analysisFile', "Source Analysis.json"));
				await this.files.createFolder(dirname(resource));
				await this.files.writeFile(resource, VSBuffer.fromString(JSON.stringify(index, null, '\t') + '\n'));
			} else { this.notifications.info(localize('ordito.code.largeAnalysis', "The large analysis index is opened in its compact format. Use editor search and Outline to navigate its details.")); }
			await this.filesConfiguration.updateReadonly(resource, { value: localize('ordito.code.analysisReadonly', "This is a saved analysis snapshot. Update the source inventory to create a new version.") });
			await this.editors.openEditor({ resource, options: { pinned: true } });
			return;
		}
		if (!choice.evidence) { this.notifications.info(choice.detail ?? choice.label); return; }
		if (context.revision !== this.context?.revision) { this.notifications.info(localize('ordito.code.previewEvidence', "Apply Sync before navigating to the updated source positions.")); return; }
		const source = await this.request<CodeSource>({ operation: 'source', snapshot: context.snapshot, file: choice.evidence.file, revision: choice.evidence.revision, start: choice.evidence.start, end: choice.evidence.end });
		if (source.stale) { this.notifications.warn(localize('ordito.code.sourceStale', "The source changed since this evidence was recorded. Run Sync to update positions.")); }
		await this.editors.openEditor({ resource: URI.file(source.path), options: { pinned: true, selection: source.stale ? undefined : { startLineNumber: source.startLine, startColumn: source.startColumn, endLineNumber: source.endLine, endColumn: source.endColumn } } });
	}
}
registerSingleton(IOrditoCodeService, OrditoCodeService, InstantiationType.Delayed);
for (const [id, title, method] of [
	['ordito.importCodebase', localize2('ordito.code.command.import', "Import Codebase"), 'importCodebase'],
	['ordito.syncCode', localize2('ordito.code.command.sync', "Sync Codebase"), 'sync'],
	['ordito.syncProject', localize2('ordito.code.command.syncProject', "Sync Project"), 'sync'],
	['ordito.inspectCode', localize2('ordito.code.command.inspect', "Inspect Code Evidence"), 'inspect'],
	['ordito.restoreCodeSnapshot', localize2('ordito.code.command.restore', "Restore Code Model Snapshot"), 'recover'],
	['ordito.undoSync', localize2('ordito.code.command.undoSync', "Undo Last Sync"), 'undoSync'],
	['ordito.attachCodeIndex', localize2('ordito.code.command.attach', "Attach SCIP Bundles"), 'attachIndex'],
	['ordito.configureCodeScope', localize2('ordito.code.command.scope', "Configure Import Scope"), 'configure']
] as const) {
	registerAction2(class extends Action2 {
		constructor() { super({ id, title, category: localize2('ordito.code.category', "Specsplice"), f1: true }); }
		override async run(accessor: ServicesAccessor): Promise<void> {
			try { await accessor.get(IOrditoCodeService)[method](); }
			catch (error) { if (!isCancellationError(error)) { accessor.get(INotificationService).error(orditoErrorNotification(error, 'code', accessor.get(IOrditoProjectService).model)); } }
		}
	});
}
