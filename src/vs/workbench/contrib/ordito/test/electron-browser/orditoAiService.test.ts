import assert from 'assert';
import sinon from 'sinon';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ServiceIdentifier } from '../../../../../platform/instantiation/common/instantiation.js';
import { IInputOptions, IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IProgressService } from '../../../../../platform/progress/common/progress.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../../platform/files/common/files.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { InMemoryStorageService, IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceTrustRequestService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { IAgentHostService } from '../../../../../platform/agentHost/common/agentService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IFilesConfigurationService } from '../../../../services/filesConfiguration/common/filesConfigurationService.js';
import { ICodexAccountService, ICodexAccountViewInfo } from '../../../../services/agentHost/browser/codexAccountService.js';
import { IAgentSdkSetupService } from '../../../../services/agentHost/browser/agentSdkSetupService.js';
import { ILanguageModelsService } from '../../../chat/common/languageModels.js';
import { ILanguageModelToolsService, IToolData, IToolImpl } from '../../../chat/common/tools/languageModelToolsService.js';
import { IAgentHostActiveClientService } from '../../../chat/browser/agentSessions/agentHost/agentHostActiveClientService.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { IOrditoAiDialogService, type OrditoAiDialogOptions } from '../../browser/orditoAiDialog.js';
import { IChatWidgetService } from '../../../chat/browser/chat.js';
import { ITerminalService, ITerminalGroupService } from '../../../terminal/browser/terminal.js';
import { IOrditoProjectService } from '../../browser/orditoProjectService.js';
import { IOrditoCodeService } from '../../browser/orditoCodeService.js';
import { IOrditoOperationService, OrditoOperationService } from '../../browser/orditoOperationService.js';
import { CliAccountState, CodeContext, CodeDiagramProgress, CodeDiagramExploration, CodePreview, CodeRequest, type CodeDiagramCheckpointResult, type CodeUpdateResult } from '../../common/codeBridge.js';
import { diagramCheckpointReasoningEffortSetting, diagramCheckpointTimeoutSetting, diagramExplorationBudgetSetting } from '../../common/diagramExplorationSettings.js';
import { OrditoAiService } from '../../electron-browser/orditoAiService.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { stateFixture, stateCriteriaFixture } from '../common/stateFixture.js';
import { nodeOrdersFixture } from '../common/nodeOrdersFixture.js';
import { diagramToolDefinitions } from '../../common/diagramTools.js';
import { checkoutModel } from '../../common/checkoutModel.js';
import { featureCodeProfiles, type FeatureCodeGenerationRun } from '../../common/featureCodeGeneration.js';
import { savedModelChanges, type SavedModelChange } from '../../common/modelCodeUpdate.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';

interface Choice { description?: string; value?: unknown; label?: string; id?: string; provider?: string; maxCalls?: number; picked?: boolean; send?: boolean; generate?: boolean; propose?: boolean }
type ExplorationBudget = CodeDiagramExploration['budget'];
type BudgetEditorOptions = Parameters<IOrditoAiDialogService['editDiagramBudget']>[0];
const config = { version: 1, provider: 'codex', connection: 'cli', executable: 'codex', model: 'native-model', timeoutMs: 10000, maxContextBytes: 65536, maxCalls: 2 };
const defaultProjectBudget: ExplorationBudget = { maxToolCalls: 800, maxReadBytes: 16 * 1024 * 1024, maxDurationMs: 180 * 60_000, maxModelTurns: 64 };
const budgetIncrease: ExplorationBudget = { maxToolCalls: 100, maxReadBytes: 2 * 1024 * 1024, maxDurationMs: 30 * 60_000, maxModelTurns: 8 };

