import { orditoErrorNotification } from '../browser/orditoErrors.js';
import { diagramToolDefinitions, diagramSessionInstruction } from '../common/diagramTools.js';
import { ILanguageModelsService } from '../../chat/common/languageModels.js';
import { ILanguageModelToolsService, ToolDataSource } from '../../chat/common/tools/languageModelToolsService.js';
import { IAgentHostActiveClientService } from '../../chat/browser/agentSessions/agentHost/agentHostActiveClientService.js';
import { type IJSONSchema } from '../../../../base/common/jsonSchema.js';
import { localize } from '../../../../nls.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { URI } from '../../../../base/common/uri.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService, INotificationHandle, Severity } from '../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { IConfigurationService, ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceTrustRequestService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { AgentHostCodexAgentEnabledSettingId, AgentHostCodexAgentCodexHomeSettingId } from '../../../../platform/agentHost/common/agentService.js';
import { ICodexAccountService } from '../../../services/agentHost/browser/codexAccountService.js';
import { parseCodexModelSelection } from '../../../../platform/agentHost/common/codexModelSelection.js';
import { IAgentSdkSetupService } from '../../../services/agentHost/browser/agentSdkSetupService.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IFilesConfigurationService } from '../../../services/filesConfiguration/common/filesConfigurationService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IOrditoAiDialogService, type OrditoAiMessage } from '../browser/orditoAiDialog.js';
import { getNewChatSessionResource } from '../../chat/common/model/chatUri.js';
import { IOrditoProjectService } from '../browser/orditoProjectService.js';
import { orditoSnapshotMetadataDirectory, resolveOrditoMetadataDirectory } from '../browser/orditoProjectFiles.js';
import { IOrditoCodeService } from '../browser/orditoCodeService.js';
import { type OrditoDiagramActivity, type OrditoDiagramLiveProgress, type OrditoDiagramReview } from '../browser/orditoAiService.js';
import { IOrditoOperationService, OrditoOperationService } from '../browser/orditoOperationService.js';
import { OrditoInput } from '../browser/orditoInput.js';
import { viewLabels } from '../browser/orditoLabels.js';
import { ThrottledDelayer } from '../../../../base/common/async.js';
import { equals } from '../../../../base/common/objects.js';
import { canonicalJson, semanticContent } from '../common/modelSerialization.js';
import { CodeDiagramProgress, CodeDiagramExploration, maxDiagramCheckpointTimeoutMinutes, type CodeAiProgress, type CodeDiagramCheckpointResult } from '../common/codeBridge.js';
import { getDiagramExplorationPhase } from '../common/diagramExplorationState.js';
import { diagramCheckpointReasoningEffortSetting, diagramCheckpointTimeoutSetting, diagramExplorationBudgetSetting, getDiagramCheckpointReasoningEffort, getDiagramCheckpointTimeoutMinutes, isDiagramCheckpointTimeoutMinutes } from '../common/diagramExplorationSettings.js';
import { getDiagramBudgetExtensionCapacity, getProjectDiagramExplorationBudget, isDiagramExplorationBudget } from '../common/diagramExplorationBudget.js';
import { type CliConfig, type OrditoAiProject, type OrditoAiWorkflow } from './orditoAiTypes.js';
import { OrditoAiConnection } from './orditoAiConnection.js';

interface ExplorationSession {
	root: string;
	id: string;
	snapshot: string;
	resource?: string;
	selectedModel?: string;
	approvedScope?: string;
	goal?: string;
	clarification?: { checkpoint: string; question: string; answer?: string };
	activity?: OrditoDiagramActivity[];
}

function checkpoint(state: CodeDiagramExploration): string {
	const parts = [state.phase, state.nextFeatureId, state.nextTaskId];
	if (state.nextFindingId) { parts.push(state.nextFindingId); }
	return JSON.stringify(parts);
}

function checkpointTimeoutIssue(timeout: NonNullable<CodeDiagramCheckpointResult['timeout']>): string {
	switch (timeout) {
		case 'startup': return localize('ordito.explore.timeout.startup', "The AI provider did not start in time. Check the connection and selected model in AI Settings, then choose Continue Generation.");
		case 'idle': return localize('ordito.explore.timeout.idle', "The AI provider stopped responding. Specsplice kept your saved progress. Check the connection and choose Continue Generation.");
		case 'deadline': return localize('ordito.explore.timeout.deadline', "The AI provider reached the time limit for this step. Specsplice kept your saved progress. Choose Continue Generation to resume.");
	}
}

/** Diagram exploration, generation and review workflow; lifecycle belongs to this component. */
export class OrditoAiDiagrams extends Disposable {
	private _diagramReview: OrditoDiagramReview | undefined;

	private chatOpening = false;

	private diagramRunning = false;

	private diagramError: INotificationHandle | undefined;

	get generatingDiagrams(): boolean { return this.diagramRunning; }

	private conversation: { root: string; resource?: URI; attachedModel?: string } | undefined;

	private readonly conversationWatch = this._register(new DisposableStore());

	get chatLocation(): 'modal' | undefined { return this.conversation ? 'modal' : undefined; }

	private _diagramProgress: CodeDiagramProgress | undefined;

	private _diagramExploration: CodeDiagramExploration | undefined;

	private _diagramLiveProgress: OrditoDiagramLiveProgress | undefined;
	private diagramRequestId: string | undefined;
	private explorationRefresh = 0;
	private appliedExplorationRefresh = 0;

	private restoringExploration: string | undefined;

	private exploration: ExplorationSession | undefined;

	private readonly explorationRun = this._register(new MutableDisposable<CancellationTokenSource>());

	private _diagramExplorationIssue: string | undefined;

	private readonly explorationTools = this._register(new DisposableStore());

	private explorationBinding: string | undefined;

	private explorationToolResource: URI | undefined;

