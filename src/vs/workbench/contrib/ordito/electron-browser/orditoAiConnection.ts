import { orditoErrorNotification } from '../browser/orditoErrors.js';
import { localize } from '../../../../nls.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IConfigurationService, ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceTrustRequestService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IAgentHostService, AgentHostCodexAgentEnabledSettingId, AgentHostClaudeAgentEnabledSettingId, AgentHostCodexAgentCodexHomeSettingId, CodexPreferAgentHostEditorSettingId } from '../../../../platform/agentHost/common/agentService.js';
import { ICodexAccountService } from '../../../services/agentHost/browser/codexAccountService.js';
import { parseCodexModelSelection } from '../../../../platform/agentHost/common/codexModelSelection.js';
import { readAgentModelPricingMeta } from '../../../../platform/agentHost/common/meta/agentModelMeta.js';
import { IAgentSdkSetupService } from '../../../services/agentHost/browser/agentSdkSetupService.js';
import { ITerminalService, ITerminalGroupService } from '../../terminal/browser/terminal.js';
import { IOrditoAiDialogService } from '../browser/orditoAiDialog.js';
import { getNewChatSessionResource } from '../../chat/common/model/chatUri.js';
import { IOrditoProjectService } from '../browser/orditoProjectService.js';
import { IOrditoCodeService } from '../browser/orditoCodeService.js';
import { openOrditoTerminal } from '../browser/orditoTerminal.js';
import { type CliConfig, type ModelRates, type ModelBenchmark, type OrditoAiProject, type OrditoAiWorkflow } from './orditoAiTypes.js';

/** Original provider account, executable and model configuration; lifecycle belongs to this component. */
export class OrditoAiConnection extends Disposable {
	private readonly loginWatch = this._register(new DisposableStore());

	private _connectionStatus: string | undefined;

	private accountGeneration = 0;

	get connectionStatus(): string { return this._connectionStatus ?? localize('ordito.ai.unchecked', "CLI Account Not Checked Yet"); }

	private _config: CliConfig | undefined;
	get requestStatus(): string {
		return !this._config ? localize('ordito.ai.requestsUnconfigured', "AI Requests Are Not Configured") : !this._config.maxCalls ? localize('ordito.ai.requestsDisabled', "AI Requests Disabled · Context Preparation Only") : localize('ordito.ai.requestsEnabled', "AI Requests Enabled · Agent Run Budget: {0}", this._config.maxCalls);
	}

	private requestBudgets() {
		return [
			{ label: localize('ordito.ai.budgetTwo', "Plan and Implementation"), detail: localize('ordito.ai.budgetTwo.detail', "Up to 2 Agent Runs"), maxCalls: 2 },
			{ label: localize('ordito.ai.budgetOne', "Plan or Reconciliation"), detail: localize('ordito.ai.budgetOne.detail', "Up to 1 Agent Run"), maxCalls: 1 },
			{ label: localize('ordito.ai.budgetZero', "Prepare Context Only"), detail: localize('ordito.ai.budgetZero.detail', "No AI Requests"), maxCalls: 0 }
		];
	}

	async configureRequestBudget(): Promise<void> {
		if (this.host.busy || this.configuration.getValue<boolean>('chat.disableAIFeatures') === true) { this.notifications.info(localize('ordito.ai.connectionBlocked', "AI Setup Is Unavailable While an Operation Is Running or AI Features Are Disabled.")); return; }
		if (!await this.ensureConfigured()) { return; }
		const choices = this.requestBudgets();
		const budget = await this.quick.pick(choices, { title: localize('ordito.ai.budget', "Agent Run Budget · Provider Usage Is Managed by Its CLI"), activeItem: choices.find(choice => choice.maxCalls === this._config!.maxCalls) });
		if (!budget) { return; }
		this.configure({ ...this._config!, maxCalls: budget.maxCalls });
		this.host.changed();
	}


	async ensureConfigured(): Promise<boolean> {
		if (!this._config) { this.host.info(localize('ordito.ai.configurationNeeded', "Choose an AI Model, CLI and Budget to Continue. An Existing CLI Login Does Not Need to Be Repeated.")); await this.connect(); }
		return !!this._config;
	}