suite('Specsplice native AI orchestration', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture(configured = true, executable = 'codex', maxCalls = 2, savedExploration?: { id: string; resource?: string }) {
		const instantiation = store.add(new TestInstantiationService());
		const stub = <T extends object>(id: ServiceIdentifier<T>, values: object) => { const service = Object.assign(new (mock<T>())(), values); instantiation.stub(id, service); return service; };
		const storage = store.add(new InMemoryStorageService());
		if (configured) { storage.store('ordito.ai.cliConfig', JSON.stringify({ ...config, executable, maxCalls }), StorageScope.PROFILE, StorageTarget.MACHINE); }
		const changed = store.add(new Emitter<void>());
		const aiProgress = store.add(new Emitter<import('../../common/codeBridge.js').CodeAiProgress>());
		const liveUpdates: import('../../common/codeBridge.js').CodeAiProgress[] = [];
		const projectChanged = store.add(new Emitter<void>());
		const savedModel = store.add(new Emitter<SavedModelChange>());
		const contextFiles = new Map<string, string>();
		const chatRequests: Extract<CodeRequest, { operation: 'diagramChat' }>[] = [];
		const codeUpdateRequests: Extract<CodeRequest, { operation: 'codeUpdate' }>[] = [];
		const codeUpdateNotifications: { run(): void }[] = [];
		let onCodeUpdate: ((token: CancellationToken) => Promise<CodeUpdateResult>) | undefined;
		const diagramPrepares: Extract<CodeRequest, { operation: 'diagramPrepare' }>[] = [];
		const root = '/workspace/ordito-ai-fixture';
		if (savedExploration) { storage.store('ordito.ai.exploration', JSON.stringify({ root, snapshot: root + '/.ordito/imports/fixture', ...savedExploration }), StorageScope.WORKSPACE, StorageTarget.MACHINE); }
		const context: CodeContext = { snapshot: root + '/.ordito/imports/fixture', model: root + '/.ordito/imports/fixture/model.ordito.json', sourceRoot: root, revision: 'fixture',
			scope: { include: ['**'], exclude: [], excludedDirectories: ['.ordito'], respectGitignore: true, languageOverrides: {} },
			files: [{ path: 'checkout.mjs', language: 'javascript', status: 'parsed', diagnostics: [] }],
			declarations: [{ id: 'checkout-controller', sourceId: 'checkout-controller', name: 'Checkout', kind: 'action', evidence: { file: 'checkout.mjs', revision: 'fixture', start: 0, end: 10, line: 1, endLine: 1 } }], dependencies: [], providers: [], diagnostics: [] };
		let accountState: CliAccountState = { status: 'signedIn' };
		let resolveExecutable: (executable: string) => Promise<string | undefined> = async executable => executable;
		const opened: CodeContext[] = [];
		let projectContext = Promise.resolve(true);
		const code = { changed: false, ensureProjectContext: async () => projectContext, openContext: async (value: CodeContext) => { opened.push(value); }, context, onDidChange: changed.event, onDidAiProgress: aiProgress.event, executeCollaboration: async (input: string) => execute(input), executeReconciliation: async (request: CodeRequest, token?: CancellationToken) => execute(JSON.stringify(request), token), resolveCli: (executable: string) => resolveExecutable(executable), checkCliAccount: async () => accountState };
		const picks: ((items: readonly Choice[]) => Choice | Choice[] | undefined)[] = [];
		const inputs: string[] = [];
		const inputOptions: IInputOptions[] = [];
		const configurationValues = new Map<string, unknown>();
		const configurationEdits: { key: string; value: unknown; target: ConfigurationTarget }[] = [];
		const budgetEditors: BudgetEditorOptions[] = [];
		let editBudget: IOrditoAiDialogService['editDiagramBudget'] | undefined;
		const chats: { resource: string; attachments: string[]; focused: boolean }[] = [];
		const chatPrompts: string[] = [];
		const pickerTitles: string[] = [];
		const pickerOptions: { title: string; activeItem?: Choice; placeHolder?: string; ignoreFocusLost?: boolean }[] = [];
		const editorInputs: object[] = [];
		const readonlyResources: string[] = [];
		let failPureApply = false;
		let confirmed = true, failDiagram = false, hiddenPanels = 0, closedAlerts = 0;
		const dialogDetails: string[] = [];
		const confirmations: boolean[] = [];
		let plannedProgress: CodeDiagramProgress | undefined;
		let diagramPrepareError: Error | undefined;
		let exploratoryDraft: CodeDiagramExploration['proposals'][number] | undefined, exploratoryApplied = false;
		const explorationActions: string[] = [];
		let projectWorkflow = false;
		let featureState: Partial<CodeDiagramExploration> | undefined;
		let onCheckpoint: ((request: Extract<CodeRequest, { operation: 'diagramChat' }>, token: CancellationToken) => Promise<string | CodeDiagramCheckpointResult>) | undefined;
		let onExplorationStatus: ((response: string) => Promise<string>) | undefined;
		let explorationBudget: ExplorationBudget = { maxToolCalls: 80, maxReadBytes: 1048576, maxDurationMs: 1800000, maxModelTurns: 8 }, explorationBudgetStarted = Date.now();
		const explorationBudgetRequests: { sessionId: string; budgetIncrease: ExplorationBudget }[] = [];
		const explorationOpens: { sessionId?: string; budget?: ExplorationBudget }[] = [];
		const explorationSessionIds: (string | undefined)[] = [];
		let explorationId = savedExploration?.id ?? generateUuid(), explorationMissing = false, explorationReadError: Error | undefined;
		let planApproved = false;
		const attachmentFiles = new Map<string, URI[]>();
		const deletedAttachments: string[] = [];
		const diagramContexts: string[] = [];
		const errors: string[] = [];
		const infos: string[] = [];
		const terminals: object[] = [];
		const dialogs: OrditoAiDialogOptions[] = []; let activeDialog: OrditoAiDialogOptions | undefined;
		const requests: string[] = [];
		const sourceSelections: string[][] = [];
		let signIns = 0, disabled = false, incremental = false;
		const nativeDiagramModels: string[] = [], selectedChatModels: string[] = [];
		stub(ILanguageModelsService, { getLanguageModelIds: () => nativeDiagramModels.map(id => 'native:' + id), lookupLanguageModel: (identifier: string) => ({ id: '@provider=openai:' + identifier.slice('native:'.length), targetChatSessionType: 'agent-host-codex' }) });
		const diagramTools = new Map<string, { data: IToolData; impl: IToolImpl }>();
		const sessionTools = new Map<string, readonly string[]>();
		stub(ILanguageModelToolsService, { registerTool: (data: IToolData, impl: IToolImpl) => { diagramTools.set(data.id, { data, impl }); return toDisposable(() => diagramTools.delete(data.id)); } });
		stub(IAgentHostActiveClientService, { setSessionTools: (resource: URI, ids: string[]) => sessionTools.set(resource.toString(), ids), clearSessionTools: (resource: URI) => { const ids = sessionTools.get(resource.toString()); for (const [key, current] of sessionTools) { if (current === ids) { sessionTools.delete(key); } } }, moveSessionTools: (source: URI, target: URI) => { const ids = sessionTools.get(source.toString()); if (ids) { sessionTools.set(target.toString(), ids); } }, acquireSessionTools: (resource: URI) => ({ object: observableValue('session-tools', (sessionTools.get(resource.toString()) ?? []).map(id => ({ name: diagramTools.get(id)!.data.toolReferenceName }))), dispose: () => {} }) });
		let terminalError: Error | undefined;
		let terminalFocus: Promise<void> = Promise.resolve();
		const focusRequested = new DeferredPromise<void>();
		const terminalExit = store.add(new Emitter<number>());
		const account: { status: ICodexAccountViewInfo['status']; authUrl?: string } = { status: 'signedOut' };
		const accountChanged = store.add(new Emitter<ICodexAccountViewInfo>());
		let trust: Promise<boolean> | undefined;
		const setups: { agent: string; download: string }[] = [];
		instantiation.stub(IStorageService, storage);
		const operations = store.add(new OrditoOperationService());
		instantiation.stub(IOrditoOperationService, operations);
		const project = { model: structuredClone(checkoutModel), modelUri: URI.file(context.model), editable: true, onDidSaveModel: savedModel.event, onDidChange: projectChanged.event, save: async () => true };
		const updateState = {
			lastSavedChange: undefined as SavedModelChange | undefined,
			acknowledgeCodeUpdate: (change: SavedModelChange) => { if (change.modelUri === updateState.lastSavedChange?.modelUri) { updateState.lastSavedChange = undefined; Object.assign(projectService, updateState); } }
		};
		let reverted = 0;
		Object.assign(project, { projectRoot: URI.file(root), revert: async () => { reverted++; } });
		const projectService = stub(IOrditoProjectService, { ...project, ...updateState });
		stub(ICommandService, { executeCommand: async () => {} });
		const codeService = stub(IOrditoCodeService, code);
		stub(IQuickInputService, { pick: async (items: Choice[], options?: { title: string; activeItem?: Choice; placeHolder?: string; ignoreFocusLost?: boolean }) => { if (options) { pickerTitles.push(options.title); pickerOptions.push(options); } if (options?.title === 'Review Implementation Context' || options?.title === 'Review Implementation Plan' || options?.title === 'Review Sync Context') { return (confirmations.shift() ?? confirmed) ? items.find(item => item.send || item.generate || item.propose) : undefined; } return picks.shift()?.(items); }, input: async (options?: IInputOptions) => { if (options) { inputOptions.push(options); } return inputs.shift(); } });
		stub(INotificationService, {
			notify: (notification: { message: string }) => { errors.push(notification.message); return { close: () => { closedAlerts++; } }; },
			prompt: (_severity: number, _message: string, choices: { run(): void }[]) => { codeUpdateNotifications.push(...choices); },
			error: (message: string) => errors.push(message), info: (message: string) => infos.push(message)
		});
		stub(IProgressService, { withProgress: async (_options: object, task: (progress: { report(step: { message: string }): void }) => Promise<void>) => task({ report: () => {} }) });
		stub(IDialogService, { confirm: async (options: { detail: string }) => { dialogDetails.push(options.detail); return { confirmed: confirmations.shift() ?? confirmed }; } });
		let stateData: string | undefined;
		const fileChanges = store.add(new Emitter<{ contains(resource: URI): boolean }>());
		stub(IFileService, { createWatcher: () => ({ onDidChange: fileChanges.event, dispose: () => {} }), createFolder: async () => {}, writeFile: async (resource: URI, content: VSBuffer) => { contextFiles.set(resource.fsPath, content.toString()); }, exists: async () => stateData !== undefined,
			stat: async () => { if (explorationReadError) { throw explorationReadError; } if (explorationMissing) { throw new FileOperationError('Exploration session was removed', FileOperationResult.FILE_NOT_FOUND); } return { isFile: true }; },
			readFile: async (resource: URI) => ({ value: VSBuffer.fromString(resource?.path.endsWith('/review-fixture.json') ? '{"changes":[{"before":null,"after":{"name":"Reviewed responsibility"}}]}' : stateData ?? '') }) });
		stub(IFilesConfigurationService, { updateReadonly: async (resources: URI | URI[]) => { readonlyResources.push(...(Array.isArray(resources) ? resources : [resources]).map(resource => resource.toString())); } });
		stub(IEditorService, { editors: [], onDidVisibleEditorsChange: Event.None, openEditor: async (input: object) => { editorInputs.push(input); return undefined; } });
		stub(ITextModelService, {});
		stub(ITerminalService, { createTerminal: async (options: { config: object }) => { if (terminalError) { throw terminalError; } terminals.push({ config: options.config }); return { focusWhenReady: async () => { await focusRequested.complete(); await terminalFocus; }, onExit: terminalExit.event }; }, setActiveInstance: () => {} });
		stub(ITerminalGroupService, { showPanel: async () => {}, hidePanel: () => { hiddenPanels++; } });
		stub(IChatWidgetService, { openSession: async (resource: URI) => {  const chat = { resource: resource.toString(), attachments: [] as string[], focused: false }; chats.push(chat); return { input: { setCurrentLanguageModel: (model: { identifier: string }) => selectedChatModels.push(model.identifier) }, attachmentModel: { get fileAttachments() { return attachmentFiles.get(resource.toString()) ?? []; }, delete: (id: string) => { deletedAttachments.push(id); attachmentFiles.set(resource.toString(), (attachmentFiles.get(resource.toString()) ?? []).filter(uri => uri.toString() !== id)); }, addFile: async (uri: URI) => { chat.attachments.push(uri.toString()); attachmentFiles.set(resource.toString(), [...(attachmentFiles.get(resource.toString()) ?? []), uri]); }, updateContext: (_deleted: string[], entries: { value: string }[]) => { diagramContexts.push(entries[0].value); } }, setInput: (value: string) => { chatPrompts.push(value); }, setInputPlaceholder: () => {}, focusInput: () => { chat.focused = true; } }; } });
		stub(IOrditoAiDialogService, {
			updateConversation: (event: import('../../common/codeBridge.js').CodeAiProgress) => liveUpdates.push(event),
			updateProgress: () => {},
			open: async (options: OrditoAiDialogOptions) => { dialogs.push(options); activeDialog = options; return options.resource ? instantiation.get(IChatWidgetService).openSession(options.resource) : undefined; },
			close: async () => { const options = activeDialog; activeDialog = undefined; await options?.onClose(); },
			editDiagramBudget: async (options: BudgetEditorOptions) => {
				budgetEditors.push(structuredClone(options));
				return editBudget?.(options);
			}
		});
		stub(ICodexAccountService, { account, onDidChangeAccount: accountChanged.event, signIn: () => signIns++ });
		stub(IAgentSdkSetupService, { setups, requestReload: () => {} });
		stub(IAgentHostService, { rootState: { value: { agents: [{ provider: 'codex', models: [{ id: '@provider=openai:native-model', name: 'Native Account', provider: 'codex' }, { id: '@provider=vscode-proxy:proxy-model', name: 'Other Account', provider: 'codex' }] }] } } });
		stub(IConfigurationService, {
			getValue: (key: string) => key === 'chat.disableAIFeatures' ? disabled : key === 'ordito.diagramImport.incremental' ? incremental : configurationValues.get(key),
			updateValue: async (key: string, value: unknown, target: ConfigurationTarget) => {
				configurationValues.set(key, value);
				configurationEdits.push({ key, value, target });
			}
		});
		stub(IWorkspaceTrustRequestService, { requestWorkspaceTrust: async () => trust ?? true });
		const session = { id: '11111111-1111-4111-8111-111111111111', root, worktree: root + '/.ordito/worktrees/fixture', reviewId: 'changes', status: 'staged', generated: { summary: 'Payment refusal', files: [{ file: 'checkout.mjs', content: 'export const result = false;' }] }, before: [{ file: 'checkout.mjs', content: 'export const result = true;' }], usage: { inputTokens: 10, outputTokens: 20 }, cost: null };
		const pure = { observed: [{ file: '.ordito/model.json', value: { content: JSON.stringify(nodeOrdersFixture), mode: 420 } }], next: { model: nodeOrdersFixture }, id: '22222222-2222-4222-8222-222222222222', root, reviewId: 'pure-review', status: 'staged', mutations: [{ file: 'src/predicate.mjs', before: null, after: { content: 'pure', mode: 420 } }], coverage: { forward: 'pure-v1' }, criteria: { cases: [{ id: 'independent' }] }, packets: [{ packet: { bytes: '{"seal":"pure"}' } }], calls: 0 };
		const featureIds = ['purchase', 'refund'];
		let featureRun: FeatureCodeGenerationRun = { id: 'feature-review', root, mode: 'create', profileId: 'node.esm', status: 'prepared', featureIds, tasks: featureIds.map(id => ({ id, name: id, status: 'pending', gaps: [] })), files: [] };
		let pureAligned = false;
		const execute = async (inputText: string, token = CancellationToken.None) => {
				const request: { operation: string } = JSON.parse(inputText); requests.push(request.operation);
				switch (request.operation) {
					case 'codeUpdate': {
						const update = JSON.parse(inputText) as Extract<CodeRequest, { operation: 'codeUpdate' }>;
						codeUpdateRequests.push(update);
						aiProgress.fire({ requestId: update.requestId!, kind: 'thinking' });
						return JSON.stringify(onCodeUpdate ? await onCodeUpdate(token) : { outcome: 'implemented', text: 'Updated checkout and ran its focused tests.' });
					}
					case 'diagramChat': {
						const chat = JSON.parse(inputText) as Extract<CodeRequest, { operation: 'diagramChat' }>;
						chatRequests.push(chat);
						const value = chat.checkpoint && onCheckpoint ? await onCheckpoint(chat, token) : 'Diagrams prepared';
						if (typeof value === 'string') {
							aiProgress.fire({ requestId: chat.requestId!, kind: 'message', itemId: 'reply', text: value });
							return JSON.stringify({ text: value });
						}
						return JSON.stringify(value);
					}
					case 'exploration': {
						const input = JSON.parse((JSON.parse(inputText) as { request: string }).request);
						explorationActions.push(input.tool ?? input.action);
						if (input.action === 'budget') {
							const increase: ExplorationBudget = input.budgetIncrease;
							explorationBudgetRequests.push({ sessionId: input.sessionId, budgetIncrease: increase });
							const now = Date.now();
							const remainingMs = Math.max(0, explorationBudget.maxDurationMs - (now - explorationBudgetStarted));
							explorationBudget = {
								maxToolCalls: explorationBudget.maxToolCalls + increase.maxToolCalls,
								maxReadBytes: explorationBudget.maxReadBytes + increase.maxReadBytes,
								maxModelTurns: explorationBudget.maxModelTurns + increase.maxModelTurns,
								maxDurationMs: increase.maxDurationMs ? remainingMs + increase.maxDurationMs : explorationBudget.maxDurationMs
							};
							if (increase.maxDurationMs) { explorationBudgetStarted = now; }
						}
						if (input.action === 'open') {
							explorationSessionIds.push(input.sessionId);
							explorationOpens.push({ sessionId: input.sessionId, budget: input.budget });
							if (input.sessionId && explorationMissing) { throw new Error('ENOENT: saved exploration session was removed'); }
							if (!input.sessionId) {
								explorationId = generateUuid();
								explorationMissing = false;
								if (input.budget) {
									explorationBudget = structuredClone(input.budget);
									explorationBudgetStarted = Date.now();
								}
							}
						}
						if (input.action === 'review') { return JSON.stringify({ sessionId: explorationId, data: { reviewId: 'whole-project-review', proposal: { id: 'whole-project-review', status: 'ready', diagnostics: [], views: checkoutModel.views.slice(0, 2) }, reviewFile: root + '/.ordito/exploration/review-fixture.json', images: checkoutModel.views.slice(0, 2).map(view => ({ viewId: view.id, path: root + '/.ordito/exploration/' + view.id + '.svg' })) }, diagnostics: [] }); }
						if (input.action === 'publish' || input.action === 'publishAll') { exploratoryApplied = true; return JSON.stringify({ sessionId: explorationId, data: { snapshot: root + '/.ordito/imports/published' }, diagnostics: [] }); }
						if (input.action === 'tool') { return JSON.stringify({ sessionId: explorationId, data: input.tool === 'ordito_view_preview' ? { reviewFile: root + '/.ordito/exploration/review-fixture.json', images: [{ path: root + '/.ordito/exploration/preview.svg', viewId: 'overview' }] } : { files: [] }, diagnostics: [] }); }
						const response = JSON.stringify({ sessionId: explorationId, data: { sessionId: explorationId, model: featureState ? input.model ?? 'native-model' : 'chat-selected', ...(projectWorkflow ? { workflow: 'project', batch: { blockers: [] } } : {}), budget: explorationBudget, budgetWindow: { started: explorationBudgetStarted, measuredAt: Date.now(), elapsedMs: Date.now() - explorationBudgetStarted, remainingMs: Math.max(0, explorationBudget.maxDurationMs - (Date.now() - explorationBudgetStarted)) }, usage: { toolCalls: 0, readBytes: 0, modelTurns: [], turnsObservable: false, inputTokens: null, outputTokens: null }, tasks: [], proposals: exploratoryDraft ? [{ ...exploratoryDraft, status: exploratoryApplied ? 'applied' : exploratoryDraft.status }] : [], ...featureState, mcp: { command: 'node', args: ['orditoDiagramMcp.js', root] } }, diagnostics: [] });
						return input.action === 'status' && onExplorationStatus ? onExplorationStatus(response) : response;
					}
					case 'inspect': return JSON.stringify({ ...context, snapshot: root + '/.ordito/imports/published', diagramState: 'diagrams' });
					case 'structuralPrepare': return JSON.stringify(pureAligned ? { status: 'aligned', calls: 0 } : { status: 'staged', calls: 0, session: pure });
					case 'structuralVerify': return JSON.stringify({ ...pure, status: 'passed', verification: { code: 0, output: 'Independent case passed', independent: 1 } });
					case 'structuralApply': if (failPureApply) { throw new Error('Structural source inventory changed; prepare a new review'); } return JSON.stringify({ ...pure, status: 'applied' });
					case 'structuralUndo': return JSON.stringify({ ...pure, status: 'undone' });
					case 'structuralSession': return JSON.stringify(pure);
					case 'structuralRecover': return JSON.stringify({ ...pure, status: 'rolledBack' });
					case 'featureImplementationInspect': return JSON.stringify({ mode: 'create', profiles: featureCodeProfiles, defaultProfileId: 'node.esm' });
					case 'featureImplementationPrepare': case 'featureImplementationSession': return JSON.stringify(featureRun);
					case 'featureImplementationStep': {
						const task = featureRun.tasks.find(task => task.status === 'pending')!;
						task.status = 'ready';
						if (featureRun.tasks.every(task => task.status === 'ready')) { featureRun = { ...featureRun, status: 'ready', reviewId: 'sealed', files: [{ file: 'src/features/purchase.mjs', kind: 'create' }] }; }
						return JSON.stringify(featureRun);
					}
					case 'featureImplementationVerify': featureRun = { ...featureRun, status: 'verified', verification: { passed: true } }; return JSON.stringify(featureRun);
					case 'featureImplementationApply': featureRun = { ...featureRun, status: 'applied' }; return JSON.stringify(featureRun);
					case 'featureImplementationUndo': featureRun = { ...featureRun, status: 'undone' }; return JSON.stringify(featureRun);
					case 'prepare': return JSON.stringify({ reviewId: 'context', request: { snapshot: context.snapshot }, context: { sources: [{ file: 'checkout.mjs' }] } });
					case 'plan': return JSON.stringify({ planId: 'plan', plan: { summary: 'Payment refusal', questions: [], steps: [{ description: 'Implement refusal' }], changes: [{ file: 'checkout.mjs', kind: 'modify', reason: 'Handle refused payments' }], tests: [{ description: 'Assert the refused-payment boundary' }], limitations: ['No behavior has been executed yet'] } });
					case 'stage': return JSON.stringify(session);
					case 'verify': return JSON.stringify({ ...session, status: 'passed', verification: { code: 0, output: 'Passed', durationMs: 1 } });
					case 'apply': return JSON.stringify({ ...session, status: 'applied' });
					case 'undo': return JSON.stringify({ ...session, status: 'undone' });
					case 'diagramPrepare': diagramPrepares.push(JSON.parse(inputText)); if (diagramPrepareError) { throw diagramPrepareError; } if (plannedProgress) { return JSON.stringify(plannedProgress); } return JSON.stringify({ inputBudgetBytes: 49152, responseHeadroomBytes: 16384, id: 'diagram-job', sourceRoot: root, reviewId: 'diagram-scope', status: 'ready', completed: 0, total: 2, calls: 0, symbols: 1, files: 1, model: 'economical-diagrams', questions: [], excluded: 0 });
					case 'diagramApprovePlan': assert.ok(plannedProgress?.plan); planApproved = true; plannedProgress.status = 'ready'; return JSON.stringify(plannedProgress);
					case 'diagramStep': if (failDiagram) { throw new Error('Provider Offline'); }
						if (plannedProgress) {
							if (plannedProgress.completed === 0) { plannedProgress.status = 'plan'; plannedProgress.completed = 1; }
							else { assert.equal(planApproved, true); plannedProgress.completed++; plannedProgress.plan![plannedProgress.completed - 2].status = 'complete'; if (plannedProgress.completed === plannedProgress.total) { plannedProgress.status = 'complete'; plannedProgress.context = { ...context, diagramState: 'diagrams' }; } }
							return JSON.stringify(plannedProgress);
						}
						return JSON.stringify({ id: 'diagram-job', sourceRoot: root, reviewId: 'diagram-scope', status: 'complete', completed: 2, total: 2, calls: 2, symbols: 1, files: 1, model: 'economical-diagrams', questions: [], excluded: 0, context: { ...context, diagramState: 'diagrams' } });
					case 'reconciliationPrepare': sourceSelections.push((JSON.parse(inputText) as { sourceFiles: string[] }).sourceFiles); return JSON.stringify({ reviewId: 'reconcile-context', contents: '{"prompt":"reviewed"}', metrics: { inputBytes: 1000, schemaBytes: 100, sourceBytes: 8000, disclosedBytes: 500, estimatedTokens: 275 } });
					case 'reconciliationPropose': return JSON.stringify({ token: 'proposal', context, ai: { summary: 'Reconcile payment', questions: [] } });
					default: throw new Error('Unexpected fixture operation');
				}
		};
		const service = store.add(instantiation.createInstance(OrditoAiService));
		return { explorationBudgetRequests, setExplorationBudget: (budget: typeof explorationBudget, elapsedMs = 0) => { explorationBudget = structuredClone(budget); explorationBudgetStarted = Date.now() - elapsedMs; }, setCriteria: (value: unknown) => { stateData = JSON.stringify(value); }, pickerOptions, readonlyResources, setPureRoot: (value: string) => { pure.root = value; }, setProjectRoot: (value: URI) => { Object.assign(projectService, { projectRoot: value }); }, savedModel, contextFiles, chatRequests, prepareProjectReview: () => { incremental = true; projectWorkflow = true; exploratoryDraft = { id: 'project-view', status: 'ready', diagnostics: [], views: structuredClone(checkoutModel.views.slice(0, 2)) }; }, explorationSessionIds, removeExploration: () => { explorationMissing = true; exploratoryDraft = undefined; }, failExplorationRead: (error: Error) => { explorationReadError = error; }, prepareExploratoryDraft: (status: 'ready' | 'invalid' = 'ready') => { incremental = true; exploratoryDraft = { id: 'draft-review', status, diagnostics: [], views: [structuredClone(checkoutModel.views[0])] }; }, explorationActions, nativeDiagramModels, selectedChatModels, enableIncremental: () => { incremental = true; }, diagramTools, sessionTools, failPurePublication: () => { failPureApply = true; }, useStateModel: () => { Object.assign(projectService, { model: structuredClone(stateFixture) }); stateData = JSON.stringify(stateCriteriaFixture); }, get reverted() { return reverted; }, setPureAligned: () => { pureAligned = true; }, usePureModel: () => { Object.assign(project, { model: structuredClone(nodeOrdersFixture), modelUri: URI.file(root + '/.ordito/model.json') }); Object.assign(projectService, project); projectChanged.fire(); }, service, operations, opened, chats, chatPrompts, dialogs, fileChanges, aiProgress, liveUpdates, deletedAttachments, diagramContexts, setCodeChanged: (value: boolean) => { Object.assign(codeService, { changed: value }); }, setModelUri: (value: URI) => { Object.assign(projectService, { modelUri: value }); }, dialogDetails, pickerTitles, editorInputs, project, projectChanged, get hiddenPanels() { return hiddenPanels; }, get closedAlerts() { return closedAlerts; }, confirmations, useDiagramPlan: () => { plannedProgress = { id: 'diagram-job', sourceRoot: root, reviewId: 'diagram-plan', status: 'ready', completed: 0, total: 3, calls: 0, symbols: 1, files: 1, model: 'economical-diagrams', questions: [], excluded: 0, remainingRequests: 1, plan: [{ key: 'overview', name: 'Overview', kind: 'structure', feature: null, focus: ['checkout-controller'], intent: 'System responsibilities', status: 'pending' }, { key: 'sequence', name: 'Checkout Interaction', kind: 'sequence', feature: 'purchase', focus: ['checkout-controller'], intent: 'Request and persistence order', status: 'pending' }] }; }, setConfirmed: (value: boolean) => { confirmed = value; }, failDiagram: (value = true) => { failDiagram = value; }, setAccountState: (value: CliAccountState) => { accountState = value; }, storage, picks, inputs, inputOptions, errors, infos, terminals, requests, sourceSelections, setups, code, changed, root, get signIns() { return signIns; }, disable: () => { disabled = true; }, holdTrust: (pending: Promise<boolean>) => { trust = pending; },
			configurationValues, configurationEdits, budgetEditors, explorationOpens, diagramPrepares, failDiagramPrepare: (error: Error) => { diagramPrepareError = error; },
			codeUpdateRequests, codeUpdateNotifications, onCodeUpdate: (handler: typeof onCodeUpdate) => { onCodeUpdate = handler; },
			saveCodeUpdate: (before: typeof project.model) => {
				const model = structuredClone(project.model);
				const change = { modelUri: project.modelUri.toString(), model, changes: savedModelChanges(before, model) };
				updateState.lastSavedChange = change;
				Object.assign(projectService, updateState);
				savedModel.fire(change);
				return change.changes;
			},
			handleBudgetEditor: (handler: IOrditoAiDialogService['editDiagramBudget']) => { editBudget = handler; },
			setFeatureState: (state: Partial<CodeDiagramExploration>) => { incremental = true; projectWorkflow = true; featureState = state; storage.store('ordito.ai.diagramModel.codex', 'native-model', StorageScope.PROFILE, StorageTarget.MACHINE); },
			handleCheckpoint: (handler: typeof onCheckpoint) => { onCheckpoint = handler; },
			handleExplorationStatus: (handler: typeof onExplorationStatus) => { onExplorationStatus = handler; },
			holdProjectContext: (pending: Promise<boolean>) => { projectContext = pending; }, holdTerminalFocus: (pending: Promise<void>) => { terminalFocus = pending; }, focusRequested: focusRequested.p, exitTerminal: () => terminalExit.fire(0),
			publishAccount: (value: ICodexAccountViewInfo) => { Object.assign(account, { authUrl: undefined }, value); accountChanged.fire(account); }, failTerminal: (error: Error) => { terminalError = error; },
			setCliResolver: (resolver: typeof resolveExecutable) => { resolveExecutable = resolver; } };
	}
	test('primary Codex modal selects a model and uses the connected CLI account', async () => {
		const f = fixture(false); f.picks.push(items => items[0]);
		await f.service.chat();
		assert.deepStrictEqual([f.dialogs.length, f.terminals.length], [1, 0]);
		assert.equal(f.signIns, 0);
		assert.deepStrictEqual(f.requests, []);
		assert.equal(f.errors.length, 0);
	});
	test('native Codex chat opens in the modal and focuses input', async () => {
		const f = fixture();
		f.publishAccount({ status: 'signedIn' });
		f.setCliResolver(async () => undefined);
		f.setups.push({ agent: 'codex', download: 'ready' });
		await f.service.chat();
		assert.equal(f.chats.length, 1);
		assert.equal(f.chats[0].focused, true);
		assert.equal(f.terminals.length, 0);
		assert.deepStrictEqual(f.requests, []);
	});
	test('transient CLI account errors do not start another login', async () => {
		const f = fixture(); f.setAccountState({ status: 'error', reason: 'timeout' });
		await f.service.chat();
		assert.equal(f.terminals.length, 0); assert.equal(f.signIns, 0);
	});
	test('diagram generation uses a separate model, reviews its full budget and opens the published model', async () => {
		const f = fixture(); f.picks.push(items => items[0]);
		await f.service.buildDiagrams();
		assert.deepStrictEqual(f.requests, ['diagramPrepare', 'diagramStep']);
		assert.equal(f.opened[0].diagramState, 'diagrams');
		assert.equal(f.service.diagramProgress?.status, 'complete');
		assert.ok(f.dialogDetails[0].includes('2 additional requests'));
		assert.match(f.dialogDetails[0], /49152 bytes per request.*16384 bytes/s);
		assert.equal(f.errors.length, 0);
	});
	test('updating a completed diagram job prepares current sources without resuming the published snapshot', async () => {
		const f = fixture(); f.picks.push(items => items[0]);
		await f.service.buildDiagrams();
		assert.equal(f.service.diagramProgress?.status, 'complete');
		Object.assign(f.code.context, { snapshot: f.root + '/.ordito/imports/after-sync', revision: 'after-sync' });
		f.confirmations.push(false);
		await f.service.updateDiagrams();
		assert.deepStrictEqual(f.diagramPrepares.map(request => ({ snapshot: request.snapshot, resume: request.resume })), [
			{ snapshot: f.root + '/.ordito/imports/fixture', resume: undefined },
			{ snapshot: f.root + '/.ordito/imports/after-sync', resume: undefined },
		]);
		assert.deepStrictEqual(f.requests, ['diagramPrepare', 'diagramStep', 'diagramPrepare']);
		assert.equal(f.dialogDetails.length, 2, 'A fresh update requires its own source-disclosure consent');
		assert.equal(f.service.diagramProgress?.status, 'ready');
		assert.equal(f.opened.length, 1, 'Declining the update does not publish another snapshot');
		assert.deepStrictEqual(f.errors, []);
	});

	test('the diagram proposal is reviewed separately before per-view steps', async () => {
		const f = fixture(); f.picks.push(items => items[0]); f.useDiagramPlan();
		await f.service.buildDiagrams();
		assert.deepStrictEqual(f.requests, ['diagramPrepare', 'diagramStep', 'diagramApprovePlan', 'diagramStep', 'diagramStep']);
		assert.match(f.dialogDetails[1], /Overview · Structure.*System responsibilities.*Checkout Interaction · Sequence.*Request and persistence order/s);
		assert.match(f.dialogDetails[1], /2 diagrams · Up to 1 additional requests/);
		assert.equal(f.opened.length, 1);
	});

	test('declining the proposal keeps it reviewable and resume does not analyze sources again', async () => {
		const f = fixture(); f.picks.push(items => items[0]); f.useDiagramPlan(); f.confirmations.push(true, false);
		await f.service.buildDiagrams();
		assert.deepStrictEqual({ requests: f.requests, status: f.service.diagramProgress?.status, opened: f.opened.length }, { requests: ['diagramPrepare', 'diagramStep'], status: 'plan', opened: 0 });
		await f.service.resumeDiagrams();
		assert.deepStrictEqual(f.requests, ['diagramPrepare', 'diagramStep', 'diagramPrepare', 'diagramApprovePlan', 'diagramStep', 'diagramStep']);
		assert.equal(f.diagramPrepares[1].resume, 'diagram-job');
		assert.equal(f.opened.length, 1);
	});

	test('zero-budget diagram generation prepares scope without inference', async () => {
		const f = fixture(true, 'codex', 0); f.picks.push(items => items[0]);
		await f.service.buildDiagrams();
		assert.deepStrictEqual(f.requests, ['diagramPrepare']); assert.equal(f.opened.length, 0);
	});
	test('first diagram generation asks for a model once and skips coding setup', async () => {
		const f = fixture(false); f.picks.push(items => items[0]);
		await f.service.buildDiagrams();
		assert.deepStrictEqual(f.pickerTitles, ['Model for Diagrams']);
		assert.deepStrictEqual(f.requests, ['diagramPrepare', 'diagramStep']);
		assert.equal(f.infos.length, 0); assert.equal(f.errors.length, 0);
		assert.equal(f.opened.length, 1);
	});
	test('cancelling first model selection leaves the codebase available without inference', async () => {
		const f = fixture(false);
		await f.service.buildDiagrams();
		assert.deepStrictEqual(f.requests, []); assert.equal(f.errors.length, 0);
		assert.match(f.service.workflowStatus!, /No Model Selected/);
	});
	test('first setup still requires disclosure approval before inference', async () => {
		const f = fixture(false); f.picks.push(items => items[0]); f.setConfirmed(false);
		await f.service.buildDiagrams();
		assert.deepStrictEqual(f.requests, ['diagramPrepare']); assert.equal(f.opened.length, 0);
	});
	test('CLI conversations open in a modal and reset when closed without opening a terminal', async () => {
		const f = fixture();
		await f.service.chat();
		assert.deepStrictEqual([f.dialogs.length, f.terminals.length, f.service.chatLocation], [1, 0, 'modal']);
		await f.service.returnToDiagrams();
		assert.deepStrictEqual([f.service.chatLocation, f.hiddenPanels, f.editorInputs.length], [undefined, 0, 0]);
		await f.service.chat();
		assert.deepStrictEqual([f.dialogs.length, f.terminals.length], [2, 0]);
	});

	test('closing native chat clears its tool binding and reopens a new conversation with the same drafts', async () => {
		const f = fixture(); f.prepareExploratoryDraft(); f.publishAccount({ status: 'signedIn' }); f.setups.push({ agent: 'codex', download: 'ready' });
		await f.service.buildDiagrams(); const first = f.chats[0].resource;
		await f.service.returnToDiagrams();
		assert.deepStrictEqual([f.diagramTools.size, f.sessionTools.size, f.service.diagramExploration?.proposals.length], [0, 0, 1]);
		await f.service.chat();
		assert.notEqual(f.chats.at(-1)!.resource, first);
		assert.deepStrictEqual([f.diagramTools.size, f.terminals.length], [diagramToolDefinitions.length, 0]);
	});
	test('native chat reopens its conversation and attaches only the current model', async () => {
		const f = fixture(); f.publishAccount({ status: 'signedIn' }); f.setups.push({ agent: 'codex', download: 'ready' });
		await f.service.chat(); await f.service.chat();
		assert.equal(f.chats[0].resource, f.chats[1].resource);
		assert.equal(f.chats[0].attachments.length, 1); assert.equal(f.chats[1].attachments.length, 0);
		const currentModel = URI.file(f.root + '/new-snapshot/model.ordito.json'); f.setModelUri(currentModel); await f.service.chat();
		assert.deepStrictEqual(f.chats[2].attachments, [currentModel.toString()]);
		assert.equal(f.chats[2].resource, f.chats[0].resource);
		assert.deepStrictEqual(f.deletedAttachments, [URI.file(f.code.context.model).toString()]);
		assert.equal(JSON.parse(f.diagramContexts[2]).model, currentModel.fsPath);
	});
	test('failed diagram generation keeps actionable progress for resume', async () => {
		const f = fixture(); f.picks.push(items => items[0]); f.failDiagram();
		await f.service.buildDiagrams();
		assert.equal(f.service.diagramProgress?.status, 'failed');
		assert.equal(f.service.diagramProgress?.error, 'Provider Offline');
		assert.equal(f.service.diagramProgress?.completed, 0); assert.equal(f.opened.length, 0);
		assert.deepStrictEqual({ alerts: f.errors.length, cause: /Cause:/.test(f.errors[0]), resolution: /How to resolve:/.test(f.errors[0]), originalProblem: /Provider Offline/.test(f.errors[0]) }, { alerts: 1, cause: true, resolution: true, originalProblem: true });
		f.failDiagram(false); await f.service.resumeDiagrams();
		assert.equal(f.diagramPrepares[1].resume, 'diagram-job');
		assert.equal(f.closedAlerts, 1); assert.equal(f.opened.length, 1);
	});
	test('an incomplete stale diagram job is rejected without silently preparing a new interpretation', async () => {
		const f = fixture(); f.picks.push(items => items[0]); f.failDiagram();
		await f.service.buildDiagrams();
		assert.equal(f.service.diagramProgress?.status, 'failed');
		Object.assign(f.code.context, { snapshot: f.root + '/.ordito/imports/changed', revision: 'changed' });
		f.failDiagramPrepare(new Error('Diagram job is stale; prepare a new interpretation'));
		await f.service.resumeDiagrams();
		assert.deepStrictEqual(f.diagramPrepares.map(request => request.resume), [undefined, 'diagram-job']);
		assert.deepStrictEqual(f.requests, ['diagramPrepare', 'diagramStep', 'diagramPrepare']);
		assert.match(f.errors.at(-1)!, /Diagram job is stale/);
		assert.equal(f.dialogDetails.length, 1, 'A rejected resume never reaches disclosure or generation');
		assert.equal(f.opened.length, 0);
	});
	test('manual model edits clear stale completion messages', async () => {
		const f = fixture(); await f.service.chat();
		assert.ok(f.service.workflowStatus); f.projectChanged.fire(); assert.equal(f.service.workflowStatus, undefined);
	});
	test('constructing the visual service does not request inference', () => {
		const f = fixture();
		assert.deepStrictEqual(f.requests, []);
	});
	test('bidirectional Sync reviews selected context and returns one proposal without applying source changes', async () => {
		const f = fixture();
		f.picks.push(items => [items[0]]);
		const preview: CodePreview = { token: 'preview', context: f.code.context, files: { added: [], changed: ['checkout.mjs'], removed: [], unchanged: [] }, declarations: { added: [], changed: [], removed: [] }, dependencies: { added: [], changed: [], removed: [] }, conflicts: [], impact: { elementIds: [], viewIds: [] }, parsed: [], reused: [], semanticAnalyzed: [], semanticReused: [] };
		const result = await f.service.reconcile(preview);
		assert.deepStrictEqual({ requests: f.requests, token: result?.token, errors: f.errors }, { requests: ['reconciliationPrepare', 'reconciliationPropose'], token: 'proposal', errors: [] });
		assert.strictEqual(f.pickerOptions.find(options => options.title === 'Review Sync Context')?.ignoreFocusLost, true);
		assert.ok(f.editorInputs.every(input => (input as { resource?: URI }).resource instanceof URI));
		assert.ok(f.readonlyResources.some(resource => URI.parse(resource).path.endsWith('/Reconciliation Context.json')));
		assert.ok(f.readonlyResources.some(resource => URI.parse(resource).path.endsWith('/Reconciliation Proposal.json')));
		assert.ok(f.readonlyResources.some(resource => URI.parse(resource).path.endsWith('/Sync Proposal.md')));
		const summary = [...f.contextFiles.entries()].find(([path]) => path.endsWith('/Sync Proposal.md'))?.[1];
		assert.ok(summary?.includes('No Changes Have Been Applied.'));
		assert.ok(summary?.includes('Sync Has Not Run Runtime Tests or Builds.'));
	});
	for (const state of ['index', 'legacyIndex', 'emptyViews'] as const) {
		test(`Sync generates diagrams when the design is ${state}, even with no code changes`, async () => {
			const f = fixture(false);
			if (state === 'index') { f.code.context.diagramState = 'index'; }
			if (state === 'legacyIndex') { f.project.model.id = 'code:legacy'; f.project.model.semantics.elements = f.project.model.semantics.elements.filter(element => element.kind !== 'feature'); }
			if (state === 'emptyViews') { f.project.model.views = []; }
			f.picks.push(items => items[0]);
			const preview: CodePreview = { token: 'preview', context: f.code.context, files: { added: [], changed: [], removed: [], unchanged: [] }, declarations: { added: [], changed: [], removed: [] }, dependencies: { added: [], changed: [], removed: [] }, conflicts: [], impact: { elementIds: [], viewIds: [] }, parsed: [], reused: [], semanticAnalyzed: [], semanticReused: [], reconciliation: { status: 'aligned', origin: 'none', commonRevision: 'fixture', sourceEdits: [], diagnostics: [] } };
			await f.service.reconcile(preview);
			assert.deepStrictEqual({ requests: f.requests, opened: f.opened.length, errors: f.errors }, { requests: ['diagramPrepare', 'diagramStep'], opened: 1, errors: [] });
		});
	}
	test('zero-call Sync budget prepares context without making an inference request', async () => {
		const f = fixture(true, 'codex', 0);
		f.picks.push(items => [items[0]]);
		const preview: CodePreview = { token: 'preview', context: f.code.context, files: { added: [], changed: [], removed: [], unchanged: [] }, declarations: { added: [], changed: [], removed: [] }, dependencies: { added: [], changed: [], removed: [] }, conflicts: [], impact: { elementIds: [], viewIds: [] }, parsed: [], reused: [], semanticAnalyzed: [], semanticReused: [] };
		await f.service.reconcile(preview);
		assert.deepStrictEqual({ requests: f.requests, errors: f.errors }, { requests: ['reconciliationPrepare'], errors: [] });
	});
	test('Update Code prepares all affected files even when more than 20 are suggested', async () => {
		const f = fixture();
		f.code.context.files = Array.from({ length: 26 }, (_, index) => ({ path: `task${index}.py`, language: 'python', status: 'parsed', diagnostics: [] }));
		const preview: CodePreview = { token: 'preview', context: f.code.context, files: { added: [], changed: f.code.context.files.map(file => file.path), removed: [], unchanged: [] }, declarations: { added: [], changed: [], removed: [] }, dependencies: { added: [], changed: [], removed: [] }, conflicts: [], impact: { elementIds: [], viewIds: [] }, parsed: [], reused: [], semanticAnalyzed: [], semanticReused: [] };
		await f.service.reconcile(preview, [], 'model');
		assert.deepStrictEqual({ selected: f.sourceSelections, requests: f.requests, errors: f.errors }, { selected: [preview.files.changed], requests: ['reconciliationPrepare', 'reconciliationPropose'], errors: [] });
	});
	test('an authenticated CLI is recognized without native account login or inference', async () => {
		const f = fixture();
		await f.service.refreshConnection();
		assert.match(f.service.connectionStatus, /CLI Account Connected.*native-model/);
		assert.deepStrictEqual({ signIns: f.signIns, terminals: f.terminals, requests: f.requests }, { signIns: 0, terminals: [], requests: [] });
	});
	test('request budget can be enabled, canceled and disabled without changing account settings or starting a provider', async () => {
		const f = fixture(true, '/qa/codex', 0);
		const before = JSON.parse(f.storage.get('ordito.ai.cliConfig', StorageScope.PROFILE)!);
		assert.match(f.service.requestStatus, /Requests Disabled/);
		await f.service.configureRequestBudget();
		assert.deepStrictEqual(JSON.parse(f.storage.get('ordito.ai.cliConfig', StorageScope.PROFILE)!), before);
		f.picks.push(items => items.find(item => item.maxCalls === 1)); await f.service.configureRequestBudget();
		assert.deepStrictEqual(JSON.parse(f.storage.get('ordito.ai.cliConfig', StorageScope.PROFILE)!), { ...before, maxCalls: 1 });
		assert.match(f.service.requestStatus, /Requests Enabled.*1/);
		f.picks.push(items => items.find(item => item.maxCalls === 0)); await f.service.configureRequestBudget();
		assert.deepStrictEqual(JSON.parse(f.storage.get('ordito.ai.cliConfig', StorageScope.PROFILE)!), before);
		assert.match(f.service.requestStatus, /Requests Disabled/);
		assert.deepStrictEqual({ requests: f.requests, signIns: f.signIns, terminals: f.terminals }, { requests: [], signIns: 0, terminals: [] });
	});

	test('logout blocks inference and a later external login is recognized on refresh', async () => {
		const f = fixture();
		f.setAccountState({ status: 'signedOut' });
		await f.service.implement();
		assert.match(f.service.connectionStatus, /Requires Sign-In/);
		assert.deepStrictEqual(f.requests, []);
		f.setAccountState({ status: 'signedIn' });
		await f.service.refreshConnection();
		assert.match(f.service.connectionStatus, /Connected/);
	});
	test('unknown CLI status is reported as an error instead of asking for a new login', async () => {
		const f = fixture(); f.setAccountState({ status: 'error', reason: 'unsupported' });
		await f.service.implement();
		assert.match(f.service.connectionStatus, /Could Not Verify.*unsupported/);
		assert.deepStrictEqual({ signIns: f.signIns, requests: f.requests }, { signIns: 0, requests: [] });
	});
	test('project operations block concurrent AI commands until released', async () => {
		const f = fixture(); const operation = f.operations.acquire('code')!;
		try { await f.service.implement(); assert.deepStrictEqual(f.requests, []); assert.match(f.infos.at(-1)!, /already running/); }
		finally { operation.dispose(); }
	});
	test('session prerequisites are explained for review, apply, undo and recovery', async () => {
		const f = fixture();
		await f.service.review(); await f.service.apply(); await f.service.undo(); await f.service.recover();
		assert.deepStrictEqual(f.requests, []);
		assert.match(f.infos.join('\n'), /No Implementation Is Open/);
		assert.match(f.infos.join('\n'), /Apply Requires Passing Tests/);
		assert.match(f.infos.join('\n'), /No Saved Implementation/);
	});
	test('zero budget prepares local context without requiring a CLI or making an AI request', async () => {
		const f = fixture(true, 'codex', 0);
		f.setCliResolver(async () => { throw new Error('No CLI lookup should be needed'); });
		f.picks.push(items => items.find(item => item.id === 'purchase'), items => [...items]); f.inputs.push('Handle refusal');
		await f.service.implement();
		assert.deepStrictEqual({ requests: f.requests, errors: f.errors }, { requests: ['prepare'], errors: [] });
		assert.match(f.service.status, /No AI Request Was Made/);
		const report = f.editorInputs[0] as { resource: URI };
		assert.ok(report.resource.path.endsWith('/Implementation Context.json'));
		assert.ok(f.readonlyResources.includes(report.resource.toString()));
	});
	test('implementation context can be inspected while the explicit send choice remains open', async () => {
		const f = fixture(true, 'codex', 1);
		f.setConfirmed(false); f.picks.push(items => items.find(item => item.id === 'purchase'), items => [...items]); f.inputs.push('Preserve the accepted boundary');
		await f.service.implement();
		const choice = f.pickerOptions.find(options => options.title === 'Review Implementation Context')!;
		assert.strictEqual(choice.ignoreFocusLost, true);
		assert.match(choice.placeHolder!, /Inspect Report/);
		assert.deepStrictEqual(f.requests, ['prepare']);
		assert.match(f.service.status, /Cancelled During Review/);
	});

	test('plan review stays inspectable and cancellation preserves source without staging', async () => {
		const f = fixture();
		f.picks.push(items => items.find(item => item.id === 'purchase'), items => [...items]); f.inputs.push('Preserve the accepted boundary'); f.confirmations.push(true, false);
		await f.service.implement();
		const choice = f.pickerOptions.find(options => options.title === 'Review Implementation Plan')!;
		assert.strictEqual(choice.ignoreFocusLost, true);
		assert.deepStrictEqual(f.requests, ['prepare', 'plan']);
		const report = f.editorInputs.at(-1) as { resource: URI };
		assert.ok(report.resource.path.endsWith('/Implementation Plan.md'));
		assert.ok(f.readonlyResources.includes(report.resource.toString()));
		const contents = f.contextFiles.get(report.resource.fsPath)!;
		assert.match(contents, /Planned Tests[\s\S]*Assert the refused-payment boundary/);
		assert.match(contents, /Open Questions[\s\S]*No Clarifications Requested/);
		assert.match(contents, /Limitations[\s\S]*No behavior has been executed yet/);
		assert.match(f.service.status, /Generation Cancelled/);
	});

	test('blank implementation intent is rejected before source disclosure and the input explains how to continue', async () => {
		const f = fixture(true, 'codex', 0);
		f.picks.push(items => items.find(item => item.id === 'purchase')); f.inputs.push('   ');
		await f.service.implement();
		assert.deepStrictEqual(f.requests, []);
		const field = f.inputOptions.find(options => options.title === 'Requested Behavior')!;
		assert.ok(await field.validateInput!(''));
		assert.ok(await field.validateInput!('  \n '));
		assert.strictEqual(await field.validateInput!('Preserve the accepted boundary'), undefined);
	});

	test('one-run budget reports that the plan is ready without silently stopping before generation', async () => {
		const f = fixture(true, 'codex', 1);
		f.picks.push(items => items.find(item => item.id === 'purchase'), items => [...items]); f.inputs.push('Handle refusal');
		await f.service.implement();
		assert.deepStrictEqual(f.requests, ['prepare', 'plan']);
		assert.match(f.service.status, /Plan Ready.*One-Run Budget/);
	});
	test('a login that exits before terminal focus still refreshes the CLI account', async () => {
		const f = fixture(false); const focus = new DeferredPromise<void>();
		f.setAccountState({ status: 'signedOut' }); f.holdTerminalFocus(focus.p);
		f.picks.push(items => items.find(item => item.provider === 'codex'), items => items.find(item => item.id === 'cliLogin'));
		const connecting = f.service.connect();
		await f.focusRequested;
		f.setAccountState({ status: 'signedIn' }); f.exitTerminal();
		await focus.complete(); await connecting;
		assert.match(f.service.connectionStatus, /CLI Account Connected/);
		assert.deepStrictEqual(f.requests, []);
	});
	test('model selection decodes the native Codex account ID and saves an explicit request budget', async () => {
		const f = fixture(false);
		f.picks.push(items => items.find(item => item.provider === 'codex'), items => items.find(item => item.id === 'configure'), items => {
			assert.deepStrictEqual(items.map(item => item.id), ['native-model', undefined]); return items[0];
		}, items => items.find(item => item.maxCalls === 1));
		f.inputs.push('codex');
		await f.service.connect();
		const saved = JSON.parse(f.storage.get('ordito.ai.cliConfig', StorageScope.PROFILE)!);
		assert.deepStrictEqual({ model: saved.model, connection: saved.connection, maxCalls: saved.maxCalls }, { model: 'native-model', connection: 'cli', maxCalls: 1 });
	});

	test('a nonempty native catalog also accepts an exact CLI model ID without sending a request', async () => {
		const f = fixture(false);
		f.picks.push(items => items.find(item => item.provider === 'codex'), items => items.find(item => item.id === 'configure'),
			items => items.find(item => item.label === 'Enter Exact Model ID'), items => items.find(item => item.maxCalls === 2));
		f.inputs.push('  exact-cli-model  ', '/installed/codex');
		await f.service.connect();
		const saved = JSON.parse(f.storage.get('ordito.ai.cliConfig', StorageScope.PROFILE)!);
		assert.deepStrictEqual({ model: saved.model, executable: saved.executable, maxCalls: saved.maxCalls, requests: f.requests }, {
			model: 'exact-cli-model', executable: '/installed/codex', maxCalls: 2, requests: []
		});
		assert.deepStrictEqual(f.inputOptions.map(option => [option.title, option.showConfirmButton]), [['Model ID from Your CLI', true], ['Original CLI Executable', true]]);
	});
	test('editing a connection prefocuses the saved request budget and cancellation preserves it', async () => {
		for (const maxCalls of [0, 1, 2]) {
			const f = fixture(true, 'codex', maxCalls);
			const before = f.storage.get('ordito.ai.cliConfig', StorageScope.PROFILE);
			f.picks.push(items => items.find(item => item.provider === 'codex'), items => items.find(item => item.id === 'configure'), items => items[0], () => undefined); f.inputs.push('codex');
			await f.service.connect();
			const budget = f.pickerOptions.find(options => options.title.startsWith('Agent Run Budget'))!;
			assert.strictEqual(budget.activeItem?.maxCalls, maxCalls);
			assert.strictEqual(f.storage.get('ordito.ai.cliConfig', StorageScope.PROFILE), before);
			assert.deepStrictEqual(f.requests, []);
		}
	});

	test('a model ID cannot be saved as the CLI executable', async () => {
		const f = fixture(false);
		f.setCliResolver(async executable => executable === 'codex' ? '/installed/codex' : undefined);
		f.picks.push(items => items.find(item => item.provider === 'codex'), items => items.find(item => item.id === 'configure'), items => items[0]);
		f.inputs.push('codex-terra-5.6');
		await f.service.connect();
		assert.strictEqual(f.storage.get('ordito.ai.cliConfig', StorageScope.PROFILE), undefined);
		assert.match(f.errors[0], /model ID belongs in the Model field/i);
		assert.ok(!f.pickerTitles.some(title => title.startsWith('Agent Run Budget')));
		const field = f.inputOptions.find(options => options.title === 'Original CLI Executable')!;
		assert.match(field.prompt!, /not a model ID/);
		assert.ok(await field.validateInput!('codex-terra-5.6'));
		assert.strictEqual(await field.validateInput!('codex'), undefined);
	});

	test('an invalid saved executable can use installed Codex while preserving both model settings', async () => {
		const f = fixture(true, 'codex-terra-5.6');
		f.storage.store('ordito.ai.diagramModel.codex', 'economical-diagram-model', StorageScope.PROFILE, StorageTarget.MACHINE);
		f.setCliResolver(async executable => executable === 'codex' ? '/installed/codex' : undefined);
		f.picks.push(items => items.find(item => item.id === 'installed'));
		await f.service.buildDiagrams();
		const saved = JSON.parse(f.storage.get('ordito.ai.cliConfig', StorageScope.PROFILE)!);
		assert.deepStrictEqual([saved.executable, saved.model, f.storage.get('ordito.ai.diagramModel.codex', StorageScope.PROFILE)], ['codex', 'native-model', 'economical-diagram-model']);
		assert.deepStrictEqual(f.requests, ['diagramPrepare', 'diagramStep']);
		assert.deepStrictEqual([f.errors, f.terminals, f.signIns], [[], [], 0]);
		assert.ok(f.pickerTitles.includes('Repair CLI Executable'));
	});

	test('cancelling executable repair keeps settings and starts no inference', async () => {
		const f = fixture(true, 'codex-terra-5.6');
		f.setCliResolver(async executable => executable === 'codex' ? '/installed/codex' : undefined);
		await f.service.buildDiagrams();
		assert.strictEqual(JSON.parse(f.storage.get('ordito.ai.cliConfig', StorageScope.PROFILE)!).executable, 'codex-terra-5.6');
		assert.deepStrictEqual([f.requests, f.terminals, f.errors], [[], [], []]);
	});

	test('executable repair accepts a validated custom path without changing the model', async () => {
		const f = fixture(true, 'codex-terra-5.6');
		f.setCliResolver(async executable => executable === 'codex' || executable === '/custom account/codex' ? executable : undefined);
		f.picks.push(items => items.find(item => item.id === 'choose'));
		f.inputs.push(' /custom account/codex ');
		await f.service.openCli();
		const saved = JSON.parse(f.storage.get('ordito.ai.cliConfig', StorageScope.PROFILE)!);
		assert.deepStrictEqual([saved.executable, saved.model], ['/custom account/codex', 'native-model']);
		assert.deepStrictEqual(f.terminals, [{ config: { name: 'Codex', executable: '/custom account/codex', args: ['--model', 'native-model'], cwd: f.root } }]);
	});

	test('Codex uses native ChatGPT sign-in when ready and the official CLI login otherwise', async () => {
		const f = fixture(false);
		f.setups.push({ agent: 'codex', download: 'ready' });
		f.picks.push(items => items.find(item => item.provider === 'codex'), items => items.find(item => item.id === 'login'));
		await f.service.connect();
		assert.deepStrictEqual({ signIns: f.signIns, terminals: f.terminals }, { signIns: 1, terminals: [] });
		f.setups.length = 0;
		f.picks.push(items => items.find(item => item.provider === 'codex'), items => items.find(item => item.id === 'login'));
		await f.service.connect();
		assert.deepStrictEqual(f.terminals, [{ config: { name: 'Codex Login', executable: 'codex', args: ['login'], cwd: f.root } }]);
	});
	test('Claude login runs its original CLI in the integrated terminal', async () => {
		const f = fixture(false);
		f.picks.push(items => items.find(item => item.provider === 'claude'), items => items.find(item => item.id === 'login'));
		await f.service.connect();
		assert.deepStrictEqual({ signIns: f.signIns, terminals: f.terminals }, { signIns: 0, terminals: [{ config: { name: 'Claude Code', executable: 'claude', args: ['auth', 'login'], cwd: f.root } }] });
	});
	test('native flow suggests files from model evidence and gates application on passing verification', async () => {
		const f = fixture();
		f.picks.push(items => items.find(item => item.id === 'purchase'), items => { assert.strictEqual(items[0].picked, true); return [...items]; });
		f.inputs.push('Handle payment refusal');
		await f.service.implement();
		assert.deepStrictEqual({ errors: f.errors, requests: f.requests, verify: f.service.canVerify, apply: f.service.canApply }, { errors: [], requests: ['prepare', 'plan', 'stage'], verify: true, apply: false });
		assert.ok(f.readonlyResources.some(resource => resource.includes('/review/before/')));
		assert.ok(f.readonlyResources.some(resource => resource.includes('/review/after/')));
		assert.ok(f.readonlyResources.some(resource => URI.parse(resource).path.endsWith('/Implementation Review.md')));
		const reviewResource = (f.editorInputs.at(-1) as { resource: URI }).resource;
		assert.match(f.contextFiles.get(reviewResource.fsPath)!, /Worktree Verification: Not Run/);
		await f.service.apply();
		assert.deepStrictEqual(f.requests, ['prepare', 'plan', 'stage']);
		await f.service.verify();
		assert.strictEqual(f.service.canApply, true);
		await f.service.apply();
		assert.strictEqual(f.service.canUndo, true);
		assert.strictEqual((f.editorInputs.at(-1) as { resource: URI }).resource.toString(), reviewResource.toString());
		assert.match(f.contextFiles.get(reviewResource.fsPath)!, /Applied · Undo Available/);
		assert.ok(f.dialogDetails.some(detail => detail.startsWith('Tests Passed · Ready to Apply')));
		await f.service.undo();
		assert.match(f.contextFiles.get(reviewResource.fsPath)!, /Changes Undone/);
		assert.deepStrictEqual({ errors: f.errors, requests: f.requests, undo: f.service.canUndo }, { errors: [], requests: ['prepare', 'plan', 'stage', 'verify', 'apply', 'undo'], undo: false });
	});
	test('disabling AI prevents CLI launches and inference requests', async () => {
		const f = fixture(); f.disable();
		await f.service.openCli(); await f.service.implement();
		assert.deepStrictEqual({ terminals: f.terminals, requests: f.requests }, { terminals: [], requests: [] });
	});
	test('concurrent commands cannot start a second workflow while workspace trust is pending', async () => {
		const f = fixture();
		const trust = new DeferredPromise<boolean>(); f.holdTrust(trust.p);
		f.picks.push(items => items.find(item => item.id === 'purchase'), items => [...items]);
		f.inputs.push('Handle payment refusal');
		const first = f.service.implement();
		await f.service.implement();
		assert.strictEqual(f.service.busy, true);
		assert.deepStrictEqual(f.requests, []);
		await trust.complete(true); await first;
		assert.deepStrictEqual({ requests: f.requests, errors: f.errors }, { requests: ['prepare', 'plan', 'stage'], errors: [] });
	});
	test('an explicitly selected Codex executable owns its login even when another native SDK is ready', async () => {
		const f = fixture(true, '/custom/codex');
		f.setups.push({ agent: 'codex', download: 'ready' });
		f.picks.push(items => items.find(item => item.provider === 'codex'), items => items.find(item => item.id === 'login'));
		await f.service.connect();
		assert.deepStrictEqual({ signIns: f.signIns, terminals: f.terminals }, { signIns: 0, terminals: [{ config: { name: 'Codex Login', executable: '/custom/codex', args: ['login'], cwd: f.root } }] });
	});
	test('missing Codex shows installation and PATH instructions before any sign-in attempt', async () => {
		const f = fixture(false);
		f.setCliResolver(async () => undefined);
		f.setups.push({ agent: 'codex', download: 'ready' });
		f.picks.push(items => items.find(item => item.provider === 'codex'), items => items.find(item => item.id === 'login'));
		await f.service.connect();
		assert.deepStrictEqual({ signIns: f.signIns, terminals: f.terminals, requests: f.requests, errors: f.errors.length }, { signIns: 0, terminals: [], requests: [], errors: 1 });
		assert.match(f.errors[0], /npm install -g @openai\/codex/);
		assert.match(f.service.status, /absolute executable path/);
	});
	test('missing Claude shows its official installation instructions', async () => {
		const f = fixture(false);
		f.setCliResolver(async () => undefined);
		f.picks.push(items => items.find(item => item.provider === 'claude'), items => items.find(item => item.id === 'login'));
		await f.service.connect();
		assert.match(f.errors[0], /https:\/\/code.claude.com\/docs\/en\/setup/);
		assert.deepStrictEqual(f.terminals, []);
	});
	test('Open AI CLI reports a missing executable instead of opening a broken terminal', async () => {
		const f = fixture();
		f.setCliResolver(async () => undefined);
		await f.service.openCli();
		assert.deepStrictEqual({ terminals: f.terminals, errors: f.errors.length }, { terminals: [], errors: 1 });
	});
	test('CLI sign-in uses the resolved executable and confirms where to finish login', async () => {
		const f = fixture(false);
		f.setCliResolver(async () => '/installed path/codex');
		f.setups.push({ agent: 'codex', download: 'ready' });
		f.picks.push(items => items.find(item => item.provider === 'codex'), items => items.find(item => item.id === 'cliLogin'));
		await f.service.connect();
		assert.deepStrictEqual({ signIns: f.signIns, terminals: f.terminals }, { signIns: 0, terminals: [{ config: { name: 'Codex Login', executable: '/installed path/codex', args: ['login'], cwd: f.root } }] });
		assert.match(f.infos[0], /integrated terminal/);
	});
	test('an already signed-in native account gives feedback without requesting another login', async () => {
		const f = fixture(false);
		f.publishAccount({ status: 'signedIn' });
		f.setups.push({ agent: 'codex', download: 'ready' });
		f.picks.push(items => items.find(item => item.provider === 'codex'), items => items.find(item => item.id === 'login'));
		await f.service.connect();
		assert.deepStrictEqual({ signIns: f.signIns, infos: f.infos.length }, { signIns: 0, infos: 1 });
		assert.match(f.service.status, /already signed in/);
	});
	test('native login reports progress, browser handoff and success without a late timeout', async () => {
		const clock = sinon.useFakeTimers();
		try {
			const f = fixture(false);
			f.setups.push({ agent: 'codex', download: 'ready' });
			f.picks.push(items => items.find(item => item.provider === 'codex'), items => items.find(item => item.id === 'login'));
			await f.service.connect();
			assert.match(f.service.status, /Starting Codex sign-in/);
			f.publishAccount({ status: 'signedOut', authUrl: 'https://auth.openai.com/fixture' });
			clock.tick(16000);
			assert.match(f.service.status, /browser/);
			f.publishAccount({ status: 'signedIn' });
			assert.deepStrictEqual(f.errors, []);
			assert.match(f.service.status, /is signed in/);
		} finally { clock.restore(); }
	});
	test('an unanswered native login explains the timeout and offers an explicit CLI fallback', async () => {
		const clock = sinon.useFakeTimers();
		try {
			const f = fixture(false);
			f.setups.push({ agent: 'codex', download: 'ready' });
			f.picks.push(items => items.find(item => item.provider === 'codex'), items => items.find(item => item.id === 'login'));
			await f.service.connect();
			clock.tick(15000);
			assert.match(f.errors[0], /Sign In with CLI/);
			assert.deepStrictEqual(f.terminals, []);
		} finally { clock.restore(); }
	});
	test('native login failures are shown and stop waiting for a response', async () => {
		const clock = sinon.useFakeTimers();
		try {
			const f = fixture(false);
			f.setups.push({ agent: 'codex', download: 'ready' });
			f.picks.push(items => items.find(item => item.provider === 'codex'), items => items.find(item => item.id === 'login'));
			await f.service.connect();
			f.publishAccount({ status: 'error' });
			clock.tick(16000);
			assert.strictEqual(f.errors.length, 1);
			assert.match(f.errors[0], /Native Codex sign-in failed/);
		} finally { clock.restore(); }
	});
	test('lookup and terminal launch failures are reported instead of rejecting silently', async () => {
		const f = fixture(false);
		f.setCliResolver(async () => { throw new Error('Lookup worker unavailable'); });
		f.picks.push(items => items.find(item => item.provider === 'codex'), items => items.find(item => item.id === 'login'));
		await f.service.connect();
		assert.match(f.errors[0], /Lookup worker unavailable/);
		f.setCliResolver(async executable => executable);
		f.failTerminal(new Error('Terminal launch failed'));
		f.picks.push(items => items.find(item => item.provider === 'codex'), items => items.find(item => item.id === 'login'));
		await f.service.connect();
		assert.match(f.errors[1], /Terminal launch failed/);
	});
	test('v4 first project uses deterministic structural worker with review, verification, apply and undo', async () => {
		const f = fixture(false); f.usePureModel(); await f.service.implement();
		assert.deepStrictEqual(f.requests, ['structuralPrepare']); assert.strictEqual(f.editorInputs.length, 1);
		await f.service.verify(); assert.strictEqual(f.service.canApply, true);
		await f.service.apply(); assert.strictEqual(f.service.canUndo, true); await f.service.undo();
		assert.deepStrictEqual([f.requests, f.reverted, f.errors], [['structuralPrepare', 'structuralVerify', 'structuralApply', 'structuralUndo'], 2, []]);
	});

	test('canonical worker roots preserve verification and publication for the selected symlink path', async () => {
		const f = fixture(false); f.usePureModel(); f.setPureRoot('/canonical/ordito-ai-fixture');
		await f.service.implement(); assert.strictEqual(f.service.canVerify, true);
		await f.service.structuralResume(); assert.strictEqual(f.service.canVerify, true);
		await f.service.verify(); assert.strictEqual(f.service.canApply, true);
		await f.service.apply(); assert.strictEqual(f.service.canUndo, true);
		await f.service.undo(); assert.deepStrictEqual(f.errors, []);
		f.setProjectRoot(URI.file('/unrelated/project'));
		assert.strictEqual(f.service.canVerify, false); assert.strictEqual(f.service.canApply, false);
	});

	test('aligned v4 target uses no inference, proposal or review editor', async () => {
		const f = fixture(false); f.usePureModel(); f.setPureAligned(); await f.service.implement();
		assert.deepStrictEqual([f.requests, f.editorInputs, f.errors], [['structuralPrepare'], [], []]); assert.ok(f.infos.some(message => /No AI Calls/.test(message)));
	});

	test('v4 reverse resumes the same structural review and recovery without provider setup', async () => {
		const f = fixture(false); f.usePureModel(); await f.service.structuralReverse(); await f.service.structuralResume(); await f.service.structuralRecover();
		assert.deepStrictEqual([f.requests, f.errors, f.reverted], [['structuralPrepare', 'structuralSession', 'structuralRecover'], [], 1]);
	});

	test('v4 publication cancellation keeps the reviewed changes unapplied', async () => {
		const f = fixture(false); f.usePureModel(); await f.service.implement(); await f.service.verify(); f.setConfirmed(false); await f.service.apply();
		assert.deepStrictEqual(f.requests, ['structuralPrepare', 'structuralVerify']); assert.strictEqual(f.service.canApply, true);
	});

	test('semantic changes immediately mark a reviewed pure target for a new review', async () => {
		const f = fixture(false); f.usePureModel(); await f.service.implement(); await f.service.verify();
		assert.strictEqual(f.service.canApply, true); Object.assign(f.project.model, { name: 'Changed semantic intent' }); f.projectChanged.fire();
		assert.strictEqual(f.service.canApply, false); assert.match(f.service.status, /Prepare a New Review/);
	});

	test('independent predicate expectations show field names and retain the current value without rewriting an unchanged oracle', async () => {
		const f = fixture(false); f.usePureModel(); f.disable();
		const predicate = nodeOrdersFixture.foundation.predicates![0], operation = nodeOrdersFixture.foundation.blueprint!.operations.find(operation => operation.id === predicate.operationId)!, field = operation.inputs.find(field => field.name === 'quantity')!;
		const criteria = { version: 1, revision: '1', cases: [{ id: 'zero', predicateId: predicate.id, input: { [field.id!]: 0 }, expected: false }] }; f.setCriteria(criteria);
		let description: string | undefined;
		f.picks.push(items => { const item = items.find(item => item.label === 'zero'); description = item?.description; return item; }, items => items.find(item => item.value === 'expected'), items => items.find(item => item.value === false));
		await f.service.editPureCriteria();
		assert.strictEqual(description, 'quantity: 0');
		assert.strictEqual(f.pickerOptions.at(-1)?.activeItem?.value, false); assert.match(f.pickerOptions.at(-1)?.placeHolder ?? '', /Not Satisfied/);
		assert.strictEqual(f.contextFiles.size, 0);
		f.picks.push(items => items.find(item => item.label === 'zero'), items => items.find(item => item.value === 'expected'), items => items.find(item => item.value === true)); await f.service.editPureCriteria();
		const saved = JSON.parse(f.contextFiles.get(f.root + '/.ordito/criteria.json')!);
		assert.deepStrictEqual(saved.cases[0].input, criteria.cases[0].input); assert.strictEqual(saved.cases[0].expected, true);
		assert.deepStrictEqual([f.requests, f.errors], [[], []]);
	});

	test('changing an independent expectation immediately invalidates an active structural review; retaining it does not', async () => {
		const f = fixture(false); f.usePureModel();
		const predicate = nodeOrdersFixture.foundation.predicates![0], field = nodeOrdersFixture.foundation.blueprint!.operations.find(operation => operation.id === predicate.operationId)!.inputs[0];
		f.setCriteria({ version: 1, revision: '1', cases: [{ id: 'zero', predicateId: predicate.id, input: { [field.id!]: 0 }, expected: false }] });
		await f.service.implement(); await f.service.verify(); assert.strictEqual(f.service.canApply, true);
		f.picks.push(items => items.find(item => item.label === 'zero'), items => items.find(item => item.value === 'expected'), items => items.find(item => item.value === false)); await f.service.editPureCriteria(); assert.strictEqual(f.service.canApply, true);
		f.picks.push(items => items.find(item => item.label === 'zero'), items => items.find(item => item.value === 'expected'), items => items.find(item => item.value === true)); await f.service.editPureCriteria();
		assert.strictEqual(f.service.canApply, false); assert.strictEqual(f.service.canVerify, false); assert.match(f.service.structuralProblem ?? '', /expectations changed/);
	});
	test('native state simulation reads authored criteria and explains phases with zero provider requests', async () => {
		const f = fixture(false); f.useStateModel(); f.disable(); f.picks.push(items => items.find(item => item.label === 'checkout.failed-charge')); await f.service.simulateStates();
		assert.deepStrictEqual([f.requests, f.errors, f.editorInputs.length], [[], [], 1]); const opened = f.editorInputs[0] as { resource: URI }; assert.match(opened.resource.path, /\/.ordito\/reports\//); const contents = f.contextFiles.get(opened.resource.fsPath)!; for (const part of ['Draft', 'denied', 'doCancelled · action.watch', 'Zero AI Calls']) { assert.ok(contents.includes(part)); }
	});

	test('continuous preparation is off by default and coalesces native semantic edits without provider setup', async () => {
		const clock = sinon.useFakeTimers();
		try {
			const f = fixture(false); f.usePureModel(); f.disable(); f.projectChanged.fire(); await clock.tickAsync(650);
			assert.deepStrictEqual(f.requests, []); f.inputs.push('2'); await f.service.configureContinuity();
			Object.assign(f.project.model, { name: 'First' }); f.projectChanged.fire(); Object.assign(f.project.model, { name: 'Final' }); f.projectChanged.fire();
			await clock.tickAsync(650); assert.deepStrictEqual(f.requests, ['structuralPrepare']);
			assert.match(f.service.continuityStatus, /1\/2 Jobs.*Zero AI Calls.*Manual Publication/);
			f.projectChanged.fire(); await clock.tickAsync(650); assert.deepStrictEqual(f.requests, ['structuralPrepare']);
			await f.service.configureContinuity(); assert.match(f.service.continuityStatus, /Paused/);
		} finally { clock.restore(); }
	});
	test('continuous budget exhaustion blocks new jobs and resume does not refill the saved budget', async () => {
		const clock = sinon.useFakeTimers();
		try {
			const f = fixture(false); f.usePureModel(); f.inputs.push('1'); await f.service.configureContinuity(); await clock.tickAsync(650);
			Object.assign(f.project.model, { name: 'More' }); f.projectChanged.fire(); await clock.tickAsync(650);
			assert.deepStrictEqual(f.requests, ['structuralPrepare']); assert.match(f.service.continuityStatus, /Budget Exhausted/);
			f.picks.push(items => { assert.deepStrictEqual(items.map(item => item.label), ['Set New Budget']); return undefined; });
			await f.service.configureContinuity(); await clock.tickAsync(650);
			assert.match(f.service.continuityStatus, /Paused/);
			assert.deepStrictEqual(f.requests, ['structuralPrepare']); assert.equal(JSON.parse(f.storage.get('ordito.structural.continuity', StorageScope.WORKSPACE)!).attempted, 1);
			f.picks.push(items => items[0]); f.inputs.push('2'); f.confirmations.push(false); await f.service.configureContinuity(); await clock.tickAsync(650);
			assert.deepStrictEqual(f.requests, ['structuralPrepare'], 'canceling the new budget must not start work or refill consumption');
			f.picks.push(items => items[0]); f.inputs.push('2'); await f.service.configureContinuity(); await clock.tickAsync(650);
			assert.deepStrictEqual(f.requests, ['structuralPrepare', 'structuralPrepare']); assert.match(f.service.continuityStatus, /1\/2 Jobs/);
			await f.service.configureContinuity();
		} finally { clock.restore(); }
	});
	test('a saved preparation budget is displayed as paused after restart without starting jobs or leaking across project roots', async () => {
		const clock = sinon.useFakeTimers();
		try {
			const f = fixture(false); f.usePureModel();
			f.storage.store('ordito.structural.continuity', JSON.stringify({ version: 1, revision: 'saved', root: f.root, maxPreparations: 3, attempted: 2, maxInputBytes: 196608, outputReserveBytes: 65536, review: 'manual', providerCalls: 0 }), StorageScope.WORKSPACE, StorageTarget.MACHINE);
			assert.match(f.service.continuityStatus, /Paused.*2\/3 Jobs/);
			f.projectChanged.fire(); await clock.tickAsync(650); assert.deepStrictEqual(f.requests, []);
			f.setProjectRoot(URI.file('/different-project')); assert.match(f.service.continuityStatus, /Off.*0\/0 Jobs/);
			f.setProjectRoot(URI.file(f.root)); assert.match(f.service.continuityStatus, /Paused.*2\/3 Jobs/);
		} finally { clock.restore(); }
	});

	test('continuous preparation ignores layout, blocks incomplete specifications and pauses on project replacement', async () => {
		const clock = sinon.useFakeTimers();
		try {
			const f = fixture(false); f.usePureModel(); f.inputs.push('3'); await f.service.configureContinuity(); await clock.tickAsync(650);
			f.project.model.views = []; f.projectChanged.fire(); await clock.tickAsync(650); assert.deepStrictEqual(f.requests, ['structuralPrepare']);
			Object.assign(f.project.model, { foundation: { ...(f.project.model as typeof nodeOrdersFixture).foundation, predicates: [] } }); f.projectChanged.fire(); await clock.tickAsync(650); assert.match(f.service.continuityStatus, /Complete the Specification/);
			Object.assign(f.project.model, { id: 'another-project' }); f.projectChanged.fire(); assert.match(f.service.continuityStatus, /Paused/);
		} finally { clock.restore(); }
	});
	test('stale structural review cannot execute verification or publication through direct methods', async () => {
		const f = fixture(false); f.usePureModel(); await f.service.implement(); await f.service.verify();
		Object.assign(f.project.model, { name: 'New Task' }); f.projectChanged.fire(); await f.service.apply(); await f.service.verify();
		assert.deepStrictEqual(f.requests, ['structuralPrepare', 'structuralVerify']); assert.equal(f.service.canApply, false);
	});
	test('normal review returns to the diagram; technical packets remain an explicit secondary action', async () => {
		const f = fixture(false); f.usePureModel(); f.disable(); await f.service.implement();
		assert.ok(Object.hasOwn(f.editorInputs[0], 'resource')); assert.equal(f.editorInputs.length, 1);
		await f.service.structuralTechnicalReview(); assert.equal(f.editorInputs.length, 3);
		const diff = f.editorInputs[1] as { original: { resource: URI }; modified: { resource: URI } }, report = f.editorInputs[2] as { resource: URI };
		assert.deepStrictEqual(f.readonlyResources, [diff.original.resource.toString(), diff.modified.resource.toString(), report.resource.toString()]);
		assert.ok(f.contextFiles.has(report.resource.fsPath));
		assert.deepStrictEqual(f.requests, ['structuralPrepare']); assert.deepStrictEqual(f.errors, []);
	});

	test('worker freshness rejection invalidates frontend publication and exposes a resolvable issue', async () => {
		const f = fixture(false); f.usePureModel(); await f.service.implement(); await f.service.verify(); f.failPurePublication(); await f.service.apply();
		assert.equal(f.service.canApply, false); assert.equal(f.service.canVerify, false); assert.match(f.service.structuralProblem!, /inventory changed/);
		await f.service.apply(); assert.deepStrictEqual(f.requests, ['structuralPrepare', 'structuralVerify', 'structuralApply']);
	});

	test('incremental import binds the registered tools before chat and reuses its project session', async () => {
		const f = fixture(); f.enableIncremental(); f.publishAccount({ status: 'signedIn' }); f.setups.push({ agent: 'codex', download: 'ready' });
		await f.service.buildDiagrams();
		assert.deepStrictEqual([f.requests, f.diagramTools.size, f.sessionTools.size, f.service.diagramExploration?.model, f.terminals.length], [['exploration'], diagramToolDefinitions.length, 1, 'chat-selected', 0]);
		assert.ok(f.diagramTools.values().next().value!.data.agentHostPreferences?.availability === 'session');
		assert.ok(f.diagramContexts.some(value => value.includes('ordito_project_inspect')));
		await f.service.resumeDiagrams();
		assert.deepStrictEqual([f.chats[0].resource, f.diagramTools.size], [f.chats[1].resource, diagramToolDefinitions.length]);
	});
	test('features run from an approved source scope with a fresh provider request at every checkpoint', async () => {
		const f = fixture();
		f.setFeatureState({ phase: 'discovery' });
		f.setConfirmed(false);
		await f.service.buildDiagrams();
		assert.strictEqual(f.chatRequests.length, 0);
		f.setConfirmed(true);
		const planItems = [
			{ id: 'checkout-view', name: 'Checkout', viewKind: 'structure' as const, intent: 'Expose checkout', rationale: 'Show checkout responsibilities', dependsOn: [], featureId: 'checkout' },
			{ id: 'refund-view', name: 'Refund', viewKind: 'structure' as const, intent: 'Expose refund', rationale: 'Show refund responsibilities', dependsOn: ['checkout-view'], featureId: 'refund' }
		];
		const states: Partial<CodeDiagramExploration>[] = [
			{ phase: 'planning', nextFeatureId: 'checkout' },
			{ phase: 'diagrams', nextFeatureId: 'checkout', nextTaskId: 'checkout-view' },
			{ phase: 'planning', nextFeatureId: 'refund' },
			{ phase: 'diagrams', nextFeatureId: 'refund', nextTaskId: 'refund-view' },
			{ phase: 'audit' },
			{ phase: 'repair', nextFindingId: 'shared-orders' },
			{ phase: 'repair', nextFindingId: 'refund-limits' },
			{ phase: 'review', plan: { revision: 'ready', items: planItems }, tasks: planItems.map(item => ({ id: item.id, status: 'ready', intent: item.intent, gaps: [] })), proposals: [{ id: 'diagram-drafts', status: 'ready', diagnostics: [], views: checkoutModel.views }] }
		];
		f.handleCheckpoint(async () => { f.setFeatureState(states.shift()!); return 'Checkpoint recorded'; });
		await f.service.resumeDiagrams();
		assert.deepStrictEqual([states.length, f.chatRequests.length, f.dialogs.length, f.service.diagramExploration?.phase, f.service.diagramActivity?.length], [0, 8, 0, 'review', 8]);
		assert.ok(f.chatRequests.every(request => request.checkpoint && request.messages.length === 1 && !request.messages[0].text.includes('Checkpoint recorded')));
		assert.ok(f.chatRequests.every(request => request.checkpointReasoningEffort === 'medium'));
		assert.equal(new Set(f.chatRequests.map(request => request.requestId)).size, 8);
		assert.match(f.chatRequests[5].messages[0].text, /Audit the complete staged diagram set/);
		assert.ok(f.chatRequests.slice(6).every(request => request.messages[0].text.startsWith('Resolve the active audit finding')));
		assert.ok(f.dialogDetails.at(-1)?.includes('Imported source scope · Included 1 · Excluded 0'));
		assert.equal(f.explorationActions.includes('publishAll'), false);
	});

	test('configuring the diagram attempt duration validates and persists whole minutes without an exploration session', async () => {
		const f = fixture();
		await f.service.configureDiagramCheckpointTimeout();
		const input = f.inputOptions.at(-1)!;
		assert.deepStrictEqual([input.title, input.value, input.showConfirmButton], ['Diagram Attempt Time Limit', '20', true]);
		for (const value of ['', '0', '1.5', '91', 'invalid']) {
			assert.ok(await input.validateInput?.(value), value);
		}
		for (const value of ['1', '35', '90']) {
			assert.ok(!await input.validateInput?.(value), value);
		}
		assert.deepStrictEqual(f.configurationEdits, []);
		f.inputs.push('91');
		await f.service.configureDiagramCheckpointTimeout();
		assert.deepStrictEqual(f.configurationEdits, []);
		f.inputs.push('35');
		await f.service.configureDiagramCheckpointTimeout();
		assert.deepStrictEqual(f.configurationEdits, [{ key: diagramCheckpointTimeoutSetting, value: 35, target: ConfigurationTarget.USER }]);
		await f.service.configureDiagramCheckpointTimeout();
		assert.equal(f.inputOptions.at(-1)?.value, '35');
		assert.equal(f.configurationEdits.length, 1);
		assert.deepStrictEqual(f.requests, []);
		assert.equal(f.service.diagramExploration, undefined);

		f.setFeatureState({ phase: 'discovery' });
		f.handleCheckpoint(async () => {
			f.setFeatureState({ phase: 'review' });
			return 'Checkpoint recorded';
		});
		await f.service.buildDiagrams();
		assert.deepStrictEqual(f.chatRequests.map(request => request.checkpointTimeoutMinutes), [35]);
	});

	test('a timed-out diagram checkpoint resumes from the saved draft and retries it once', async () => {
		const f = fixture();
		const checkpoint = { phase: 'diagrams' as const, nextFeatureId: 'checkout', nextTaskId: 'checkout-structure' };
		const draft = { id: 'saved-structure', status: 'ready' as const, diagnostics: [], views: [] };
		f.setFeatureState(checkpoint);
		f.handleCheckpoint(async request => {
			if (f.chatRequests.length === 1) {
				assert.deepStrictEqual([request.checkpointTimeoutMinutes, request.checkpointReasoningEffort], [20, 'medium']);
				f.configurationValues.set(diagramCheckpointTimeoutSetting, 35);
				f.configurationValues.set(diagramCheckpointReasoningEffortSetting, 'inherit');
				f.setFeatureState({ ...checkpoint, proposals: [draft] });
				return { timeout: 'deadline' };
			}
			assert.deepStrictEqual([request.checkpointTimeoutMinutes, request.checkpointReasoningEffort], [35, 'inherit']);
			assert.equal(f.service.diagramExploration?.proposals[0]?.id, draft.id);
			assert.equal(f.service.diagramLiveProgress?.retrying, true);
			assert.match(request.messages[0].text, /ordito_project_inspect to recover the saved task and draft/);
			return { timeout: 'deadline' };
		});
		await f.service.buildDiagrams();
		assert.equal(f.chatRequests.length, 2);
		assert.notEqual(f.chatRequests[0].requestId, f.chatRequests[1].requestId);
		assert.deepStrictEqual(f.chatRequests.map(request => [request.sessionId, request.snapshot]), Array(2).fill([f.chatRequests[0].sessionId, f.chatRequests[0].snapshot]));
		assert.equal(f.dialogDetails.length, 1);
		assert.equal(f.service.diagramExploration?.proposals[0]?.id, draft.id);
		assert.match(f.service.diagramExplorationIssue!, /reached the time limit.*Choose Continue Generation/);
	});

	test('a timeout after a checkpoint is saved proceeds to the next diagram without retrying completed work', async () => {
		const f = fixture();
		const first = { phase: 'diagrams' as const, nextFeatureId: 'checkout', nextTaskId: 'checkout-structure' };
		const second = { phase: 'diagrams' as const, nextFeatureId: 'checkout', nextTaskId: 'checkout-interaction' };
		f.setFeatureState(first);
		f.handleCheckpoint(async () => {
			if (f.chatRequests.length === 1) {
				f.setFeatureState({ ...second, tasks: [{ id: first.nextTaskId, intent: 'Structure', status: 'ready', gaps: [] }] });
				return { timeout: 'deadline' };
			}
			assert.equal(f.service.diagramExploration?.nextTaskId, second.nextTaskId);
			assert.equal(f.service.diagramLiveProgress?.retrying, false);
			f.setFeatureState({ phase: 'review' });
			return 'Checkpoint recorded';
		});
		await f.service.buildDiagrams();
		assert.deepStrictEqual([f.chatRequests.length, f.service.diagramExploration?.phase, f.service.diagramExplorationIssue], [2, 'review', undefined]);
	});

	test('timeout recovery honors the saved exploration budget and a saved clarification', async () => {
		for (const stopFor of ['budget', 'clarification'] as const) {
			const f = fixture();
			const checkpoint = { phase: 'diagrams' as const, nextFeatureId: 'checkout', nextTaskId: 'checkout-structure' };
			f.setFeatureState(checkpoint);
			f.handleCheckpoint(async () => {
				f.setFeatureState({
					...checkpoint,
					...(stopFor === 'budget'
						? { budgetStatus: { exhausted: ['duration'] } }
						: { tasks: [{ id: checkpoint.nextTaskId, intent: 'Structure', status: 'waitingUser', gaps: ['Where are orders stored?'] }] })
				});
				return { timeout: 'deadline' };
			});
			await f.service.buildDiagrams();
			assert.equal(f.chatRequests.length, 1);
			assert.equal(f.service.diagramExplorationIssue, undefined);
			if (stopFor === 'budget') { assert.deepStrictEqual(f.service.diagramExploration?.budgetStatus?.exhausted, ['duration']); }
			else { assert.equal(f.service.diagramClarification, 'Where are orders stored?'); }
		}
	});

	test('automatic recovery requires a structured timeout and the same project scope', async () => {
		for (const failure of ['other error', 'changed scope'] as const) {
			const f = fixture();
			f.setFeatureState({ phase: 'discovery' });
			f.handleCheckpoint(async () => {
				if (failure === 'other error') { throw new Error('Operation timed out'); }
				f.code.context.snapshot = f.root + '/.ordito/imports/another-snapshot';
				return { timeout: 'deadline' };
			});
			await f.service.buildDiagrams();
			assert.equal(f.chatRequests.length, 1);
		}
	});

	test('inline exploration shows persisted work and counters while the provider is still running', async () => {
		const f = fixture(), started = new DeferredPromise<Extract<CodeRequest, { operation: 'diagramChat' }>>(), provider = new DeferredPromise<string>();
		f.setFeatureState({ phase: 'discovery' });
		f.handleCheckpoint(request => { void started.complete(request); return provider.p; });
		const generating = f.service.buildDiagrams();
		const request = await started.p;
		const requestId = request.requestId!;
		const clock = sinon.useFakeTimers({ now: Date.now() });
		try {
			const startTime = f.service.diagramLiveProgress!.startedAt;
			assert.equal(f.service.diagramLiveProgress?.state, 'connecting');
			f.aiProgress.fire({ requestId: 'another-request', kind: 'waiting' });
			assert.equal(f.service.diagramLiveProgress?.state, 'connecting');
			f.aiProgress.fire({ requestId, kind: 'thinking' });
			assert.equal(f.service.diagramLiveProgress?.state, 'working');
			const receipt = { id: 'inspection', turnId: requestId, tool: 'ordito_project_inspect' };
			const usage = { ...f.service.diagramExploration!.usage, toolCalls: 1 };
			f.setFeatureState({ phase: 'discovery', usage, toolActivity: [{ ...receipt, state: 'running' }] });
			const changedJournal = () => f.fileChanges.fire({ contains: resource => resource.path.endsWith(`/${request.sessionId}.json`) });
			changedJournal();
			f.aiProgress.fire({ requestId, kind: 'tool', itemId: 'provider-inspection', tool: receipt.tool });
			await clock.tickAsync(150);
			assert.deepStrictEqual([f.service.diagramLiveProgress?.state, f.service.diagramLiveProgress?.activeTool, f.service.diagramExploration?.usage.toolCalls], ['tool', receipt.tool, 1]);

			const completed = { ...receipt, state: 'complete' as const };
			f.setFeatureState({ phase: 'planning', usage: { ...usage, readBytes: 100 }, toolActivity: [completed] });
			changedJournal();
			f.aiProgress.fire({ requestId, kind: 'tool', itemId: 'provider-inspection', tool: receipt.tool });
			await clock.tickAsync(150);
			assert.deepStrictEqual([f.service.diagramLiveProgress?.state, f.service.diagramLiveProgress?.activeTool, f.service.diagramLiveProgress?.lastCompletedTool], ['waiting', undefined, receipt.tool]);
			assert.deepStrictEqual([f.service.diagramExploration?.phase, f.service.diagramExploration?.usage.readBytes, f.chatRequests.length], ['planning', 100, 1]);
			assert.equal(f.service.diagramLiveProgress?.startedAt, startTime);
			assert.deepStrictEqual(f.service.diagramActivity, [{ requestId, itemId: receipt.id, kind: 'tool', text: receipt.tool }]);
			const updatedAt = f.service.diagramLiveProgress?.updatedAt;
			changedJournal();
			await clock.tickAsync(150);
			assert.equal(f.service.diagramLiveProgress?.updatedAt, updatedAt);
			assert.equal(f.service.diagramActivity?.length, 1);
			f.setFeatureState({ phase: 'review', usage, toolActivity: [completed] });
		} finally {
			await provider.complete('Checkpoint recorded');
			await generating;
			clock.restore();
		}
		assert.equal(f.service.diagramLiveProgress, undefined);
	});

	test('a delayed live read cannot replace a newer checkpoint and its budget counters', async () => {
		const f = fixture();
		const started = new DeferredPromise<void>(), provider = new DeferredPromise<string>();
		const statusStarted = new DeferredPromise<void>(), slowStatus = new DeferredPromise<void>();
		f.setFeatureState({ phase: 'discovery' });
		f.handleCheckpoint(() => { void started.complete(); return provider.p; });
		f.handleExplorationStatus(async response => {
			if (!statusStarted.isSettled) { void statusStarted.complete(); await slowStatus.p; }
			return response;
		});
		const generating = f.service.buildDiagrams();
		await started.p;
		const clock = sinon.useFakeTimers();
		try {
			f.fileChanges.fire({ contains: () => true });
			await clock.tickAsync(150);
			assert.equal(statusStarted.isSettled, true);
			f.setFeatureState({
				phase: 'review',
				usage: { ...f.service.diagramExploration!.usage, toolCalls: 2 },
				budgetStatus: { exhausted: ['calls'] }
			});
			await provider.complete('Checkpoint recorded');
			await generating;
			await slowStatus.complete();
			await clock.tickAsync(0);
			assert.deepStrictEqual([f.service.diagramExploration?.phase, f.service.diagramExploration?.usage.toolCalls, f.service.diagramExploration?.budgetStatus?.exhausted], ['review', 2, ['calls']]);
		} finally {
			if (!provider.isSettled) { await provider.complete('Checkpoint recorded'); }
			if (!slowStatus.isSettled) { await slowStatus.complete(); }
			await generating;
			clock.restore();
		}
	});

	test('the inline Stop action cancels only the active request and a clarification can resume the checkpoint', async () => {
		const f = fixture(), started = new DeferredPromise<void>();
		f.setFeatureState({ phase: 'discovery' });
		let cancelled = false;
		f.handleCheckpoint(async (request, token) => new Promise<CodeDiagramCheckpointResult>(resolve => {
			store.add(token.onCancellationRequested(() => {
				cancelled = true;
				f.setFeatureState({ phase: 'discovery', toolActivity: [{ id: 'saved-discovery', tool: 'ordito_project_inspect', turnId: request.requestId, state: 'complete' }] });
				f.aiProgress.fire({ requestId: request.requestId!, kind: 'thinking' });
				resolve({ timeout: 'deadline' });
			}));
			void started.complete();
		}));
		const generating = f.service.buildDiagrams();
		await started.p;
		assert.equal(f.service.generatingDiagrams, true);
		const stoppingStates: NonNullable<typeof f.service.diagramLiveProgress>['state'][] = [];
		store.add(f.service.onDidChange(() => {
			if (f.service.diagramLiveProgress) { stoppingStates.push(f.service.diagramLiveProgress.state); }
		}));
		f.service.stopDiagramExploration();
		assert.equal(f.service.diagramLiveProgress?.state, 'stopping');
		await generating;
		assert.deepStrictEqual([cancelled, f.service.generatingDiagrams, f.chatRequests.length, f.dialogs.length], [true, false, 1, 0]);
		assert.ok(stoppingStates.length && stoppingStates.every(state => state === 'stopping'));
		assert.equal(f.service.diagramLiveProgress, undefined);
		assert.equal(f.service.diagramActivity?.at(-1)?.text, 'ordito_project_inspect');
		assert.match(f.service.diagramExplorationIssue!, /Saved Step/);
		f.handleCheckpoint(async () => 'CLARIFICATION: Are refunds supported?');
		await f.service.resumeDiagrams();
		assert.equal(f.service.diagramClarification, 'Are refunds supported?');
		f.inputs.push('Refunds are supported.');
		f.handleCheckpoint(async request => {
			assert.ok(request.messages[0].text.includes('Refunds are supported.'));
			f.setFeatureState({ phase: 'review' });
			return 'Accepted';
		});
		await f.service.clarifyDiagramExploration();
		assert.equal(f.service.diagramClarification, undefined);
		assert.deepStrictEqual([f.dialogDetails.length, f.chatRequests.length], [1, 3]);
	});

	test('editing the default exploration budget stores user capacity without starting work', async () => {
		const f = fixture(true, 'codex', 0);
		await f.service.configureDefaultDiagramBudget();
		assert.deepStrictEqual(f.budgetEditors[0], { mode: 'default', budget: defaultProjectBudget });
		assert.deepStrictEqual(f.configurationEdits, []);
		const custom = { maxToolCalls: 640, maxReadBytes: 12 * 1024 * 1024, maxDurationMs: 105 * 60_000, maxModelTurns: 48 };
		f.handleBudgetEditor(async () => custom);
		await f.service.configureDefaultDiagramBudget();
		assert.deepStrictEqual(f.configurationEdits, [{ key: diagramExplorationBudgetSetting, value: custom, target: ConfigurationTarget.USER }]);
		assert.deepStrictEqual(f.requests, []);
		assert.equal(f.service.diagramExploration, undefined);

		f.prepareProjectReview();
		await f.service.buildDiagrams();
		assert.deepStrictEqual(f.explorationOpens, [{ sessionId: undefined, budget: custom }]);
		assert.deepStrictEqual(f.service.diagramExploration?.budget, custom);
		assert.deepStrictEqual(f.chatRequests, []);
	});

	test('the default budget is used only when a new project exploration opens', async () => {
		const f = fixture(true, 'codex', 0);
		f.prepareProjectReview();
		await f.service.buildDiagrams();
		const id = f.service.diagramExploration!.sessionId;
		assert.deepStrictEqual(f.service.diagramExploration!.budget, defaultProjectBudget);
		f.configurationValues.set(diagramExplorationBudgetSetting, { ...defaultProjectBudget, maxToolCalls: 900 });
		await f.service.resumeDiagrams();
		assert.deepStrictEqual(f.explorationOpens, [{ sessionId: undefined, budget: defaultProjectBudget }, { sessionId: id, budget: undefined }]);
		assert.deepStrictEqual(f.service.diagramExploration!.budget, defaultProjectBudget);
	});

	test('adding exploration budget sends deltas, retains consumed capacity and measures elapsed time at commit', async () => {
		const clock = sinon.useFakeTimers({ now: Date.now() });
		try {
			const id = generateUuid(), f = fixture(true, 'codex', 0, { id });
			const previous = { maxToolCalls: 400, maxReadBytes: 8 * 1024 * 1024, maxDurationMs: 90 * 60_000, maxModelTurns: 32 };
			const usage = { toolCalls: 70, readBytes: 65536, modelTurns: ['turn'], turnsObservable: true, inputTokens: null, outputTokens: null };
			f.prepareProjectReview();
			f.setExplorationBudget(previous, 10 * 60_000);
			f.setFeatureState({ usage });
			await f.service.buildDiagrams();
			f.handleBudgetEditor(async () => { await clock.tickAsync(2 * 60_000); return budgetIncrease; });
			await f.service.configureDiagramBudget();
			assert.deepStrictEqual(f.budgetEditors[0], {
				mode: 'extension',
				capacity: { maxToolCalls: 600, maxReadBytes: 24 * 1024 * 1024, maxDurationMs: (24 * 60 - 80) * 60_000, maxModelTurns: 68 }
			});
			assert.deepStrictEqual(f.explorationBudgetRequests, [{ sessionId: id, budgetIncrease }]);
			assert.deepStrictEqual(f.service.diagramExploration!.budget, { maxToolCalls: 500, maxReadBytes: 10 * 1024 * 1024, maxDurationMs: 108 * 60_000, maxModelTurns: 40 });
			assert.deepStrictEqual(f.service.diagramExploration!.usage, usage);

			const capacityOnly = { maxToolCalls: 50, maxReadBytes: 0, maxDurationMs: 0, maxModelTurns: 0 };
			const window = f.service.diagramExploration!.budgetWindow!;
			f.handleBudgetEditor(async () => { await clock.tickAsync(60_000); return capacityOnly; });
			await f.service.configureDiagramBudget();
			assert.deepStrictEqual(f.explorationBudgetRequests.at(-1), { sessionId: id, budgetIncrease: capacityOnly });
			assert.equal(f.service.diagramExploration!.budgetWindow?.started, window.started);
			assert.equal(f.service.diagramExploration!.budgetWindow?.remainingMs, window.remainingMs - 60_000);
			assert.deepStrictEqual(f.configurationEdits, []);
			assert.deepStrictEqual(f.chatRequests, []);
		} finally { clock.restore(); }
	});

	test('canceling an extension or changing the source snapshot leaves the exploration budget intact', async () => {
		const f = fixture(true, 'codex', 0);
		f.prepareProjectReview();
		await f.service.buildDiagrams();
		await f.service.configureDiagramBudget();
		assert.equal(f.budgetEditors.length, 1);
		assert.deepStrictEqual(f.explorationBudgetRequests, []);

		const shown = new DeferredPromise<void>(), response = new DeferredPromise<ExplorationBudget>();
		f.handleBudgetEditor(() => { void shown.complete(); return response.p; });
		const editing = f.service.configureDiagramBudget();
		await shown.p;
		f.code.context.snapshot = f.root + '/.ordito/imports/replacement';
		f.changed.fire();
		await response.complete(budgetIncrease);
		await editing;
		assert.deepStrictEqual(f.explorationBudgetRequests, []);
		assert.deepStrictEqual(f.chatRequests, []);
	});

	test('complete diagram review data opens as a named protected report without changing the review', async () => {
		const f = fixture(); f.prepareProjectReview(); await f.service.buildDiagrams(); await f.service.reviewDiagramProposal();
		const review = f.service.diagramReview; await f.service.inspectDiagramReview();
		const resource = (f.editorInputs.at(-1) as { resource: URI }).resource;
		assert.match(resource.path, /\/\.ordito\/reports\/[a-f0-9-]+\/Diagram Review\.json$/);
		assert.ok(f.readonlyResources.includes(resource.toString()));
		assert.deepStrictEqual(JSON.parse(f.contextFiles.get(resource.fsPath)!), JSON.parse(review!.contents));
		assert.strictEqual(f.service.diagramReview, review);
	});

	test('matching saved diagram work restores locally without opening a conversation or starting AI', async () => {
		const id = generateUuid();
		const f = fixture(true, 'codex', 0, { id }); f.prepareProjectReview();
		f.changed.fire();
		await timeout(0);
		assert.strictEqual(f.service.diagramExploration?.sessionId, id);
		assert.strictEqual(f.service.diagramExploration?.proposals[0]?.status, 'ready');
		assert.deepStrictEqual(f.explorationActions, ['status']);
		assert.deepStrictEqual([f.chats, f.dialogs, f.terminals, f.chatRequests], [[], [], [], []]);
		f.code.context.sourceRoot = '/another-project'; f.changed.fire();
		const afterProjectChange = f.service.diagramExploration;
		assert.strictEqual(afterProjectChange, undefined);
		f.code.context.sourceRoot = f.root; f.changed.fire(); await timeout(0);
		assert.strictEqual(f.service.diagramExploration?.sessionId, id);
		assert.deepStrictEqual(f.explorationActions, ['status', 'status']);
	});

	test('a removed persisted exploration starts a new session after reimporting the same root', async () => {
		const oldId = generateUuid();
		const f = fixture(true, 'codex', 2, { id: oldId, resource: 'agent-host-codex:/removed-session' });
		f.enableIncremental(); f.removeExploration();
		await f.service.buildDiagrams();
		assert.deepStrictEqual([f.explorationSessionIds[0], f.dialogs.length, f.errors], [undefined, 1, []]);
		const saved = JSON.parse(f.storage.get('ordito.ai.exploration', StorageScope.WORKSPACE)!);
		assert.notEqual(saved.id, oldId);
		assert.equal(saved.resource, undefined);
	});

	test('a persisted exploration retains its drafts and opens a fresh chat after the import snapshot advances', async () => {
		const id = generateUuid(), resource = 'agent-host-codex:/existing-session';
		const f = fixture(true, 'codex', 2, { id, resource });
		f.enableIncremental(); f.publishAccount({ status: 'signedIn' }); f.setups.push({ agent: 'codex', download: 'ready' });
		f.code.context.snapshot = f.root + '/.ordito/imports/next-snapshot';
		await f.service.resumeDiagrams();
		assert.notEqual(f.chats[0].resource, resource);
		assert.deepStrictEqual([f.explorationSessionIds, f.service.diagramExploration?.sessionId, f.errors], [[id], id, []]);
	});

	test('removing the exploration detaches its native chat, tools and review before opening a new session', async () => {
		const f = fixture(); f.prepareExploratoryDraft(); f.publishAccount({ status: 'signedIn' }); f.setups.push({ agent: 'codex', download: 'ready' });
		await f.service.buildDiagrams(); await f.service.reviewDiagramProposal('draft-review');
		const oldId = f.service.diagramExploration!.sessionId, oldChat = f.chats[0].resource;
		f.removeExploration();
		await f.service.chat();
		assert.notEqual(f.service.diagramExploration!.sessionId, oldId);
		assert.notEqual(f.chats.at(-1)!.resource, oldChat);
		assert.deepStrictEqual([f.diagramTools.size, f.sessionTools.has(oldChat), f.service.diagramReview, f.errors], [diagramToolDefinitions.length, false, undefined, []]);
	});

	test('removing the exploration opens a fresh modal and keeps the terminal closed', async () => {
		const f = fixture(); f.enableIncremental();
		await f.service.buildDiagrams();
		const oldId = f.service.diagramExploration!.sessionId;
		f.removeExploration();
		await f.service.chat();
		assert.notEqual(f.service.diagramExploration!.sessionId, oldId);
		assert.deepStrictEqual([f.dialogs.length, f.errors], [2, []]);
	});

	test('returning to diagrams after deleting the session clears its stale workspace reference', async () => {
		const f = fixture(); f.enableIncremental();
		await f.service.buildDiagrams();
		f.removeExploration();
		await f.service.returnToDiagrams();
		assert.deepStrictEqual([f.service.diagramExploration, f.service.chatLocation, f.storage.get('ordito.ai.exploration', StorageScope.WORKSPACE), f.errors], [undefined, undefined, undefined, []]);
		await f.service.buildDiagrams();
		assert.deepStrictEqual([f.dialogs.length, f.errors], [2, []]);
	});

	test('a permission error does not discard a saved exploration or replace its conversation', async () => {
		const f = fixture(); f.enableIncremental();
		await f.service.buildDiagrams();
		const saved = f.storage.get('ordito.ai.exploration', StorageScope.WORKSPACE);
		f.failExplorationRead(new FileOperationError('Permission denied', FileOperationResult.FILE_PERMISSION_DENIED));
		await assert.rejects(f.service.chat(), /Permission denied/);
		assert.deepStrictEqual([f.storage.get('ordito.ai.exploration', StorageScope.WORKSPACE), f.dialogs.length], [saved, 1]);
		await f.service.buildDiagrams();
		assert.deepStrictEqual([f.dialogs.length, f.errors.length], [1, 1]);
	});

	test('the CLI modal sends a cancellable headless request with its project session and refreshes automatically', async () => {
		const f = fixture(); f.enableIncremental();
		await f.service.buildDiagrams();
		assert.deepStrictEqual([f.requests, f.terminals.length], [['exploration'], 0]);
		const response = await f.dialogs[0].send!([{ role: 'user', text: 'Prepare every planned diagram' }], CancellationToken.None);
		assert.deepStrictEqual([response, f.requests, f.service.busy, f.liveUpdates.map(event => event.text)], ['Diagrams prepared', ['exploration', 'diagramChat', 'exploration'], false, ['Diagrams prepared']]);
		assert.equal(Object.hasOwn(f.chatRequests[0], 'checkpointTimeoutMinutes'), false);
		assert.equal(Object.hasOwn(f.chatRequests[0], 'checkpointReasoningEffort'), false);
	});

	test('sending from a blocked review refreshes its existing decision surface after the response', async () => {
		const f = fixture(); f.prepareProjectReview();
		await f.service.buildDiagrams(); await f.service.reviewDiagramProposal();
		const before = f.explorationActions.filter(action => action === 'review').length;
		await f.dialogs[0].send!([{ role: 'user', text: 'Repair the review blockers' }], CancellationToken.None);
		assert.equal(f.explorationActions.filter(action => action === 'review').length, before + 1);
		assert.equal(f.liveUpdates[0].text, 'Diagrams prepared');
	});

	test('session file changes refresh progress through the read-only status action', async () => {
		const f = fixture(); f.enableIncremental(); await f.service.buildDiagrams();
		const clock = sinon.useFakeTimers();
		try {
			f.fileChanges.fire({ contains: () => true }); await clock.tickAsync(350);
			assert.deepStrictEqual(f.explorationActions, ['open', 'status']);
			await f.service.returnToDiagrams(); const count = f.requests.length;
			f.fileChanges.fire({ contains: () => true }); await clock.tickAsync(350);
			assert.equal(f.requests.length, count, 'closing the modal disposes the watcher');
		} finally { clock.restore(); }
	});

	test('diagram tools reject a different chat and are disposed with their session binding', async () => {
		const f = fixture(); f.enableIncremental(); f.publishAccount({ status: 'signedIn' }); f.setups.push({ agent: 'codex', download: 'ready' });
		await f.service.buildDiagrams();
		const entry = f.diagramTools.values().next().value!;
		await assert.rejects(entry.impl.invoke({ callId: 'wrong-chat', toolId: entry.data.id, parameters: {}, context: { sessionResource: URI.parse('agent-host-codex:/another-conversation') } }, async () => 0, { report: () => {} }, CancellationToken.None), /Another Conversation/);
		f.service.dispose();
		assert.deepStrictEqual([f.diagramTools.size, f.sessionTools.size], [0, 0]);
	});

	test('an explicitly selected model is applied without changing account, and a failed first open can be retried', async () => {
		const f = fixture(); f.enableIncremental(); f.publishAccount({ status: 'signedIn' }); f.setups.push({ agent: 'codex', download: 'ready' });
		f.storage.store('ordito.ai.diagramModel.codex', 'gpt-5.6-terra', StorageScope.PROFILE, StorageTarget.MACHINE);
		await f.service.buildDiagrams();
		assert.match(f.errors[0], /Selected Diagram Model Is Not Available/);
		assert.deepStrictEqual([f.selectedChatModels, f.terminals.length, f.diagramTools.size], [[], 0, diagramToolDefinitions.length]);
		f.nativeDiagramModels.push('gpt-5.6-terra'); await f.service.resumeDiagrams();
		assert.deepStrictEqual([f.selectedChatModels, f.errors.length, f.diagramTools.size], [['native:gpt-5.6-terra'], 1, diagramToolDefinitions.length]);
	});
	test('promotion from an untitled chat to its canonical URI preserves the exploratory conversation', async () => {
		const f = fixture(); f.enableIncremental(); f.publishAccount({ status: 'signedIn' }); f.setups.push({ agent: 'codex', download: 'ready' });
		await f.service.buildDiagrams();
		const canonical = URI.parse('agent-host-codex:/canonical-session'), original = f.chats[0].resource;
		f.sessionTools.set(canonical.toString(), f.sessionTools.get(original)!);
		const entry = f.diagramTools.values().next().value!;
		await entry.impl.invoke({ callId: 'promoted-chat', toolId: entry.data.id, parameters: {}, context: { sessionResource: canonical, requestId: 'turn-one' } }, async () => 0, { report: () => {} }, CancellationToken.None);
		await f.service.chat();
		assert.deepStrictEqual([f.chats.at(-1)!.resource, f.diagramTools.size], [canonical.toString(), diagramToolDefinitions.length]);
		assert.equal(JSON.parse(f.storage.get('ordito.ai.exploration', StorageScope.WORKSPACE)!).resource, canonical.toString());
	});

	test('review opens one human-readable surface and waits for an explicit apply action', async () => {
		const f = fixture(); f.prepareExploratoryDraft(); f.publishAccount({ status: 'signedIn' }); f.setups.push({ agent: 'codex', download: 'ready' });
		await f.service.buildDiagrams(); await f.service.reviewDiagramProposal('draft-review');
		assert.deepStrictEqual(f.explorationActions, ['open', 'open', 'ordito_view_preview']);
		assert.match(f.service.diagramReview!.contents, /Reviewed responsibility/);
		assert.equal(f.service.diagramReview!.images.length, 1);
		assert.equal(f.opened.length, 0);
		await f.service.applyDiagramReview();
		assert.deepStrictEqual(f.explorationActions, ['open', 'open', 'ordito_view_preview', 'publish', 'open']);
		assert.deepStrictEqual([f.opened[0].snapshot, f.service.diagramReview], [f.root + '/.ordito/imports/published', undefined]);
	});

	test('complete project review combines previews and applies all changes only after one final confirmation', async () => {
		const f = fixture(); f.prepareProjectReview();
		await f.service.buildDiagrams(); await f.service.reviewDiagramProposal();
		assert.deepStrictEqual([f.service.diagramReview?.projectReviewId, f.service.diagramReview?.images.length, f.opened.length], ['whole-project-review', 2, 0]);
		assert.ok(f.explorationActions.includes('review'));
		assert.equal(f.explorationActions.includes('ordito_view_preview'), false);
		f.setConfirmed(false); await f.service.applyDiagramReview();
		assert.equal(f.explorationActions.includes('publishAll'), false);
		f.setConfirmed(true); await f.service.applyDiagramReview();
		assert.deepStrictEqual([f.explorationActions.filter(action => action === 'publishAll').length, f.explorationActions.includes('publish'), f.opened.length, f.service.diagramReview], [1, false, 1, undefined]);
	});

	test('chat after applying diagrams opens without a prompt to repeat the completed generation', async () => {
		const f = fixture(); f.prepareExploratoryDraft();
		await f.service.buildDiagrams(); await f.service.reviewDiagramProposal('draft-review'); await f.service.applyDiagramReview();
		await f.service.chat();
		assert.equal(f.dialogs.at(-1)!.prompt, '');
		assert.equal(f.service.diagramExploration?.proposals[0].status, 'applied');
	});

	test('diagram-to-code orchestration stages serial features before independent verification and review apply', async () => {
		const f = fixture();
		const setup = await f.service.inspectCodeGeneration();
		assert.strictEqual(setup?.mode, 'create');
		await f.service.prepareCodeGeneration({ profileId: 'node.esm', featureIds: ['purchase', 'refund'] });
		assert.deepStrictEqual(f.service.codeGeneration?.tasks.map(task => [task.id, task.status]), [['purchase', 'ready'], ['refund', 'ready']]);
		await f.service.applyCodeGeneration();
		assert.strictEqual(f.service.codeGeneration?.status, 'ready');
		await f.service.verifyCodeGeneration();
		await f.service.applyCodeGeneration();
		assert.strictEqual(f.service.codeGeneration?.status, 'applied');
		await f.service.undoCodeGeneration();
		assert.deepStrictEqual([f.service.codeGeneration?.status, f.requests.filter(request => request.startsWith('featureImplementation')), f.errors], ['undone', ['featureImplementationInspect', 'featureImplementationPrepare', 'featureImplementationStep', 'featureImplementationStep', 'featureImplementationVerify', 'featureImplementationApply', 'featureImplementationUndo'], []]);
	});

	test('codebase update sends only the saved model delta after an explicit start, outside chat', async () => {
		const f = fixture();
		f.project.model.semantics.elements[1].description = 'An unchanged requirement that must stay local';
		const previous = structuredClone(f.project.model);
		f.project.model.semantics.elements[0].description = 'Confirm a checkout in EUR';
		const changes = f.saveCodeUpdate(previous);
		await f.service.updateCodebase();
		assert.deepStrictEqual([f.service.codeUpdateState?.phase, f.codeUpdateRequests.length, f.dialogs.length], ['ready', 0, 0]);

		const running = new DeferredPromise<void>();
		const result = new DeferredPromise<CodeUpdateResult>();
		f.onCodeUpdate(async () => { await running.complete(); return result.p; });
		const update = f.service.startCodeUpdate();
		await running.p;
		const [request] = f.codeUpdateRequests;
		assert.deepStrictEqual([request.root, JSON.parse(request.context).changes, f.service.codeUpdateState?.phase], [f.root, changes, 'running']);
		assert.ok(!request.context.includes('An unchanged requirement'));
		assert.ok(!request.context.includes(f.project.modelUri.fsPath));
		await result.complete({ outcome: 'implemented', text: 'Updated checkout and ran its focused tests.' });
		await update;
		assert.deepStrictEqual([f.service.codeUpdateState?.phase, f.service.codeUpdateState?.summary, f.chatRequests.length, f.dialogs.length], ['completed', 'Updated checkout and ran its focused tests.', 0, 0]);
		f.service.closeCodeUpdate();
		await f.service.updateCodebase();
		assert.deepStrictEqual([f.service.codeUpdateState?.phase, f.codeUpdateRequests.length], ['unavailable', 1]);
	});

	test('saving offers an action without opening the code workflow or sending a request', async () => {
		const f = fixture();
		const previous = structuredClone(f.project.model);
		f.project.model.semantics.elements[0].description = 'Validate checkout quantity';
		f.saveCodeUpdate(previous);
		assert.deepStrictEqual([f.codeUpdateNotifications.length, f.service.codeUpdateState, f.codeUpdateRequests.length, f.dialogs.length], [1, undefined, 0, 0]);
	});

	test('stopping an update keeps the saved changes available for another attempt', async () => {
		const f = fixture();
		const previous = structuredClone(f.project.model);
		f.project.model.semantics.elements[0].description = 'Validate checkout quantity';
		f.saveCodeUpdate(previous);
		await f.service.updateCodebase();
		const running = new DeferredPromise<void>();
		f.onCodeUpdate(async token => {
			const cancelled = new DeferredPromise<void>();
			const listener = token.onCancellationRequested(() => { void cancelled.complete(); });
			try { await running.complete(); await cancelled.p; }
			finally { listener.dispose(); }
			throw new Error('Stopped');
		});
		const update = f.service.startCodeUpdate();
		await running.p;
		f.service.stopCodeUpdate();
		await update;
		assert.equal(f.service.codeUpdateState?.phase, 'cancelled');
		f.onCodeUpdate(undefined);
		await f.service.startCodeUpdate();
		assert.deepStrictEqual([f.service.codeUpdateState?.phase, f.codeUpdateRequests.length], ['completed', 2]);
	});

	test('an unsaved semantic change invalidates a prepared scope before dispatch', async () => {
		const f = fixture();
		const previous = structuredClone(f.project.model);
		f.project.model.semantics.elements[0].description = 'Validate checkout quantity';
		f.saveCodeUpdate(previous);
		await f.service.updateCodebase();
		f.project.model.semantics.elements[0].description = 'A newer rule';
		f.projectChanged.fire();
		await f.service.startCodeUpdate();
		assert.deepStrictEqual([f.service.codeUpdateState?.phase, f.codeUpdateRequests.length], ['unavailable', 0]);
	});

	test('provider questions keep the delta pending until an implementation or a confirmed no-op', async () => {
		const f = fixture();
		const previous = structuredClone(f.project.model);
		f.project.model.semantics.elements[0].description = 'Validate checkout quantity';
		f.saveCodeUpdate(previous);
		await f.service.updateCodebase();
		f.onCodeUpdate(async () => ({ outcome: 'needs-input', text: 'What is the maximum quantity?' }));
		await f.service.startCodeUpdate();
		assert.deepStrictEqual([f.service.codeUpdateState?.phase, f.service.codeUpdateState?.summary], ['failed', 'What is the maximum quantity?']);

		f.onCodeUpdate(async () => ({ outcome: 'already-aligned', text: 'The existing code already implements the rule.' }));
		await f.service.startCodeUpdate();
		f.service.closeCodeUpdate();
		await f.service.updateCodebase();
		assert.deepStrictEqual([f.service.codeUpdateState?.phase, f.codeUpdateRequests.length], ['unavailable', 2]);
	});

	test('updating waits for the current project codebase and canceling setup never opens the assistant', async () => {
		const f = fixture(); f.enableIncremental();
		const prepared = new DeferredPromise<boolean>(); f.holdProjectContext(prepared.p);
		const pending = f.service.updateDiagrams();
		assert.deepStrictEqual([f.dialogs.length, f.requests], [0, []]);
		await prepared.complete(false); await pending;
		assert.deepStrictEqual([f.dialogs.length, f.requests], [0, []]);
	});

	for (const native of [false, true]) {
		test(`${native ? 'native' : 'CLI'} diagram update pre-fills an editable prompt without sending or leaking it into the next chat`, async () => {
			const f = fixture(); f.prepareExploratoryDraft();
			if (native) { f.publishAccount({ status: 'signedIn' }); f.setups.push({ agent: 'codex', download: 'ready' }); }
			await f.service.buildDiagrams(); await f.service.reviewDiagramProposal('draft-review'); await f.service.applyDiagramReview();
			await f.service.updateDiagrams();
			const prompt = native ? f.chatPrompts.at(-1) : f.dialogs.at(-1)!.prompt;
			assert.ok(prompt); assert.ok(prompt.startsWith('Update the project diagrams from the current codebase using the Specsplice tools.'));
			for (const intent of ['preserve existing diagram and object IDs', 'manual layout', 'single complete project review', 'Do not publish changes']) { assert.ok(prompt.includes(intent), intent); }
			assert.deepStrictEqual([f.requests.includes('diagramChat'), f.errors], [false, []], 'prefilling never submits a model request');
			await f.service.returnToDiagrams(); await f.service.chat();
			assert.equal(native ? f.chatPrompts.at(-1) : f.dialogs.at(-1)!.prompt, '', 'ordinary chat remains independent after the dialog closes');
		});
	}

	test('declining a reviewed diagram preserves both the draft and its decision surface', async () => {
		const f = fixture(); f.prepareExploratoryDraft(); f.publishAccount({ status: 'signedIn' }); f.setups.push({ agent: 'codex', download: 'ready' });
		await f.service.buildDiagrams(); f.setConfirmed(false); await f.service.reviewDiagramProposal('draft-review'); await f.service.applyDiagramReview();
		assert.deepStrictEqual([f.explorationActions, f.opened.length, f.service.diagramReview?.id, f.service.diagramExploration?.proposals[0].status], [['open', 'open', 'ordito_view_preview'], 0, 'draft-review', 'ready']);
	});

	test('a changed model blocks application of a previously reviewed diagram', async () => {
		const f = fixture(); f.prepareExploratoryDraft(); f.publishAccount({ status: 'signedIn' }); f.setups.push({ agent: 'codex', download: 'ready' });
		await f.service.buildDiagrams(); await f.service.reviewDiagramProposal('draft-review');
		f.project.model.name = 'Changed after review';
		await f.service.applyDiagramReview();
		assert.deepStrictEqual([f.opened.length, f.explorationActions.includes('publish'), !!f.service.diagramReview?.problem, f.errors], [0, false, true, []]);
	});

	test('an invalid imported draft remains readable but cannot publish through the service', async () => {
		const f = fixture(); f.prepareExploratoryDraft('invalid'); f.publishAccount({ status: 'signedIn' }); f.setups.push({ agent: 'codex', download: 'ready' });
		await f.service.buildDiagrams(); await f.service.reviewDiagramProposal('draft-review'); await f.service.applyDiagramReview();
		assert.deepStrictEqual([f.service.diagramReview?.proposal.status, f.service.diagramReview?.changes[0].after?.name, f.opened.length, f.explorationActions.includes('publish')], ['invalid', 'Reviewed responsibility', 0, false]);
	});

	test('closing a draft review makes a stale apply action harmless', async () => {
		const f = fixture(); f.prepareExploratoryDraft(); f.publishAccount({ status: 'signedIn' }); f.setups.push({ agent: 'codex', download: 'ready' });
		await f.service.buildDiagrams(); await f.service.reviewDiagramProposal('draft-review'); f.service.closeDiagramReview(); await f.service.applyDiagramReview();
		assert.deepStrictEqual([f.service.diagramReview, f.opened.length, f.explorationActions.includes('publish')], [undefined, 0, false]);
	});

});