	async chat(initialPrompt?: string): Promise<void> {
		if (this.host.busy || this.operations.busy || this.chatOpening || this.configuration.getValue<boolean>('chat.disableAIFeatures') === true) { return; }
		await this.discardMissingExploration();
		if (this.code.context && this.configuration.getValue<boolean>('ordito.diagramImport.incremental') !== false && this.exploration?.root !== this.code.context.sourceRoot) { await this.exploreDiagrams(initialPrompt, false, true); return; }
		const session = this.exploration;
		const opening = this.operations.acquire('ai');
		if (!opening) { return; }
		this.chatOpening = true; this.host.busy = true;
		this.host.report(localize('ordito.ai.chatOpening', "Opening Codex…"));
		try {
			if (!await this.trust.requestWorkspaceTrust() || this.project.modelUri && !await this.project.save()) { this.host.report(localize('ordito.ai.chatNotOpened', "Codex Was Not Opened")); return; }
			const root = this.code.context?.sourceRoot ?? this.project.projectRoot?.fsPath ?? this.project.model.id;
			if (this.conversation?.root !== root) { this.conversation = undefined; }
			const native = this.codexAccount.account.status === 'signedIn' && this.setup.setups.some(setup => setup.agent === 'codex' && setup.download === 'ready') && !this.configuration.getValue<string>(AgentHostCodexAgentCodexHomeSettingId) && (!this.connection.config || this.connection.config.provider !== 'codex' || this.connection.config.executable === 'codex');
			if (native) {
				await this.configuration.updateValue(AgentHostCodexAgentEnabledSettingId, true, session ? ConfigurationTarget.WORKSPACE : ConfigurationTarget.USER);
				const firstQuestion = !this.conversation?.resource;
				const resource = this.conversation?.resource ?? getNewChatSessionResource('agent-host-codex');
				if (session?.root === root) { this.bindExplorationTools(resource); }
				const widget = await this.aiDialog.open({ resource, onClose: () => this.closeConversation(root) });
				if (!widget) { this.host.report(localize('ordito.ai.dialog.closed', "Assistant Closed")); return; }
				if (session?.root === root) {
					const chosen = this.storage.get('ordito.ai.diagramModel.codex', StorageScope.PROFILE);
					if (chosen && (firstQuestion || session.selectedModel !== chosen)) {
						const selected = this.languageModels.getLanguageModelIds().map(identifier => ({ identifier, metadata: this.languageModels.lookupLanguageModel(identifier) })).find(entry => entry.metadata?.targetChatSessionType === 'agent-host-codex' && parseCodexModelSelection({ id: entry.metadata.id })?.modelId === chosen && parseCodexModelSelection({ id: entry.metadata.id })?.modelProvider === 'openai');
						if (!selected?.metadata) { throw new Error(localize('ordito.explore.modelUnavailable', "The Selected Diagram Model Is Not Available in Codex Chat: {0}. Choose an Available Model and Retry.", chosen)); }
						widget.input.setCurrentLanguageModel({ identifier: selected.identifier, metadata: selected.metadata }, false, false);
						session.selectedModel = chosen;
					}
					session.resource = resource.toString(); this.persistExploration();
					widget.attachmentModel.updateContext(['ordito:exploration'], [{ kind: 'generic', id: 'ordito:exploration', name: localize('ordito.explore.context', "Architecture Exploration"), value: JSON.stringify({ instruction: diagramSessionInstruction, sessionId: session.id, root, activeView: this.project.activeView?.id ?? null }) }]);
				}
				if (this.project.modelUri && !session) {
					const previous = this.conversation?.attachedModel;
					if (previous && previous !== this.project.modelUri.toString()) { widget.attachmentModel.delete(previous); }
					if (!widget.attachmentModel.fileAttachments.some(uri => uri.toString() === this.project.modelUri!.toString())) { await widget.attachmentModel.addFile(this.project.modelUri); }
				}
				widget.attachmentModel.updateContext(['ordito:diagram-context'], [{ kind: 'generic', id: 'ordito:diagram-context', name: localize('ordito.ai.currentDiagramContext', "Current Diagram"), value: JSON.stringify({ ...(session?.root === root ? { sessionId: session.id } : { model: this.project.modelUri?.fsPath }), diagram: this.project.activeView ? { id: this.project.activeView.id, name: this.project.activeView.name } : null }) }]);
				this.conversation = { root, resource, attachedModel: this.project.modelUri?.toString() };
				if (initialPrompt !== undefined || session?.root === root && firstQuestion) { widget.setInput(initialPrompt ?? this.conversationPrompt()); }
				widget.setInputPlaceholder(localize('ordito.ai.chatPlaceholder', "Ask Codex to Change the Diagram or Its Code…")); widget.focusInput();
			} else {
				const provider = this.connection.config?.provider ?? 'codex';
				const executable = await this.connection.resolveCli(provider);
				if (!executable) { return; }
				const account = await this.code.checkCliAccount(provider, executable);
				if (account.status !== 'signedIn') { if (account.status === 'signedOut') { await this.connection.signIn(provider, true); } else { await this.connection.checkAccount(provider, executable); } return; }
				let model = this.storage.get(`ordito.ai.diagramModel.${provider}`, StorageScope.PROFILE) ?? this.connection.config?.model;
				if (!model) { model = await this.selectDiagramModel({ version: 1, provider, connection: 'cli', executable, model: '', timeoutMs: 180000, maxContextBytes: 262144, maxCalls: 1 }); if (!model) { return; } }
				const config: CliConfig = { version: 1, provider, connection: 'cli', executable, model, timeoutMs: 300000, maxContextBytes: 262144, maxCalls: this.connection.config?.maxCalls ?? 1 };
				this.conversation = { root };
				await this.aiDialog.open({ prompt: initialPrompt ?? (session?.root === root ? this.conversationPrompt() : ''), onClose: () => this.closeConversation(root), send: (messages, token) => this.sendConversation(root, config, messages, token) });
			}
			this.watchConversation();
			this.host.report(localize('ordito.ai.chatModalReady', "Assistant Is Open · Diagrams Update Automatically"));
		} catch (error) { await this.aiDialog.close(); this.conversation = undefined; this.conversationWatch.clear(); const message = localize('ordito.ai.chatFailed', "Could Not Open Codex: {0}", error instanceof Error ? error.message : String(error)); this.host.report(message); this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model)); }
		finally { this.chatOpening = false; this.host.busy = false; opening.dispose(); this.host.changed(); }
	}

	private conversationPrompt(): string {
		if (getDiagramExplorationPhase(this._diagramExploration) === 'applied') { return ''; }
		if (this._diagramExploration?.phase === 'discovery') { return localize('ordito.explore.discoverFeatures', "Identify the project features and their source evidence with the Specsplice tools. Then prepare the necessary diagrams one feature at a time, reusing shared elements and relations by their existing IDs. Finish with one project review."); }
		if (this._diagramExploration?.phase) { return localize('ordito.explore.resumeFeatures', "Inspect the saved Specsplice checkpoint and continue the next permitted step. Keep valid drafts and reuse existing elements and relations. Finish each feature before proceeding to the next, then open one project review."); }
		return this._diagramExploration?.plan ? localize('ordito.explore.repairPrompt', "Continue the saved diagram plan. Inspect its existing drafts and final-review blockers first. Keep valid diagrams and shared IDs. Repair assigned invalid drafts with supersedes and relink their tasks. Archive obsolete unassigned invalid attempts with ordito_proposal_discard and a reason. Complete missing diagrams without intermediate approvals, then report whether the complete project review is ready.") : localize('ordito.explore.firstQuestion', "Plan the relevant project diagrams from overview to detail using the Specsplice tools, then create and preview every planned draft. Continue without intermediate approvals and finish with one complete project review.");
	}

	async returnToDiagrams(): Promise<void> { await this.aiDialog.close(); }

	private async closeConversation(root: string): Promise<void> {
		if (this.conversation?.root !== root) { return; }
		this.conversation = undefined; this.conversationWatch.clear();
		this.explorationTools.clear(); this.explorationBinding = undefined;
		if (this.exploration?.root === root) { this.exploration.resource = undefined; this.persistExploration(); }
		try { await this.refreshExploration(true); } catch (error) { this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model)); }
		this.host.changed();
	}

	private watchConversation(): void {
		this.conversationWatch.clear();
		const session = this.exploration;
		if (!session) { return; }
		const refresh = this.conversationWatch.add(new ThrottledDelayer<void>(300));
		this.watchExplorationJournal(session, this.conversationWatch, () => {
			void refresh.trigger(async () => {
				if (this.exploration?.id === session.id) { await this.refreshExploration(true); }
			}).catch(error => { if (this.conversation && !isCancellationError(error)) { this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model)); } });
		});
	}

	private watchExplorationJournal(session: ExplorationSession, disposables: DisposableStore, refresh: () => void): void {
		const directory = URI.joinPath(orditoSnapshotMetadataDirectory(URI.file(session.root), session.snapshot), 'exploration');
		const resource = URI.joinPath(directory, `${session.id}.json`);
		const watcher = disposables.add(this.files.createWatcher(directory, { recursive: false, excludes: [] }));
		disposables.add(watcher.onDidChange(event => {
			if (event.contains(resource)) { refresh(); }
		}));
	}

	private async sendConversation(root: string, config: CliConfig, messages: OrditoAiMessage[], token: CancellationToken): Promise<string> {
		if (!this.conversation || this.conversation.root !== root || !await this.trust.requestWorkspaceTrust()) { throw new Error(localize('ordito.explore.scopeChanged', "The Exploration Project Is No Longer Active.")); }
		const operation = this.operations.acquire('ai');
		if (!operation) { throw new Error(localize('ordito.ai.busy', "Another Specsplice Operation Is Running. Wait for It to Finish.")); }
		this.host.busy = true; this.host.changed();
		const requestId = generateUuid(), conversation = this.conversation;
		const progress = this.code.onDidAiProgress(event => { if (event.requestId === requestId && this.conversation === conversation && !token.isCancellationRequested) { this.aiDialog.updateConversation(event); } });
		try {
			const session = this.exploration?.root === root ? this.exploration : undefined;
			const result: { text: string } = JSON.parse(await this.code.executeReconciliation({ operation: 'diagramChat', requestId, root, ...(session ? { snapshot: this.code.context!.snapshot, sessionId: session.id } : {}), config: JSON.stringify(config), messages: session ? messages : [{ role: 'user', text: `Project context: model file ${this.project.modelUri?.fsPath ?? 'not saved'}, active diagram ${this.project.activeView?.id ?? 'none'}. Preserve semantic IDs and valid references. Only edit files when the user requests a change.` }, ...messages] }, token));
			return result.text;
		} finally {
			progress.dispose(); operation.dispose(); this.host.busy = false;
			if (this.code.context?.sourceRoot === root) { try { await this.refreshExploration(true); } catch (error) { this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model)); } }
			if (!token.isCancellationRequested && this._diagramReview?.root === root) { await this.reviewDiagramProposal(this._diagramReview.id); }
			this.host.changed();
		}
	}

	private persistExploration(): void {
		if (this.exploration) { this.storage.store('ordito.ai.exploration', JSON.stringify(this.exploration), StorageScope.WORKSPACE, StorageTarget.MACHINE); }
	}

	/** A reimport can replace project metadata while the workspace still remembers its old session. */
	private async discardMissingExploration(): Promise<void> {
		const session = this.exploration;
		if (!session || session.root !== this.code.context?.sourceRoot) { return; }
		const snapshot = this.code.context.snapshot;
		try {
			await this.files.stat(URI.joinPath(orditoSnapshotMetadataDirectory(URI.file(session.root), snapshot), 'exploration', `${session.id}.json`));
		} catch (error) {
			if (!(error instanceof Error) || toFileOperationResult(error) !== FileOperationResult.FILE_NOT_FOUND) { throw error; }
			if (this.exploration !== session || this.code.context?.sourceRoot !== session.root || this.code.context.snapshot !== snapshot) { return; }
			this.resetProject();
			this.exploration = undefined;
			this.storage.remove('ordito.ai.exploration', StorageScope.WORKSPACE);
			this.host.report(localize('ordito.explore.removed', "Previous Exploration Was Removed · Ready to Start a New Exploration"));
			this.host.changed();
		}
	}

	private async explorationRequest(request: object, token = CancellationToken.None, failOnDiagnostics = true): Promise<{ sessionId: string; data: CodeDiagramExploration & { reviewFile?: string; images?: { path: string; viewId: string }[]; snapshot?: string; reviewId?: string; proposal?: CodeDiagramExploration['proposals'][number]; mcp?: { command: string; args: string[] } }; diagnostics: { code: string }[] }> {
		const context = this.code.context;
		if (!context) { throw new Error(localize('ordito.explore.importRequired', "Import a Project to Explore Its Architecture.")); }
		const result = JSON.parse(await this.code.executeReconciliation({ operation: 'exploration', snapshot: context.snapshot, request: JSON.stringify(request) }, token));
		if (failOnDiagnostics && result.diagnostics?.length) { throw new Error(result.diagnostics.map((entry: { code: string }) => entry.code).join(' · ')); }
		return result;
	}

	private async refreshExploration(live = false, token = CancellationToken.None): Promise<void> {
		const session = this.exploration, snapshot = this.code.context?.snapshot;
		if (!session || session.root !== this.code.context?.sourceRoot || token.isCancellationRequested) { return; }
		const refresh = ++this.explorationRefresh;
		const current = () => !token.isCancellationRequested && this.exploration === session && this.code.context?.sourceRoot === session.root && this.code.context.snapshot === snapshot && refresh >= this.appliedExplorationRefresh;
		await this.discardMissingExploration();
		if (!current()) { return; }
		const result = await this.explorationRequest({ action: live ? 'status' : 'open', sessionId: session.id }, token);
		if (!current() || result.sessionId !== session.id) { return; }
		this.appliedExplorationRefresh = refresh;
		const previous = this._diagramExploration;
		this._diagramExploration = result.data;
		const activityChanged = this.recordPersistedDiagramActivity(session, result.data, previous);
		if (activityChanged || !previous || !equals({ ...previous, budgetWindow: undefined }, { ...result.data, budgetWindow: undefined })) { this.host.changed(); }
		if (this.conversation) {
			const issues = result.data.batch?.blockers.length ?? 0;
			this.aiDialog.updateProgress(issues ? localize('ordito.ai.dialog.repairProgress', "{0} Planned Diagrams · Review Needs Correction · {1} Project Tool Calls", result.data.plan?.items.length ?? 0, result.data.usage.toolCalls) : localize('ordito.ai.dialog.progress', "{0} of {1} Planned Diagrams Prepared · {2} Project Tool Calls", result.data.tasks.filter(task => ['ready', 'applied', 'cancelled'].includes(task.status)).length, result.data.plan?.items.length ?? 0, result.data.usage.toolCalls));
		}
	}

	private bindExplorationTools(resource: URI): void {
		const session = this.exploration;
		if (!session) { return; }
		if (this.explorationBinding === session.id) { if (this.explorationToolResource && this.explorationToolResource.toString() !== resource.toString()) { this.activeClients.moveSessionTools(this.explorationToolResource, resource); this.explorationToolResource = resource; } return; }
		this.explorationTools.clear(); this.explorationBinding = session.id;
		const ids = diagramToolDefinitions.map(tool => {
			const id = `ordito.${session.id}.${tool.name}`;
			this.explorationTools.add(this.tools.registerTool({ id, toolReferenceName: tool.name, displayName: localize('ordito.explore.tool', "Specsplice Architecture: {0}", tool.name), modelDescription: tool.description, source: ToolDataSource.Internal, inputSchema: tool.inputSchema as IJSONSchema, canBeReferencedInPrompt: false, agentHostPreferences: { availability: 'session', defer: 'never' } }, {
				invoke: async (invocation, _countTokens, _progress, token) => {
					if (this.code.context?.sourceRoot !== session.root || !invocation.context || !await this.trust.requestWorkspaceTrust()) { throw new Error(localize('ordito.explore.scopeChanged', "The Exploration Project Is No Longer Active.")); }
					const scope = this.activeClients.acquireSessionTools(invocation.context.sessionResource);
					try { if (!scope.object.get().some(definition => definition.name === tool.name)) { throw new Error(localize('ordito.explore.sessionScope', "These Tools Belong to Another Conversation.")); } } finally { scope.dispose(); }
					if (this.exploration?.id === session.id && this.exploration.resource !== invocation.context.sessionResource.toString()) { this.exploration.resource = invocation.context.sessionResource.toString(); this.persistExploration(); }
					if (this.conversation?.root === session.root && this.conversation.resource) { this.conversation.resource = invocation.context.sessionResource; }
					const result = await this.explorationRequest({ action: 'tool', sessionId: session.id, tool: tool.name, arguments: invocation.parameters, callId: invocation.callId, ...(invocation.chatRequestId || invocation.context.requestId ? { turnId: invocation.chatRequestId ?? invocation.context.requestId } : {}), ...(invocation.modelId ? { model: invocation.modelId } : {}) }, token, false);
					await this.refreshExploration();
					return { content: [{ kind: 'text', value: JSON.stringify(result) }] };
				}
			}));
			return id;
		});
		this.activeClients.setSessionTools(resource, ids); this.explorationToolResource = resource;
		this.explorationTools.add({ dispose: () => this.activeClients.clearSessionTools(resource) });
	}

	private async exploreDiagrams(initialPrompt?: string, refreshApplied = false, openConversation = false): Promise<void> {
		const context = this.code.context;
		if (this.host.busy || this.operations.busy || !context) { return; }
		const { sourceRoot: root, snapshot } = context;
		const sameContext = () => this.code.context?.sourceRoot === root && this.code.context.snapshot === snapshot;
		let opened: ExplorationSession | undefined;
		let needsBudget = false;
		await this.host.run(async token => {
			if (!await this.project.save() || !sameContext()) { return; }
			if (this.exploration?.root !== root) { this.exploration = undefined; }
			await this.discardMissingExploration();
			const startFresh = refreshApplied && !!this._diagramExploration?.phase && getDiagramExplorationPhase(this._diagramExploration) === 'applied';
			if (startFresh) { await this.returnToDiagrams(); }
			if (!sameContext() || token.isCancellationRequested) { return; }
			const previous = startFresh ? undefined : this.exploration;
			const budget = !previous || this._diagramExploration?.workflow !== 'project' ? this.defaultExplorationBudget() : undefined;
			const result = await this.explorationRequest({ action: 'open', workflow: 'project', featureWorkflow: true, ...(budget ? { budget } : {}), ...(previous ? { sessionId: previous.id } : { model: this.storage.get('ordito.ai.diagramModel.codex', StorageScope.PROFILE) ?? 'chat-selected' }) }, token);
			if (!sameContext() || token.isCancellationRequested) { return; }
			opened = this.exploration = { ...previous, ...(!openConversation && initialPrompt ? { goal: initialPrompt } : {}), root, id: result.sessionId, snapshot };
			this._diagramExploration = result.data; needsBudget = !!result.data.budgetStatus?.exhausted.length; this._diagramProgress = undefined; this.persistExploration();
		}, { kind: 'diagram', inline: true });
		if (!opened || this.exploration !== opened || !sameContext()) { return; }
		if (needsBudget) {
			await this.configureDiagramBudget();
			if (this.exploration !== opened || !sameContext() || this._diagramExploration?.budgetStatus?.exhausted.length) { return; }
		}
		if (openConversation || !this._diagramExploration?.phase) { await this.chat(initialPrompt); return; }
		if (getDiagramExplorationPhase(this._diagramExploration) === 'review') { await this.reviewDiagramProposal(); return; }
		await this.runFeatureExploration();
	}

	private recordDiagramActivity(session: ExplorationSession, entry: OrditoDiagramActivity): boolean {
		const text = entry.text.trim().slice(0, 1600);
		if (!text) { return false; }
		const activity = session.activity ??= [];
		const previous = activity.findIndex(item => item.requestId === entry.requestId && item.kind === entry.kind && item.itemId === entry.itemId);
		if (previous >= 0) {
			if (activity[previous].text === text) { return false; }
			activity[previous] = { ...entry, text };
		} else {
			activity.push({ ...entry, text });
			if (activity.length > 30) { activity.shift(); }
		}
		return true;
	}

	private updateDiagramLiveProgress(changes: Partial<OrditoDiagramLiveProgress>, activityChanged = false): boolean {
		const previous = this._diagramLiveProgress;
		if (!previous) { return false; }
		const next = { ...previous, ...changes };
		if (!activityChanged && equals(previous, next)) { return false; }
		this._diagramLiveProgress = { ...next, updatedAt: Date.now() };
		return true;
	}

	private recordPersistedDiagramActivity(session: ExplorationSession, state: CodeDiagramExploration, previous: CodeDiagramExploration | undefined): boolean {
		const requestId = this.diagramRequestId;
		if (!requestId || !this._diagramLiveProgress || !state.toolActivity) { return false; }
		const latest = state.toolActivity.findLast(call => call.turnId === requestId);
		const completed = state.toolActivity.findLast(call => call.state === 'complete');
		const known = new Set(previous?.toolActivity?.map(call => call.id));
		for (const call of state.toolActivity) {
			if (call.turnId === requestId && !known.has(call.id)) {
				this.recordDiagramActivity(session, { requestId, itemId: call.id, kind: 'tool', text: call.tool });
			}
		}
		const running = latest?.state === 'running';
		const previousLatest = previous?.toolActivity?.findLast(call => call.turnId === requestId);
		return this.updateDiagramLiveProgress({
			...(latest && this._diagramLiveProgress.state !== 'stopping' ? { state: running ? 'tool' : 'waiting', activeTool: running ? latest.tool : undefined } : {}),
			...(completed ? { lastCompletedTool: completed.tool } : {})
		}, latest?.id !== previousLatest?.id || latest?.state !== previousLatest?.state);
	}

	private recordDiagramProviderEvent(session: ExplorationSession, event: CodeAiProgress): void {
		if (event.kind === 'message') {
			if (event.text && this.recordDiagramActivity(session, { requestId: event.requestId, itemId: event.itemId, kind: 'message', text: event.text })) { this.host.changed(); }
		} else if (event.kind !== 'tool' && this._diagramLiveProgress?.state !== 'tool') {
			const state = event.kind === 'thinking' ? 'working' : event.kind;
			if (this.updateDiagramLiveProgress({ state })) { this.host.changed(); }
		}
	}

	private async runFeatureExploration(): Promise<void> {
		const session = this.exploration, context = this.code.context;
		if (!session || !context || session.root !== context.sourceRoot || !this._diagramExploration || getDiagramExplorationPhase(this._diagramExploration) !== 'incomplete' || this.diagramClarification) { return; }
		const snapshot = context.snapshot;
		this._diagramExplorationIssue = undefined;
		await this.host.run(async operationToken => {
			const cancellation = new CancellationTokenSource(operationToken);
			this.explorationRun.value = cancellation;
			const token = cancellation.token;
			const current = () => this.exploration === session && this.code.context?.sourceRoot === session.root && this.code.context.snapshot === snapshot;
			const liveWatch = new DisposableStore();
			this.diagramRunning = true;
			this.host.changed();
			try {
				const configured = await this.readyDiagramConfig();
				if (!configured || !current() || token.isCancellationRequested) { return; }
				if (!configured.maxCalls) { this._diagramExplorationIssue = localize('ordito.explore.requestsOff', "Enable AI Requests to Prepare the Diagrams."); return; }
				const model = this.storage.get(`ordito.ai.diagramModel.${configured.provider}`, StorageScope.PROFILE) ?? await this.selectDiagramModel(configured);
				if (!model || !current() || token.isCancellationRequested) { return; }
				const config = { ...configured, model };
				const approvedScope = canonicalJson([snapshot, context.scope, config.provider, config.model]);
				if (session.approvedScope !== approvedScope) {
					const provider = config.provider === 'codex' ? 'Codex' : 'Claude Code';
					const included = context.files.filter(file => file.status !== 'excluded').length;
					const confirmation = await this.dialogs.confirm({
						message: localize('ordito.explore.confirmStart', "Generate Diagrams with {0}?", model),
						detail: localize('ordito.explore.confirmScope', "{0}\nImported source scope · Included {1} · Excluded {2}\n{3} will receive relevant source excerpts for diagram generation and the follow-up codebase audit. You can stop at any time and review the corrected diagrams before applying them.", context.sourceRoot, included, context.files.length - included, provider),
						primaryButton: localize('ordito.explore.confirmAction', "Generate Diagrams")
					});
					if (!confirmation.confirmed || !current() || token.isCancellationRequested) { return; }
					session.approvedScope = approvedScope;
					this.persistExploration();
				}
				const opened = await this.explorationRequest({ action: 'open', sessionId: session.id, model }, token);
				if (!current() || token.isCancellationRequested) { return; }
				this._diagramExploration = opened.data;
				const startedAt = Date.now();
				this._diagramLiveProgress = { state: 'connecting', startedAt, updatedAt: startedAt };
				const refresh = liveWatch.add(new ThrottledDelayer<void>(120));
				const refreshLive = () => {
					if (!current() || token.isCancellationRequested || refresh.isTriggered()) { return; }
					void refresh.trigger(async () => {
						if (current() && !token.isCancellationRequested) { await this.refreshExploration(true, token); }
					}).catch(() => { /* The checkpoint completion also refreshes the saved state. */ });
				};
				this.watchExplorationJournal(session, liveWatch, refreshLive);
				this.host.changed();
				const attempts = new Map<string, number>();
				const maxAttemptsPerCheckpoint = 2;
				let retrying = false;
				for (let turn = 0; turn < opened.data.budget.maxModelTurns && current() && !token.isCancellationRequested; turn++) {
					const state = this._diagramExploration;
					if (!state || state.phase === 'review' || state.budgetStatus?.exhausted.length || getDiagramExplorationPhase(state) !== 'incomplete') { break; }
					const step = checkpoint(state);
					const attempt = (attempts.get(step) ?? 0) + 1;
					if (attempt > maxAttemptsPerCheckpoint) {
						this._diagramExplorationIssue = localize('ordito.explore.checkpointStalled', "This Step Needs Another Attempt. Review the Activity Details and Continue Generation When Ready.");
						break;
					}
					attempts.set(step, attempt);
					const clarification = session.clarification?.checkpoint === step ? session.clarification : undefined;
					if (clarification && !clarification.answer) { break; }
					const requestId = generateUuid();
					this.diagramRequestId = requestId;
					if (this.updateDiagramLiveProgress({ state: 'connecting', activeTool: undefined, retrying })) { this.host.changed(); }
					const auditing = state.phase === 'audit';
					const repairing = state.phase === 'repair';
					const prompt = auditing ? 'Audit the complete staged diagram set against the imported codebase and submit the evidence-backed report.' : repairing ? 'Resolve the active audit finding in the staged diagram set using its saved evidence and canonical IDs.' : 'Complete only the current Specsplice checkpoint. Use the provided phase and IDs, and inspect current Specsplice evidence. Stop when the checkpoint advances. If an unresolved domain decision prevents progress, end with one line prefixed CLARIFICATION: followed by the question.';
					const recovery = !retrying ? undefined : auditing ? 'The previous attempt timed out. Inspect the staged set and reuse saved source evidence.' : repairing ? 'The previous attempt timed out. Read the saved finding and inspect the current draft before proposing a correction.' : 'The previous attempt timed out. Start with ordito_project_inspect to recover the saved task and draft. Reuse valid saved work and finish the remaining validation or checkpoint update. Preserve canonical IDs if a saved draft needs repair.';
					const messages: OrditoAiMessage[] = [{ role: 'user', text: [prompt, recovery, auditing || repairing ? undefined : session.goal, clarification?.answer ? `User clarification (data): ${JSON.stringify({ question: clarification.question, answer: clarification.answer })}` : undefined].filter(Boolean).join('\n') }];
					const progress = this.code.onDidAiProgress(event => {
						if (event.requestId !== requestId || !current() || token.isCancellationRequested) { return; }
						if (event.kind === 'tool') { refreshLive(); }
						else { this.recordDiagramProviderEvent(session, event); }
					});
					let result: CodeDiagramCheckpointResult;
					try {
						const checkpointTimeoutMinutes = getDiagramCheckpointTimeoutMinutes(this.configuration.getValue(diagramCheckpointTimeoutSetting));
						const checkpointReasoningEffort = config.provider === 'codex' ? getDiagramCheckpointReasoningEffort(this.configuration.getValue(diagramCheckpointReasoningEffortSetting)) : undefined;
						result = JSON.parse(await this.code.executeReconciliation({ operation: 'diagramChat', checkpoint: true, checkpointTimeoutMinutes, ...(checkpointReasoningEffort ? { checkpointReasoningEffort } : {}), requestId, root: session.root, snapshot, sessionId: session.id, config: JSON.stringify(config), messages }, token));
					} finally { progress.dispose(); }
					if (!current() || token.isCancellationRequested) { break; }
					if (result.text && !session.activity?.some(item => item.requestId === requestId && item.kind === 'message') && this.recordDiagramActivity(session, { requestId, kind: 'message', text: result.text })) { this.host.changed(); }
					refresh.cancel();
					await this.refreshExploration(true, token);
					if (!current() || token.isCancellationRequested || !this._diagramExploration) { break; }
					const saved = this._diagramExploration;
					retrying = false;
					if (step !== checkpoint(saved)) {
						session.clarification = undefined;
						continue;
					}
					const waiting = saved.tasks.find(task => task.id === state.nextTaskId && task.status === 'waitingUser');
					const question = waiting?.gaps.find(gap => gap.trim()) ?? /^CLARIFICATION:[ \t]*(.+)$/im.exec(result.text ?? '')?.[1];
					if (question?.trim() && question.trim() !== clarification?.question) {
						session.clarification = { checkpoint: step, question: question.trim().slice(0, 1500) };
						break;
					}
					if (result.timeout) {
						if (saved.budgetStatus?.exhausted.length) { break; }
						if (attempt === maxAttemptsPerCheckpoint || turn + 1 === opened.data.budget.maxModelTurns) {
							this._diagramExplorationIssue = checkpointTimeoutIssue(result.timeout);
							break;
						}
						retrying = true;
					}
				}
				if (current() && token.isCancellationRequested) { this._diagramExplorationIssue = localize('ordito.explore.stopped', "Generation Stopped. Continue from the Saved Step When Ready."); }
			} catch (error) {
				if (current()) {
					this._diagramExplorationIssue = token.isCancellationRequested || isCancellationError(error) ? localize('ordito.explore.stopped', "Generation Stopped. Continue from the Saved Step When Ready.") : orditoErrorNotification(error, 'ai', this.project.model);
				}
			} finally {
				liveWatch.dispose();
				this.explorationRun.clear();
				if (current()) {
					if (this.diagramRequestId && (token.isCancellationRequested || this._diagramExplorationIssue)) {
						await this.refreshExploration(true).catch(() => { /* Keep the last acknowledged state available. */ });
					}
					this.persistExploration();
				}
				this.diagramRequestId = undefined;
				this._diagramLiveProgress = undefined;
			}
		}, { kind: 'diagram', inline: true });
		if (this._diagramReview && this.exploration === session && getDiagramExplorationPhase(this._diagramExploration) === 'review') { await this.reviewDiagramProposal(); }
	}

	async configureDiagramCheckpointTimeout(): Promise<void> {
		const parseMinutes = (input: string) => /^\d+$/.test(input.trim()) ? Number(input) : undefined;
		const input = await this.quick.input({
			title: localize('ordito.diagram.attemptLimitTitle', "Diagram Attempt Time Limit"),
			value: String(getDiagramCheckpointTimeoutMinutes(this.configuration.getValue(diagramCheckpointTimeoutSetting))),
			prompt: localize('ordito.diagram.attemptLimitPrompt', "Enter minutes per attempt. The new limit applies when the next attempt starts."),
			showConfirmButton: true,
			validateInput: async value => isDiagramCheckpointTimeoutMinutes(parseMinutes(value)) ? undefined : localize('ordito.diagram.attemptLimitRange', "Enter a whole number from 1 to {0}.", maxDiagramCheckpointTimeoutMinutes)
		});
		if (input === undefined) { return; }
		const minutes = parseMinutes(input);
		if (isDiagramCheckpointTimeoutMinutes(minutes)) {
			await this.configuration.updateValue(diagramCheckpointTimeoutSetting, minutes, ConfigurationTarget.USER);
		}
	}

	private defaultExplorationBudget() {
		return getProjectDiagramExplorationBudget(this.configuration.getValue(diagramExplorationBudgetSetting));
	}

	async configureDefaultDiagramBudget(): Promise<void> {
		const budget = await this.aiDialog.editDiagramBudget({ mode: 'default', budget: this.defaultExplorationBudget() });
		if (isDiagramExplorationBudget(budget)) {
			await this.configuration.updateValue(diagramExplorationBudgetSetting, budget, ConfigurationTarget.USER);
		}
	}

	async configureDiagramBudget(): Promise<void> {
		const session = this.exploration;
		const context = this.code.context;
		if (!session || !context || session.root !== context.sourceRoot || this.host.busy || this.operations.busy) { return; }
		const { sourceRoot, snapshot } = context;
		const current = () => this.exploration === session && this.code.context?.sourceRoot === sourceRoot && this.code.context.snapshot === snapshot;
		await this.refreshExploration(true);
		const state = this._diagramExploration;
		if (!current() || state?.sessionId !== session.id) { return; }
		const elapsedMs = state.budgetWindow ? Math.max(0, Date.now() - state.budgetWindow.started) : 0;
		const remainingMs = Math.max(0, state.budget.maxDurationMs - elapsedMs);
		const capacity = getDiagramBudgetExtensionCapacity(state.budget, state.usage, remainingMs);
		const budgetIncrease = await this.aiDialog.editDiagramBudget({ mode: 'extension', capacity });
		if (!budgetIncrease || !current()) { return; }
		await this.host.run(async token => {
			if (!current() || token.isCancellationRequested) { return; }
			await this.explorationRequest({ action: 'budget', sessionId: session.id, budgetIncrease }, token);
			if (current()) { await this.refreshExploration(true, token); }
		}, { kind: 'local' });
	}

	async reviewDiagramProposal(id?: string): Promise<void> {
		if (!this.exploration || this.host.busy || this.operations.busy) { return; }
		await this.host.run(async token => {
			await this.refreshExploration();
			const phase = this._diagramExploration?.phase;
			if (phase === 'audit' || phase === 'repair') { this.closeDiagramReview(); return; }
			const projectReview = this._diagramExploration?.workflow === 'project';
			let proposal = projectReview ? undefined : id ? this._diagramExploration?.proposals.find(entry => entry.id === id) : (await this.quick.pick(this._diagramExploration?.proposals.filter(entry => entry.status !== 'applied').map(entry => ({ label: entry.views.map(view => view.name).join(', ') || entry.id, description: entry.status, proposal: entry })) ?? [], { title: localize('ordito.explore.review', "Review Diagram Draft") }))?.proposal;
			if ((!projectReview && (!proposal || proposal.status === 'applied')) || !await this.project.save() || !this.exploration) { return; }
			const modelUri = this.project.modelUri?.toString() ?? '';
			const semanticRevision = canonicalJson(semanticContent(this.project.model));
			const root = this.code.context!.sourceRoot;
			const sessionId = this.exploration.id;
			const preview = await this.explorationRequest(projectReview ? { action: 'review', sessionId } : { action: 'tool', sessionId, tool: 'ordito_view_preview', arguments: { proposalId: proposal!.id } }, token, false);
			proposal = projectReview ? preview.data.proposal : proposal;
			if (!proposal || projectReview && !preview.data.reviewId) { throw new Error(localize('ordito.explore.reviewMissing', "The Project Review Could Not Be Prepared. Continue Generation and Retry.")); }
			const contents = preview.data.reviewFile ? (await this.files.readFile(URI.file(preview.data.reviewFile))).value.toString() : JSON.stringify(preview.data, null, '\t');
			const report: { changes?: OrditoDiagramReview['changes']; diff?: { items: OrditoDiagramReview['changes'] }; sourceAnchors?: OrditoDiagramReview['sources']; auditReport?: OrditoDiagramReview['auditReport'] } = JSON.parse(contents);
			if (token.isCancellationRequested || this.code.context?.sourceRoot !== root || this.project.modelUri?.toString() !== modelUri || canonicalJson(semanticContent(this.project.model)) !== semanticRevision) { return; }
			this._diagramReview = { id: proposal.id, sessionId, root, modelUri, semanticRevision, proposal: structuredClone(proposal), changes: report.changes ?? report.diff?.items ?? [], sources: report.sourceAnchors ?? [], images: preview.data.images ?? [], contents, ...(projectReview ? { projectReviewId: preview.data.reviewId, plan: preview.data.plan, tasks: preview.data.tasks, featureCatalog: preview.data.featureCatalog, featurePlans: preview.data.featurePlans, auditReport: report.auditReport } : {}), ...(preview.diagnostics.length ? { problem: preview.diagnostics.map(entry => entry.code).join(' · ') } : {}) };
			await this.editors.openEditor({ resource: OrditoInput.RESOURCE, options: { pinned: true, revealIfOpened: true } });
			this.host.changed();
		}, { kind: 'local' });
	}

	closeDiagramReview(): void { this._diagramReview = undefined; this.host.changed(); }

	async inspectDiagramReview(): Promise<void> {
		const review = this._diagramReview;
		if (review) {
			const resource = URI.joinPath(await resolveOrditoMetadataDirectory(this.files, URI.file(review.root)), 'reports', generateUuid(), localize('ordito.explore.reviewReportFile', "Diagram Review.json"));
			await this.files.createFolder(URI.joinPath(resource, '..'));
			await this.files.writeFile(resource, VSBuffer.fromString(review.contents + '\n'));
			await this.filesConfiguration.updateReadonly(resource, { value: localize('ordito.explore.readonlyReview', "This is a diagram review snapshot. Refresh the review to create an updated version.") });
			await this.editors.openEditor({ resource, options: { pinned: true } });
		}
	}

	async applyDiagramReview(): Promise<void> {
		const review = this._diagramReview;
		if (!review || review.proposal.status !== 'ready' || review.problem || this.host.busy || this.operations.busy) { return; }
		await this.host.run(async token => {
			const current = () => this._diagramReview === review && this.exploration?.id === review.sessionId && this.code.context?.sourceRoot === review.root && this.project.modelUri?.toString() === review.modelUri && canonicalJson(semanticContent(this.project.model)) === review.semanticRevision;
			try {
				if (!await this.project.save()) { throw new Error(this.project.saveError ?? localize('ordito.explore.saveRequired', "Save the Project Before Applying This Draft.")); }
				if (!current()) { throw new Error(localize('ordito.explore.reviewChanged', "The Project Changed. Review This Draft Again Before Applying It.")); }
				if (!(await this.dialogs.confirm({ message: review.projectReviewId ? localize('ordito.explore.applyAll', "Apply All Reviewed Diagram Changes?") : localize('ordito.explore.apply', "Apply This Diagram Proposal?"), detail: localize('ordito.explore.applyDetail', "{0}\nThe reviewed diagram changes are applied to the local project. Code files, Git commits and remotes are unchanged.", review.proposal.views.map(view => view.name).join(', ')), primaryButton: review.projectReviewId ? localize('ordito.review.publishAll', "Apply All Changes") : localize('ordito.review.publish', "Apply to Project") })).confirmed) { return; }
				if (!await this.project.save()) { throw new Error(this.project.saveError ?? localize('ordito.explore.saveRequired', "Save the Project Before Applying This Draft.")); }
				if (!current() || token.isCancellationRequested) { throw new Error(localize('ordito.explore.reviewChanged', "The Project Changed. Review This Draft Again Before Applying It.")); }
				const result = await this.explorationRequest(review.projectReviewId ? { action: 'publishAll', sessionId: review.sessionId, reviewId: review.projectReviewId } : { action: 'publish', sessionId: review.sessionId, proposalId: review.id }, token);
				this._diagramReview = undefined;
				if (result.data.snapshot) { const context = JSON.parse(await this.code.executeReconciliation({ operation: 'inspect', snapshot: result.data.snapshot }, token)); await this.code.openContext(context); }
				await this.refreshExploration();
			} catch (error) {
				if (this._diagramReview === review) { review.problem = error instanceof Error ? error.message : String(error); this.host.changed(); }
				throw error;
			}
		}, { kind: 'local', review });
	}

	private async readyDiagramConfig(): Promise<CliConfig | undefined> {
		if (!this.connection.config) {
			let executable = 'codex';
			if (!await this.code.resolveCli(executable)) {
				const selected = await this.connection.chooseCliExecutable('codex', executable);
				if (!selected) { this.host.report(localize('ordito.ai.setupDeferred', "Setup Cancelled · Choose Build Diagrams to Continue")); return; }
				executable = selected;
			}
			const draft: CliConfig = { version: 1, provider: 'codex', connection: 'cli', model: '', executable, timeoutMs: 180000, maxContextBytes: 262144, maxCalls: 1 };
			const model = await this.selectDiagramModel(draft);
			if (!model) { this.host.report(localize('ordito.ai.modelDeferred', "No Model Selected · Choose Build Diagrams to Continue")); return; }
			this.connection.configure({ ...draft, model });
		}
		if (!this.connection.config) { return undefined; }
		if (!this.connection.config.maxCalls) { return { ...this.connection.config }; }
		const executable = await this.connection.resolveCli(this.connection.config.provider);
		if (!executable) { return undefined; }
		const state = await this.code.checkCliAccount(this.connection.config.provider, executable);
		if (state.status === 'signedOut') {
			await this.connection.signIn(this.connection.config.provider, true);
			this.host.report(localize('ordito.ai.finishDiagramSignIn', "Finish Signing In in the Terminal, Then Choose Build Diagrams Again")); return undefined;
		}
		if (state.status !== 'signedIn') { throw new Error(localize('ordito.ai.diagramAccountCheck', "Could Not Verify the CLI Account. Check Its Connection and Retry Build Diagrams.")); }
		return { ...this.connection.config, executable };
	}

	async buildDiagrams(): Promise<void> { if (this.configuration.getValue<boolean>('ordito.diagramImport.incremental') !== false) { await this.exploreDiagrams(); } else { await this.generateDiagrams(false); } }

	async resumeDiagrams(): Promise<void> { if (this.configuration.getValue<boolean>('ordito.diagramImport.incremental') !== false) { await this.exploreDiagrams(); } else { await this.generateDiagrams(true); } }

	async updateDiagrams(): Promise<void> {
		if (this.host.busy || this.operations.busy || this.configuration.getValue<boolean>('chat.disableAIFeatures') === true || !await this.code.ensureProjectContext()) { return; }
		if (this.configuration.getValue<boolean>('ordito.diagramImport.incremental') === false) { await this.generateDiagrams(true); return; }
		await this.exploreDiagrams(localize('ordito.explore.updatePrompt', "Update the project diagrams from the current codebase using the Specsplice tools. Inspect the saved project and the workflow phase first. Identify code changes and preserve existing diagram and object IDs, feature identities and manual layout where they still apply. Keep authored scenarios and report any discrepancies with the code. Prepare the affected diagrams in workflow order and reuse existing definitions. Read only the relevant sources, validate and preview all revised drafts, and finish with a single complete project review. Do not publish changes: I will apply them from the review."), true);
	}

	private async generateDiagrams(resume: boolean): Promise<void> {
		if (this.host.busy || this.operations.busy || !this.code.context) { return; }
		await this.host.run(async token => {
			const context = this.code.context;
			const configured = await this.readyDiagramConfig();
			if (!configured || !context || !await this.project.save()) { return; }
			const diagramModel = this.storage.get(`ordito.ai.diagramModel.${configured.provider}`, StorageScope.PROFILE) ?? await this.selectDiagramModel(configured);
			if (!diagramModel) { return; }
			const config = { ...configured, model: diagramModel };
			// Completed jobs belong to their published snapshot. Updating from
			// later source changes needs a new interpretation, not a resume.
			const progress = resume && this._diagramProgress?.status !== 'complete' ? this._diagramProgress : undefined;
			let clarification: string | undefined;
			if (progress?.questions.length) { clarification = await this.quick.input({ title: localize('ordito.ai.diagramClarify', "Clarify Diagram Interpretation"), prompt: progress.questions.join(' '), ignoreFocusLost: true }); if (!clarification) { return; } }
			let job: CodeDiagramProgress = JSON.parse(await this.code.executeReconciliation({ operation: 'diagramPrepare', snapshot: context.snapshot, config: JSON.stringify(config), ...(progress ? { resume: progress.id } : {}), clarification }, token));
			this._diagramProgress = job; this.storage.store('ordito.ai.diagramJob', JSON.stringify(job), StorageScope.WORKSPACE, StorageTarget.MACHINE); this.host.changed();
			if (!config.maxCalls) { this.host.info(localize('ordito.ai.diagramsNoBudget', "Diagram Scope Prepared. Enable AI Requests in AI Settings to Generate It.")); return; }
			const accepted = job.status === 'plan' ? { confirmed: true } : await this.dialogs.confirm({ message: localize('ordito.ai.buildConfirm', "Propose a Diagram Plan with {0}?", config.model), detail: [localize('ordito.ai.buildScopeShort', "{0} files · {1} indexed symbols.\nUp to {2} additional requests to {3}.", job.files, job.symbols, job.remainingRequests ?? job.total - job.completed, config.provider === 'codex' ? 'Codex' : 'Claude Code'), localize('ordito.ai.buildDisclosure', "Source evidence is sent through your signed-in CLI account to analyze responsibilities and propose necessary diagrams. You will review the proposal before generating its views."), job.inputBudgetBytes ? localize('ordito.ai.diagramContextBudget', "Input and schema: up to {0} bytes per request. {1} bytes left as estimated response headroom.", job.inputBudgetBytes, job.responseHeadroomBytes ?? 0) : '', job.calls ? localize('ordito.ai.buildAttempted', "{0} requests already attempted. Completed steps will be reused.", job.calls) : '', job.excluded ? localize('ordito.ai.buildExcluded', "{0} documentation, binary or oversized files excluded.", job.excluded) : ''].filter(Boolean).join('\n\n'), primaryButton: localize('ordito.ai.buildButton', "Propose Diagrams") });
			if (!accepted.confirmed) { return; }
			this.diagramRunning = true;
			while (job.status === 'ready' || job.status === 'running' || job.status === 'plan') {
				if (job.status === 'plan') {
					this.diagramRunning = false; this.host.report(localize('ordito.ai.diagramPlanReady', "Diagram Plan Ready · Review Before Generating Views"));
					const plan = job.plan ?? [];
					const approved = await this.dialogs.confirm({ message: localize('ordito.ai.reviewDiagramPlan', "Review the Proposed Diagrams"), detail: [plan.map((item, index) => localize('ordito.ai.diagramPlanRow', "{0}. {1} · {2}\n{3}", index + 1, item.name, viewLabels[item.kind], item.intent)).join('\n\n'), localize('ordito.ai.diagramPlanBudget', "{0} diagrams · Up to {1} additional requests to {2}. Each diagram is a saved step. All approved diagrams must pass validation before the new snapshot is published.", plan.length, job.remainingRequests ?? plan.length, job.model)].join('\n\n'), primaryButton: localize('ordito.ai.generatePlan', "Generate {0} Diagrams", plan.length) });
					if (!approved.confirmed) { this.host.report(localize('ordito.ai.diagramPlanSaved', "Diagram Plan Saved · Review Diagram Plan to Continue")); return; }
					if (this.code.context?.snapshot !== context.snapshot) { throw new Error(localize('ordito.ai.diagramProjectChanged', "The Active Project Changed. Open Its Diagrams to Continue.")); }
					job = JSON.parse(await this.code.executeReconciliation({ operation: 'diagramApprovePlan', snapshot: context.snapshot, id: job.id, reviewId: job.reviewId }, token));
					this._diagramProgress = job; this.storage.store('ordito.ai.diagramJob', JSON.stringify(job), StorageScope.WORKSPACE, StorageTarget.MACHINE); this.diagramRunning = true; this.host.changed();
					continue;
				}
				const nextDiagram = job.plan?.find(item => item.status !== 'complete');
				this.host.report(nextDiagram ? localize('ordito.ai.generatingView', "Generating {0} · {1} · {2}", nextDiagram.name, viewLabels[nextDiagram.kind], job.model) : localize('ordito.ai.planningDiagramStep', "Analyzing Responsibilities and Planning Diagrams · {0} of {1} Steps · {2}", job.completed, job.total, job.model));
				try { job = JSON.parse(await this.code.executeReconciliation({ operation: 'diagramStep', snapshot: context.snapshot, id: job.id, reviewId: job.reviewId }, token)); }
				catch (error) {
					this._diagramProgress = { ...job, status: 'failed', error: token.isCancellationRequested ? localize('ordito.ai.diagramPaused', "Generation Paused · Resume to Keep Completed Steps") : error instanceof Error ? error.message : String(error) };
					this.storage.store('ordito.ai.diagramJob', JSON.stringify(this._diagramProgress), StorageScope.WORKSPACE, StorageTarget.MACHINE); throw error;
				}
				if (this.code.context?.snapshot !== context.snapshot) { throw new Error(localize('ordito.ai.diagramProjectChanged', "The Active Project Changed. Open Its Diagrams to Continue.")); }
				this._diagramProgress = job; this.storage.store('ordito.ai.diagramJob', JSON.stringify(job), StorageScope.WORKSPACE, StorageTarget.MACHINE); this.host.changed();
				if (job.context) { await this.code.openContext(job.context); this.host.report(localize('ordito.ai.diagramsReady', "Diagrams Ready · {0} Responsibilities in {1} Views", this.project.model.semantics.elements.filter(item => item.kind !== 'feature').length, this.project.model.views.length)); return; }
				if (job.questions.length) { this.host.info(job.questions.join('\n')); return; }
			}
		}, { kind: 'diagram' });
	}

	async chooseDiagramModel(): Promise<void> {
		if (this.host.busy || this.operations.busy || !await this.connection.ensureConfigured()) { return; }
		const selected = await this.selectDiagramModel(this.connection.config!);
		if (selected && this.exploration && !this._diagramExploration?.phase && this.configuration.getValue<boolean>('ordito.diagramImport.incremental') !== false) { await this.chat(); }
		else if (selected) { this.host.changed(); }
	}

	private async selectDiagramModel(configured: CliConfig): Promise<string | undefined> {
		const choices = (configured.provider === 'codex' && configured.executable !== 'codex' && this.connection.config?.executable !== 'codex' ? [] : this.connection.nativeModels(configured.provider)).sort((a, b) => (a.rates ? a.rates.input + a.rates.output : Infinity) - (b.rates ? b.rates.input + b.rates.output : Infinity));
		const model = choices.length ? (await this.quick.pick(choices, { title: localize('ordito.ai.diagramModel', "Model for Diagrams"), placeHolder: localize('ordito.ai.diagramModelHint', "Choose a Lower-Cost Model for Interpretation. Your Coding Model Is Kept Separately.") }))?.id : await this.quick.input({ title: localize('ordito.ai.diagramModel', "Model for Diagrams"), value: this.storage.get(`ordito.ai.diagramModel.${configured.provider}`, StorageScope.PROFILE) ?? configured.model, prompt: localize('ordito.ai.diagramModelManual', "Use an exact model ID shown by /model in Codex or by your provider CLI. This model is saved separately for diagrams."), ignoreFocusLost: true });
		if (model) { this.storage.store(`ordito.ai.diagramModel.${configured.provider}`, model, StorageScope.PROFILE, StorageTarget.MACHINE); }
		return model;
	}

	constructor(
		private readonly host: Pick<OrditoAiWorkflow, 'activityStatus' | 'busy' | 'report' | 'changed' | 'run' | 'info'>,
		private readonly connection: OrditoAiConnection,
		@IOrditoProjectService private readonly project: OrditoAiProject,
		@IOrditoCodeService private readonly code: IOrditoCodeService,
		@IQuickInputService private readonly quick: IQuickInputService,
		@INotificationService private readonly notifications: INotificationService,
		@IDialogService private readonly dialogs: IDialogService,
		@IFileService private readonly files: IFileService,
		@IEditorService private readonly editors: IEditorService,
		@IFilesConfigurationService private readonly filesConfiguration: IFilesConfigurationService,
		@IOrditoAiDialogService private readonly aiDialog: IOrditoAiDialogService,
		@ICodexAccountService private readonly codexAccount: ICodexAccountService,
		@IAgentSdkSetupService private readonly setup: IAgentSdkSetupService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IStorageService private readonly storage: IStorageService,
		@IWorkspaceTrustRequestService private readonly trust: IWorkspaceTrustRequestService,
		@IOrditoOperationService private readonly operations: OrditoOperationService,
		@ILanguageModelToolsService private readonly tools: ILanguageModelToolsService,
		@IAgentHostActiveClientService private readonly activeClients: IAgentHostActiveClientService,
		@ILanguageModelsService private readonly languageModels: ILanguageModelsService
	) {
		super();
		try { this.exploration = JSON.parse(this.storage.get('ordito.ai.exploration', StorageScope.WORKSPACE) ?? 'null') ?? undefined; } catch { /* Invalid session must be reopened. */ }
		const saved = this.storage.get('ordito.ai.diagramJob', StorageScope.WORKSPACE);
		if (saved) { try { this._diagramProgress = JSON.parse(saved); } catch { /* Invalid saved progress. */ } }

	}

	get diagramReview(): OrditoDiagramReview | undefined { return this._diagramReview; }
	get diagramProgress(): CodeDiagramProgress | undefined { return this._diagramProgress; }
	get diagramExploration(): CodeDiagramExploration | undefined { return this._diagramExploration; }
	get diagramActivity(): readonly OrditoDiagramActivity[] | undefined { return this.exploration?.root === this.code.context?.sourceRoot ? this.exploration?.activity : undefined; }
	get diagramLiveProgress(): OrditoDiagramLiveProgress | undefined { return this.exploration?.root === this.code.context?.sourceRoot && this.exploration?.snapshot === this.code.context?.snapshot ? this._diagramLiveProgress : undefined; }
	get diagramExplorationIssue(): string | undefined { return this._diagramExplorationIssue; }
	get diagramClarification(): string | undefined {
		const state = this._diagramExploration;
		if (!state || this.exploration?.root !== this.code.context?.sourceRoot) { return undefined; }
		const clarification = this.exploration?.clarification;
		if (clarification && clarification.checkpoint === checkpoint(state)) { return clarification.answer ? undefined : clarification.question; }
		return state.tasks.find(task => task.id === state.nextTaskId && task.status === 'waitingUser')?.gaps.find(gap => gap.trim());
	}
	stopDiagramExploration(showProgress = true): void {
		const run = this.explorationRun.value;
		if (!run || run.token.isCancellationRequested) { return; }
		const context = this.code.context;
		const stopping = showProgress && context && this.exploration?.root === context.sourceRoot && this.exploration.snapshot === context.snapshot;
		if (stopping) {
			const updatedAt = Date.now();
			this._diagramLiveProgress = { ...this._diagramLiveProgress, state: 'stopping', activeTool: undefined, startedAt: this._diagramLiveProgress?.startedAt ?? updatedAt, updatedAt };
		}
		run.cancel();
		if (stopping) { this.host.changed(); }
	}
	async clarifyDiagramExploration(): Promise<void> {
		const session = this.exploration, state = this._diagramExploration, question = this.diagramClarification;
		if (!session || !state || !question || this.host.busy || this.operations.busy) { return; }
		const answer = await this.quick.input({
			title: localize('ordito.explore.clarification', "Clarification Needed"),
			prompt: question,
			ignoreFocusLost: true,
			validateInput: async value => value.trim().length > 2000 ? localize('ordito.explore.answerLength', "Enter an Answer of 2,000 Characters or Fewer.") : undefined
		});
		if (!answer?.trim() || answer.trim().length > 2000 || this.exploration !== session || this._diagramExploration !== state || this.diagramClarification !== question) { return; }
		session.clarification = { checkpoint: checkpoint(state), question, answer: answer.trim() };
		this.persistExploration();
		this.host.changed();
		await this.runFeatureExploration();
	}
	beginGeneration(): void { this.diagramError?.close(); this.diagramError = undefined; }
	failGeneration(error: unknown): void { this.diagramError = this.notifications.notify({ severity: Severity.Error, message: orditoErrorNotification(error, 'ai', this.project.model) }); }
	finishOperation(): void { this.diagramRunning = false; }
	resetProject(): void {
		this.stopDiagramExploration(false);
		this.appliedExplorationRefresh = ++this.explorationRefresh;
		this.diagramRequestId = undefined;
		this._diagramLiveProgress = undefined;
		void this.aiDialog.close().catch(error => { if (!isCancellationError(error)) { this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model)); } });
		this.conversation = undefined; this.conversationWatch.clear();
		this.explorationTools.clear(); this.explorationBinding = undefined;
		this._diagramExploration = undefined; this._diagramExplorationIssue = undefined; this._diagramReview = undefined;
	}
	followCodeContext(): void {
		const context = this.code.context;
		if (this.explorationRun.value && (context?.sourceRoot !== this.exploration?.root || context?.snapshot !== this.exploration?.snapshot)) { this.stopDiagramExploration(false); }
		if (this.conversation && context && this.conversation.root !== context.sourceRoot) { void this.aiDialog.close().catch(error => { if (!isCancellationError(error)) { this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model)); } }); this.conversation = undefined; this.conversationWatch.clear(); this.host.activityStatus = undefined; this.host.changed(); }
		if (this.exploration && context && this.exploration.root !== context.sourceRoot) { this.explorationTools.clear(); this.explorationBinding = undefined; this._diagramExploration = undefined; this._diagramExplorationIssue = undefined; }
		if (this._diagramProgress && context && this._diagramProgress.sourceRoot !== context.sourceRoot) { this._diagramProgress = undefined; this.host.changed(); }
		const session = this.exploration;
		if (session && context?.sourceRoot === session.root && !this._diagramExploration && this.configuration.getValue<boolean>('ordito.diagramImport.incremental') !== false) {
			const key = JSON.stringify([session.root, session.id, context.snapshot]);
			if (this.restoringExploration === key) { return; }
			this.restoringExploration = key;
			void this.refreshExploration(true).catch(error => {
				if (this.exploration === session && this.code.context?.sourceRoot === session.root && !isCancellationError(error)) { this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model)); }
			}).finally(() => { if (this.restoringExploration === key) { this.restoringExploration = undefined; } });
		}

	}

	override dispose(): void {
		this.stopDiagramExploration(false);
		super.dispose();
	}
}