	async checkAccount(provider: CliConfig['provider'], executable: string): Promise<boolean> {
		const generation = ++this.accountGeneration;
		this.setConnectionStatus(localize('ordito.ai.checkingAccount', "Checking the Original CLI Account…"));
		try {
			const state = await this.code.checkCliAccount(provider, executable);
			if (generation !== this.accountGeneration) { return false; }
			if (state.status === 'signedIn') {
				this.setConnectionStatus(localize('ordito.ai.cliConnected', "{0} CLI Account Connected · {1}", provider === 'codex' ? 'Codex' : 'Claude Code', this._config?.provider === provider ? this._config!.model : localize('ordito.ai.chooseModelNext', "Choose a Model to Continue")));
				return true;
			}
			if (state.reason === 'notFound') { await this.resolveCli(provider); return false; }
			const message = state.status === 'signedOut'
				? localize('ordito.ai.cliSignedOut', "{0} CLI Requires Sign-In. Choose Sign In with CLI, Then Refresh Account and Models.", provider === 'codex' ? 'Codex' : 'Claude Code')
				: localize('ordito.ai.cliCheckFailed', "Could Not Verify the CLI Account ({0}). Open the AI CLI to Inspect Login, CLI Version and Configuration; Then Refresh Account and Models.", state.reason ?? 'failed');
			this.setConnectionStatus(message); this.notifications.info(message);
			return false;
		} catch (error) { const message = localize('ordito.ai.accountCheckError', "CLI Account Check Failed: {0}", error instanceof Error ? error.message : String(error)); this.setConnectionStatus(message); this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model)); return false; }
	}

	async refreshConnection(): Promise<void> {
		if (this.configuration.getValue<boolean>('chat.disableAIFeatures') === true) { return; }
		if (this.host.busy) { this.notifications.info(localize('ordito.operationWait', "Wait for the Active Specsplice Operation to Finish.")); return; }
		if (!this._config) { this.setConnectionStatus(localize('ordito.ai.configureConnection', "Connect an Original AI CLI and Choose a Model. Its Existing Login Will Be Checked.")); return; }
		const provider = this._config?.provider ?? 'codex';
		await this.checkAccount(provider, this._config?.executable ?? provider);
	}

	async readyConfig(): Promise<CliConfig | undefined> {
		if (!await this.ensureConfigured()) { return undefined; }
		if (this._config!.maxCalls === 0) { return { ...this._config! }; }
		const executable = await this.resolveCli(this._config!.provider);
		if (!executable || !await this.checkAccount(this._config!.provider, executable)) { return undefined; }
		return { ...this._config!, executable };
	}

	nativeModels(provider: CliConfig['provider']): { label: string; id: string; rates?: ModelRates }[] {
		if (provider === 'codex' && (this.configuration.getValue<string>(AgentHostCodexAgentCodexHomeSettingId) || this._config?.provider === provider && this._config.executable !== 'codex')) { return []; }
		const root = this.agents.rootState.value;
		const models = root && !(root instanceof Error) ? root.agents.find(agent => agent.provider === provider)?.models ?? [] : [];
		return models.flatMap(model => {
			const native = provider === 'codex' ? parseCodexModelSelection({ id: model.id }) : undefined;
			if (provider === 'codex' ? native?.modelProvider !== 'openai' : model.provider !== 'anthropic') { return []; }
			const price = readAgentModelPricingMeta(model);
			const rates = typeof price.inputCost === 'number' && typeof price.outputCost === 'number' && [price.inputCost, price.outputCost].every(value => Number.isFinite(value) && value >= 0)
				? { input: price.inputCost, output: price.outputCost, unit: 'account-credits', source: 'Agent Host native account catalog', asOf: new Date().toISOString() } : undefined;
			return [{ label: model.name, id: native?.modelId ?? model.id, rates }];
		});
	}

	private setConnectionStatus(message: string): void {
		this._connectionStatus = message;
		this.host.activityStatus = undefined;
		this.host.changed();
	}

	async chooseCliExecutable(provider: CliConfig['provider'], value: string, model?: string): Promise<string | undefined> {
		const hint = localize('ordito.ai.executableHint', "Enter the CLI program name ({0}) or its absolute path, not a model ID. The selected model ({1}) is configured separately.", provider, model ?? localize('ordito.ai.modelNext', "chosen separately"));
		const validate = async (input: string): Promise<string | undefined> => {
			try { if (input.trim() && await this.code.resolveCli(input.trim())) { return undefined; } } catch { /* Show a field error without persisting an unusable command. */ }
			return localize('ordito.ai.invalidExecutable', "Executable not found. Enter {0} or the full path to the installed CLI. A model ID belongs in the Model field.", provider);
		};
		const executable = await this.quick.input({ title: localize('ordito.ai.executable', "Original CLI Executable"), value, prompt: hint, validateInput: validate, ignoreFocusLost: true, showConfirmButton: true });
		if (!executable) { return undefined; }
		const error = await validate(executable);
		if (error) { this.setConnectionStatus(error); this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model)); return undefined; }
		return executable.trim();
	}

	async resolveCli(provider: CliConfig['provider']): Promise<string | undefined> {
		const executable = this._config?.provider === provider ? this._config.executable : provider;
		const resolved = await this.code.resolveCli(executable);
		if (!resolved && executable !== provider && this._config?.provider === provider) {
			const installed = await this.code.resolveCli(provider);
			if (installed) {
				const choice = await this.quick.pick([
					{ label: localize('ordito.ai.useInstalledCli', "Use Installed {0} CLI", provider === 'codex' ? 'Codex' : 'Claude Code'), description: installed, id: 'installed' },
					{ label: localize('ordito.ai.chooseExecutable', "Choose Executable Path"), id: 'choose' }
				], { title: localize('ordito.ai.repairExecutable', "Repair CLI Executable"), placeHolder: localize('ordito.ai.executableMismatch', "Cannot find program {0}. The executable and model ({1}) are separate settings.", executable, this._config.model) });
				const replacement = choice?.id === 'installed' ? provider : choice?.id === 'choose' ? await this.chooseCliExecutable(provider, executable, this._config.model) : undefined;
				if (!replacement) { this.setConnectionStatus(localize('ordito.ai.executableUnchanged', "CLI Configuration Unchanged. Choose an Installed Executable to Continue.")); return undefined; }
				this._config = { ...this._config, executable: replacement };
				this.storage.store('ordito.ai.cliConfig', JSON.stringify(this._config), StorageScope.PROFILE, StorageTarget.MACHINE);
				this.setConnectionStatus(localize('ordito.ai.executableRepaired', "CLI Executable Updated · Model Kept: {0}", this._config.model));
				return this.code.resolveCli(replacement);
			}
		}
		if (!resolved) {
			const installation = provider === 'codex'
				? localize('ordito.ai.installCodex', "Install the official CLI in a terminal with: npm install -g @openai/codex.")
				: localize('ordito.ai.installClaude', "Install the official Claude Code CLI using https://code.claude.com/docs/en/setup.");
			const message = localize('ordito.ai.cliMissing', "Cannot find or execute {0}: {1}. {2} If it is already installed, use Choose Model and CLI to set its absolute executable path. On macOS/Linux, run command -v {3} in your terminal to find it, then retry Sign In.", provider === 'codex' ? 'Codex' : 'Claude Code', executable, installation, provider);
			this.setConnectionStatus(message);
			this.notifications.error(orditoErrorNotification(message, 'ai', this.project.model));
		}
		return resolved;
	}

	private nativeSignIn(): void {
		const finish = (message: string, error = false) => {
			this.loginWatch.clear();
			this.setConnectionStatus(message);
			if (error) { this.notifications.error(orditoErrorNotification(message, 'ai', this.project.model)); } else { this.notifications.info(message); }
		};
		if (this.codexAccount.account.status === 'signedIn') {
			finish(localize('ordito.ai.alreadySignedIn', "Codex is already signed in to ChatGPT. Choose Model and CLI to continue."));
			return;
		}
		const waiting = localize('ordito.ai.nativeLoginStarting', "Starting Codex sign-in. Waiting for the ChatGPT authorization page…");
		this.setConnectionStatus(waiting);
		this.notifications.info(waiting);
		const timeout = this.loginWatch.add(new RunOnceScheduler(() => finish(localize('ordito.ai.nativeLoginTimeout', "Codex did not provide a sign-in page. Choose Sign In with CLI to open codex login in the terminal, or Refresh Account and Models to retry the native connection."), true), 15000));
		let browserRequested = false;
		this.loginWatch.add(this.codexAccount.onDidChangeAccount(account => {
			if (account.status === 'signedIn') {
				finish(localize('ordito.ai.signedIn', "Codex is signed in to ChatGPT. Choose Model and CLI to continue."));
			} else if (account.status === 'error' || account.status === 'unavailable') {
				finish(localize('ordito.ai.nativeLoginFailed', "Native Codex sign-in failed. Choose Sign In with CLI to run codex login and see the provider's output in the terminal."), true);
			} else if (account.authUrl && !browserRequested) {
				browserRequested = true;
				timeout.cancel();
				const message = localize('ordito.ai.nativeLoginBrowser', "Complete Codex sign-in in your browser. If no browser opens, choose Sign In with CLI to use the terminal instead.");
				this.setConnectionStatus(message);
				this.notifications.info(message);
			} else if (account.status === 'downloading') {
				this.setConnectionStatus(localize('ordito.ai.nativeLoginDownload', "Downloading the Codex agent for sign-in… You can also choose Sign In with CLI."));
			}
		}));
		timeout.schedule();
		this.codexAccount.signIn();
	}

	async signIn(provider: CliConfig['provider'], useCli: boolean): Promise<void> {
		this.loginWatch.clear();
		try {
			this.setConnectionStatus(localize('ordito.ai.checkingCli', "Checking the {0} CLI…", provider === 'codex' ? 'Codex' : 'Claude Code'));
			const executable = await this.resolveCli(provider);
			if (!executable) { return; }
			const nativeCodexLogin = !useCli && provider === 'codex' && !this.configuration.getValue<string>(AgentHostCodexAgentCodexHomeSettingId) && (!this._config || this._config!.provider !== 'codex' || this._config.executable === 'codex') && this.setup.setups.some(setup => setup.agent === 'codex' && setup.download === 'ready');
			if (nativeCodexLogin) { this.nativeSignIn(); return; }
			let exited = false;
			await openOrditoTerminal(this.terminals, this.terminalGroups, { name: provider === 'codex' ? 'Codex Login' : 'Claude Code', executable, args: provider === 'codex' ? ['login'] : ['auth', 'login'], cwd: this.code.context?.sourceRoot ?? this.project.projectRoot, ...(this.configuration.getValue<string>(AgentHostCodexAgentCodexHomeSettingId) ? { env: { CODEX_HOME: this.configuration.getValue<string>(AgentHostCodexAgentCodexHomeSettingId) } } : {}) }, terminal => { this.loginWatch.add(terminal.onExit(() => { exited = true; void this.checkAccount(provider, executable); })); });
			if (exited) { return; }
			const message = localize('ordito.ai.terminalLogin', "Complete {0} sign-in in the integrated terminal, then choose Refresh Account and Models.", provider === 'codex' ? 'Codex' : 'Claude Code');
			this.setConnectionStatus(message);
			this.notifications.info(message);
		} catch (error) {
			this.loginWatch.clear();
			const message = localize('ordito.ai.connectionError', "Could not start {0}: {1}. Check the CLI executable in Choose Model and CLI.", provider === 'codex' ? 'Codex' : 'Claude Code', error instanceof Error ? error.message : String(error));
			this.setConnectionStatus(message);
			this.notifications.error(orditoErrorNotification(message, 'ai', this.project.model));
		}
	}

	async connect(): Promise<void> {
		if (this.host.busy || this.configuration.getValue<boolean>('chat.disableAIFeatures') === true) { this.notifications.info(localize('ordito.ai.connectionBlocked', "AI Setup Is Unavailable While an Operation Is Running or AI Features Are Disabled.")); return; }
		const selected = await this.quick.pick([{ label: 'Codex', provider: 'codex' as const }, { label: 'Claude Code', provider: 'claude' as const }], { title: localize('ordito.ai.provider', "Choose AI CLI") });
		if (!selected) { return; }
		const provider = selected.provider;
		const connected = await this.checkAccount(provider, this._config?.provider === provider ? this._config.executable : provider);
		await this.configuration.updateValue(provider === 'codex' ? AgentHostCodexAgentEnabledSettingId : AgentHostClaudeAgentEnabledSettingId, true, ConfigurationTarget.USER);
		if (provider === 'codex') { await this.configuration.updateValue(CodexPreferAgentHostEditorSettingId, true, ConfigurationTarget.USER); }
		const action = await this.quick.pick([
			{ label: localize('ordito.ai.configure', "Choose Model and CLI"), description: connected ? localize('ordito.ai.configure.connected', "CLI Account Already Connected · No New Login Required") : localize('ordito.ai.configure.executable', "Select the Original CLI Executable, Model and Budget"), id: 'configure' },
			{ label: localize('ordito.ai.login', "Sign In"), id: 'login' },
			...(provider === 'codex' ? [{ label: localize('ordito.ai.cliLogin', "Sign In with CLI"), id: 'cliLogin' }] : []),
			{ label: localize('ordito.ai.nativeChat', "Open Native Agent Chat"), id: 'chat' },
			{ label: localize('ordito.ai.reload', "Refresh Account and Models"), id: 'reload' }
		], { title: selected.label });
		if (!action) { this.host.info(localize('ordito.ai.setupCancelled', "AI Setup Cancelled. The Existing CLI Account Is Unchanged.")); return; }
		if (action.id === 'login' || action.id === 'cliLogin') {
			await this.signIn(provider, action.id === 'cliLogin');
			return;
		}
		if (action.id === 'reload') { this.setup.requestReload(provider); await this.checkAccount(provider, this._config?.provider === provider ? this._config.executable : provider); return; }
		if (action.id === 'chat') { await this.aiDialog.open({ resource: getNewChatSessionResource('agent-host-' + provider), onClose: async () => this.host.changed() }); return; }
		const choices = this.nativeModels(provider);
		let preferred: string | null = null;
		try {
			for (const [key, kind] of [['ordito.ai.benchmark', 'live-provider-benchmark']]) {
				const measured: ModelBenchmark = JSON.parse(this.storage.get(key, StorageScope.PROFILE) ?? '{}');
				const result = measured.models?.find(model => model.candidate.config.provider === provider && model.candidate.config.model === measured.defaultModel);
				const current = choices.find(model => model.id === measured.defaultModel);
				if (measured.kind === kind && result?.eligible && current?.rates && result.candidate.rates?.input === current.rates.input && result.candidate.rates.output === current.rates.output && result.candidate.rates.unit === current.rates.unit && Date.now() - Date.parse(measured.recordedAt) < 30 * 86400000) { preferred = measured.defaultModel; break; }
			}
		} catch { /* no measured account default */ }
		choices.sort((left, right) => Number(right.id === preferred) - Number(left.id === preferred));
		const manual = { label: localize('ordito.ai.enterExactModelId', "Enter Exact Model ID"), id: undefined };
		const selection = choices.length ? await this.quick.pick([...choices, manual], { title: localize('ordito.ai.model', "Choose a Model Available to Your Account") }) : manual;
		const model = selection === manual
			? (await this.quick.input({ title: localize('ordito.ai.modelManual', "Model ID from Your CLI"), value: this._config?.provider === provider ? this._config.model : undefined, prompt: localize('ordito.ai.exactModelIdHelp', "Enter the exact model ID accepted by your signed-in CLI. The provider checks access when you send a request."), ignoreFocusLost: true, showConfirmButton: true }))?.trim()
			: selection?.id;
		if (!model) { this.host.info(localize('ordito.ai.noModel', "No Model Selected. Choose Model and CLI Before Implementing a Feature.")); return; }
		const executable = await this.chooseCliExecutable(provider, this._config?.provider === provider ? this._config.executable : provider, model);
		if (!executable) { return; }
		const budgets = this.requestBudgets();
		const budget = await this.quick.pick(budgets, { title: localize('ordito.ai.budget', "Agent Run Budget · Provider Usage Is Managed by Its CLI"), activeItem: budgets.find(choice => choice.maxCalls === this._config?.maxCalls) });
		if (!budget) { this.host.info(localize('ordito.ai.noBudget', "No Budget Selected. AI Configuration Was Not Saved.")); return; }
		this._config = { version: 1, provider, connection: 'cli', model, executable, timeoutMs: 180000, maxContextBytes: 262144, maxCalls: budget.maxCalls };
		this.loginWatch.clear(); this.accountGeneration++;
		this._connectionStatus = undefined;
		this.host.info(localize('ordito.ai.configured', "AI Settings Saved. Build Diagrams or Update Code to Continue."));
		this.storage.store('ordito.ai.cliConfig', JSON.stringify(this._config), StorageScope.PROFILE, StorageTarget.MACHINE);
		this.host.changed();
	}

	async openCli(): Promise<void> {
		if (this.host.busy) { this.notifications.info(localize('ordito.operationWait', "Wait for the Active Specsplice Operation to Finish.")); return; }
		if (!await this.ensureConfigured()) { return; }
		if (this.configuration.getValue<boolean>('chat.disableAIFeatures') === true || !await this.trust.requestWorkspaceTrust()) { this.host.info(localize('ordito.ai.cliBlocked', "Opening the AI CLI Requires Enabled AI Features and Workspace Trust.")); return; }
		const staged = this.host.reviewSession && ['staged', 'passed', 'failed'].includes(this.host.reviewSession.status) ? this.host.reviewSession.worktree : undefined;
		try {
			const executable = await this.resolveCli(this._config!.provider);
			if (!executable) { return; }
			await openOrditoTerminal(this.terminals, this.terminalGroups, { name: staged ? localize('ordito.ai.worktreeTerminal', "AI Review Worktree") : this._config!.provider === 'codex' ? 'Codex' : 'Claude Code', executable, args: ['--model', this._config!.model], cwd: staged ?? this.code.context?.sourceRoot ?? this.project.projectRoot, ...(this.configuration.getValue<string>(AgentHostCodexAgentCodexHomeSettingId) ? { env: { CODEX_HOME: this.configuration.getValue<string>(AgentHostCodexAgentCodexHomeSettingId) } } : {}) });
			this.host.info(localize('ordito.ai.cliOpened', "AI CLI Opened in the Integrated Terminal · {0}", staged ?? this.code.context?.sourceRoot ?? this.project.projectRoot?.fsPath ?? localize('ordito.ai.workspaceDirectory', "Current Workspace")));
		} catch (error) {
			this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model));
		}
	}

	constructor(
		private readonly host: Pick<OrditoAiWorkflow, 'info' | 'busy' | 'activityStatus' | 'changed' | 'reviewSession'>,
		@IOrditoProjectService private readonly project: OrditoAiProject,
		@IOrditoCodeService private readonly code: IOrditoCodeService,
		@IQuickInputService private readonly quick: IQuickInputService,
		@INotificationService private readonly notifications: INotificationService,
		@ITerminalService private readonly terminals: ITerminalService,
		@ITerminalGroupService private readonly terminalGroups: ITerminalGroupService,
		@IOrditoAiDialogService private readonly aiDialog: IOrditoAiDialogService,
		@ICodexAccountService private readonly codexAccount: ICodexAccountService,
		@IAgentSdkSetupService private readonly setup: IAgentSdkSetupService,
		@IAgentHostService private readonly agents: IAgentHostService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IStorageService private readonly storage: IStorageService,
		@IWorkspaceTrustRequestService private readonly trust: IWorkspaceTrustRequestService
	) {
		super();
		const saved = this.storage.get('ordito.ai.cliConfig', StorageScope.PROFILE);
		if (saved) { try { this._config = JSON.parse(saved); } catch { /* Choose a connection again. */ } }
	}
	configure(config: CliConfig): void {
		this._config = config;
		this.storage.store('ordito.ai.cliConfig', JSON.stringify(config), StorageScope.PROFILE, StorageTarget.MACHINE);
	}

	get config(): CliConfig | undefined { return this._config; }
	get status(): string { return this._connectionStatus ?? (this._config ? localize('ordito.ai.selected', "{0} · {1}", this._config.provider === 'codex' ? 'Codex' : 'Claude Code', this._config.model) : localize('ordito.ai.setup', "Choose an AI Model in AI Settings")); }
}
