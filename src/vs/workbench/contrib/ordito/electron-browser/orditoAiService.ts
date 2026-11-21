import { orditoErrorNotification } from '../browser/orditoErrors.js';
import './orditoAiDialogService.js';
import { type StructuralProjectSession as StructuralSession } from '../common/modelProject.js';
import { localize, localize2 } from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkspaceTrustRequestService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { OrditoInput } from '../browser/orditoInput.js';
import { IOrditoProjectService } from '../browser/orditoProjectService.js';
import { IOrditoCodeService } from '../browser/orditoCodeService.js';
import { IOrditoAiService, type OrditoDiagramReview } from '../browser/orditoAiService.js';
import { IOrditoOperationService, OrditoOperationService } from '../browser/orditoOperationService.js';
import { CodePreview, CodeResolution, CodeDiagramProgress, CodeDiagramExploration } from '../common/codeBridge.js';
import type { FeatureCodeGenerationRequest, FeatureCodeGenerationRun, FeatureCodeGenerationSetup } from '../common/featureCodeGeneration.js';
import { type OrditoAiWorkflow, type OrditoAiRunOptions, type OrditoAiProject } from './orditoAiTypes.js';
import { OrditoAiConnection } from './orditoAiConnection.js';
import { OrditoAiDiagrams } from './orditoAiDiagrams.js';
import { OrditoAiCodeUpdates } from './orditoAiCodeUpdates.js';
import { OrditoAiStructural } from './orditoAiStructural.js';
import { OrditoAiImplementation } from './orditoAiImplementation.js';
import { OrditoAiFeatureCode } from './orditoAiFeatureCode.js';

/** Coordinates independent Specsplice AI workflows through one native service boundary. */
export class OrditoAiService extends Disposable implements IOrditoAiService {
	declare readonly _serviceBrand: undefined;

	readonly available = true;

	private readonly changes = this._register(new Emitter<void>());

	readonly onDidChange = this.changes.event;

	busy = false;

	get diagramReview(): OrditoDiagramReview | undefined { return this.diagrams.diagramReview; }

	private activityStatus: string | undefined;
	private operationProgress: { report(step: { message: string }): void } | undefined;

	get generatingDiagrams(): boolean { return this.diagrams.generatingDiagrams; }

	get workflowStatus(): string | undefined { return this.activityStatus; }

	get chatLocation(): 'modal' | undefined { return this.diagrams.chatLocation; }

	get connectionStatus(): string { return this.connection.connectionStatus; }

	get requestStatus(): string { return this.connection.requestStatus; }

	async configureRequestBudget(): Promise<void> { return this.connection.configureRequestBudget(); }

	get diagramProgress(): CodeDiagramProgress | undefined { return this.diagrams.diagramProgress; }

	get diagramExploration(): CodeDiagramExploration | undefined { return this.diagrams.diagramExploration; }
	get diagramActivity() { return this.diagrams.diagramActivity; }
	get diagramLiveProgress() { return this.diagrams.diagramLiveProgress; }
	get diagramExplorationIssue(): string | undefined { return this.diagrams.diagramExplorationIssue; }
	get diagramClarification(): string | undefined { return this.diagrams.diagramClarification; }
	stopDiagramExploration(): void { this.diagrams.stopDiagramExploration(); }
	async clarifyDiagramExploration(): Promise<void> { return this.diagrams.clarifyDiagramExploration(); }

	get structuralProblem(): string | undefined { return this.structural.structuralProblem; }

	get structuralReview(): StructuralSession | undefined { return this.structural.structuralReview; }

	get continuityStatus(): string { return this.structural.continuityStatus; }

	async configureContinuity(): Promise<void> { return this.structural.configureContinuity(); }

	get status(): string { return this.structural.status ?? this.activityStatus ?? (this.implementation.session ? this.implementation.status : this.connection.status); }

	get canVerify(): boolean { return this.structural.canVerify || this.implementation.canVerify; }

	get canApply(): boolean { return this.structural.canApply || this.implementation.canApply; }

	get canUndo(): boolean { return this.structural.canUndo || this.implementation.canUndo; }

	private report(message: string): void { this.activityStatus = message; this.operationProgress?.report({ message }); this.changes.fire(); }

	private info(message: string): void { this.report(message); this.notifications.info(message); }

	private async request<T>(request: { operation: string;[key: string]: unknown }, token = CancellationToken.None): Promise<T> {
		const labels: Record<string, string> = {
			prepare: localize('ordito.ai.phase.prepare', "Preparing Feature Context"), plan: localize('ordito.ai.phase.plan', "Waiting for the Provider Plan"),
			interpret: localize('ordito.ai.phase.interpret', "Interpreting Evidence"), stage: localize('ordito.ai.phase.stage', "Generating Changes in the Worktree"),
			verify: localize('ordito.ai.phase.verify', "Running Reviewed Tests"), apply: localize('ordito.ai.phase.apply', "Applying Verified Changes"),
			undo: localize('ordito.ai.phase.undo', "Restoring Original Files"), session: localize('ordito.ai.phase.session', "Loading Saved Implementation"),
			recover: localize('ordito.ai.phase.recover', "Recovering Interrupted Implementation"), benchmark: localize('ordito.ai.phase.benchmark', "Comparing Models"),
			structuralPrepare: localize('ordito.pure.phase.prepare', "Preparing Model Behavior Review"), structuralVerify: localize('ordito.pure.phase.verify', "Verifying Model Behavior"),
			structuralApply: localize('ordito.pure.phase.apply', "Applying Reviewed Model Behavior"), structuralUndo: localize('ordito.pure.phase.undo', "Restoring Model and Code"),
			structuralSession: localize('ordito.pure.phase.session', "Loading Saved Review"), structuralRecover: localize('ordito.pure.phase.recover', "Recovering Local Publication"),
			featureImplementationInspect: localize('ordito.featureCode.phase.inspect', "Checking the Target and Available Profiles"),
			featureImplementationPrepare: localize('ordito.featureCode.phase.prepare', "Preparing Feature Contracts and Verification Cases"),
			featureImplementationStep: localize('ordito.featureCode.phase.step', "Preparing the Next Feature"),
			featureImplementationSession: localize('ordito.featureCode.phase.session', "Loading Saved Code Generation"),
			featureImplementationDiff: localize('ordito.featureCode.phase.diff', "Loading the Reviewed Changes"),
			featureImplementationVerify: localize('ordito.featureCode.phase.verify', "Running Independent Verification"),
			featureImplementationApply: localize('ordito.featureCode.phase.apply', "Applying Verified Code"),
			featureImplementationUndo: localize('ordito.featureCode.phase.undo', "Restoring Previous Code"),
			featureImplementationRecover: localize('ordito.featureCode.phase.recover', "Recovering Code Publication")
		};
		const label = labels[request.operation] ?? localize('ordito.ai.phase.request', "Running AI Operation");
		this.report(label);
		const result = JSON.parse(await this.code.executeCollaboration(JSON.stringify(request), token));
		this.report(localize('ordito.ai.phase.done', "{0} · Completed", label));
		return result;
	}

	private async run(task: (token: CancellationToken) => Promise<void>, options: OrditoAiRunOptions = {}): Promise<void> {
		const diagramJob = options.kind === 'diagram', local = options.kind === 'local', interactive = local && options.interactive, review = options.review;
		if (!local && this.configuration.getValue<boolean>('chat.disableAIFeatures') === true) { this.info(localize('ordito.ai.disabled', "AI Features Are Disabled in Settings.")); return; }
		const operation = this.operations.acquire('ai');
		if (this.busy || !operation) { operation?.dispose(); this.notifications.info(localize('ordito.ai.busy', "A Specsplice operation is already running. Wait for it to finish or cancel it before starting another.")); return; }
		if (diagramJob) { this.diagrams.beginGeneration(); }
		this.busy = true; this.report(interactive ? localize('ordito.local.editing', "Editing Local Values") : local ? localize('ordito.states.simulation.preparing', "Preparing Local Operation") : localize('ordito.ai.starting', "Preparing AI Operation"));
		const cancelled = () => local ? localize('ordito.states.simulation.cancelled', "Local Operation Cancelled") : diagramJob ? localize('ordito.ai.diagramCancelled', "Diagram Generation Paused · Completed Steps Can Be Resumed") : localize('ordito.ai.cancelled', "AI Operation Cancelled. Review Any Existing Worktree Before Continuing.");
		const cancellation = new CancellationTokenSource();
		try {
			if (!local && !await this.trust.requestWorkspaceTrust({ message: localize('ordito.ai.trust', "Specsplice runs the original AI CLI and reviewed project tests on this computer.") })) { this.info(localize('ordito.ai.untrusted', "AI Operation Cancelled · Workspace Trust Was Not Granted.")); return; }
			if (options.inline) {
				await task(cancellation.token);
			} else {
				await this.progress.withProgress({ location: interactive ? ProgressLocation.Window : ProgressLocation.Notification, title: local ? localize('ordito.states.simulation.progress', "Specsplice Local Operation") : localize('ordito.ai.progress', "Specsplice AI"), cancellable: true }, async progress => {
					this.operationProgress = progress;
					if (this.activityStatus) { progress.report({ message: this.activityStatus }); }
					try { await task(cancellation.token); } finally { this.operationProgress = undefined; }
				}, () => cancellation.cancel());
			}
			if (cancellation.token.isCancellationRequested) { this.info(cancelled()); }
		}
		catch (error) {
			const message = cancellation.token.isCancellationRequested ? cancelled() : local ? localize('ordito.local.error', "Specsplice Local Operation: {0}", error instanceof Error ? error.message : String(error)) : localize('ordito.ai.error', "Specsplice AI: {0}", error instanceof Error ? error.message : String(error));
			this.report(message); if (cancellation.token.isCancellationRequested) { if (!diagramJob) { this.notifications.info(message); } } else if (review && this.diagrams.diagramReview === review && review.problem) { /* The active review owns this recoverable error. */ } else if (diagramJob) { this.diagrams.failGeneration(error); } else { this.notifications.error(orditoErrorNotification(error, local ? 'validation' : 'ai', this.project.model)); }
		}
		finally { cancellation.dispose(); operation.dispose(); this.busy = false; this.diagrams.finishOperation(); this.changes.fire(); }
	}

	async refreshConnection(): Promise<void> { return this.connection.refreshConnection(); }

	async connect(): Promise<void> { return this.connection.connect(); }

	async openCli(): Promise<void> { return this.connection.openCli(); }

	async chat(): Promise<void> { return this.diagrams.chat(); }

	async returnToDiagrams(): Promise<void> { return this.diagrams.returnToDiagrams(); }

	async configureDiagramBudget(): Promise<void> { return this.diagrams.configureDiagramBudget(); }

	async configureDefaultDiagramBudget(): Promise<void> { return this.diagrams.configureDefaultDiagramBudget(); }

	async configureDiagramCheckpointTimeout(): Promise<void> { return this.diagrams.configureDiagramCheckpointTimeout(); }

	async reviewDiagramProposal(id?: string): Promise<void> { return this.diagrams.reviewDiagramProposal(id); }

	closeDiagramReview(): void { return this.diagrams.closeDiagramReview(); }

	async inspectDiagramReview(): Promise<void> { return this.diagrams.inspectDiagramReview(); }

	async applyDiagramReview(): Promise<void> { return this.diagrams.applyDiagramReview(); }

	async buildDiagrams(): Promise<void> { return this.diagrams.buildDiagrams(); }

	async resumeDiagrams(): Promise<void> { return this.diagrams.resumeDiagrams(); }

	async updateDiagrams(): Promise<void> { return this.diagrams.updateDiagrams(); }
	async updateCodebase(): Promise<void> { return this.codeUpdates.update(); }
	get codeUpdateState() { return this.codeUpdates.state; }
	async startCodeUpdate(): Promise<void> { await this.codeUpdates.start(); }
	stopCodeUpdate(): void { this.codeUpdates.stop(); }
	closeCodeUpdate(): void { this.codeUpdates.close(); }

	get codeGeneration(): FeatureCodeGenerationRun | undefined { return this.featureCode.run; }
	get codeGenerationProblem(): string | undefined { return this.featureCode.problem; }
	async inspectCodeGeneration(): Promise<FeatureCodeGenerationSetup | undefined> { return this.featureCode.inspect(); }
	async prepareCodeGeneration(request: FeatureCodeGenerationRequest): Promise<void> { return this.featureCode.prepare(request); }
	async resumeCodeGeneration(clarification?: string): Promise<void> { return this.featureCode.resume(clarification); }
	async cancelCodeGeneration(): Promise<void> { this.featureCode.cancel(); }
	async verifyCodeGeneration(): Promise<void> { return this.featureCode.action('featureImplementationVerify'); }
	async applyCodeGeneration(): Promise<void> { return this.featureCode.action('featureImplementationApply'); }
	async undoCodeGeneration(): Promise<void> { return this.featureCode.action('featureImplementationUndo'); }
	async recoverCodeGeneration(): Promise<void> { return this.featureCode.action('featureImplementationRecover'); }
	async openCodeGenerationDiff(file: string): Promise<void> { return this.featureCode.diff(file); }

	async chooseDiagramModel(): Promise<void> { return this.diagrams.chooseDiagramModel(); }

	async implement(): Promise<void> {
		if ((this.project.model.version === 4 || this.project.model.version === 5)) { await this.structural.preparePureProject('forward'); return; }
		this.structural.clear(); await this.implementation.collaborate('plan');
	}

	async structuralReverse(): Promise<void> { return this.structural.structuralReverse(); }

	async movePureSource(): Promise<void> { return this.structural.movePureSource(); }

	async structuralTechnicalReview(): Promise<void> { return this.structural.structuralTechnicalReview(); }

	async structuralResume(): Promise<void> { return this.structural.structuralResume(); }

	async structuralRecover(): Promise<void> { return this.structural.structuralRecover(); }

	async simulateStates(): Promise<void> { return this.structural.simulateStates(); }

	async editPureCriteria(): Promise<void> { return this.structural.editPureCriteria(); }

	async interpret(): Promise<void> { return this.implementation.interpret(); }

	async reconcile(preview: CodePreview, resolutions: CodeResolution[] = [], direction?: 'model' | 'code'): Promise<CodePreview | undefined> { return this.implementation.reconcile(preview, resolutions, direction); }

	async review(): Promise<void> { await this.run(async () => this.structural.structuralReview ? this.structural.reviewPureProject() : this.implementation.reviewCurrent()); }

	async verify(): Promise<void> {
		if (this.structural.structuralReview) { await this.structural.runPureAction('structuralVerify'); return; }
		await this.implementation.verify();
	}

	async apply(): Promise<void> { if (this.structural.structuralReview) { await this.structural.runPureAction('structuralApply'); return; } await this.implementation.changeSource(false); }

	async undo(): Promise<void> { if (this.structural.structuralReview) { await this.structural.runPureAction('structuralUndo'); return; } await this.implementation.changeSource(true); }

	async resume(): Promise<void> { return this.implementation.resume(); }

	async recover(): Promise<void> { return this.implementation.recover(); }

	async benchmark(): Promise<void> { return this.implementation.benchmark(); }

	async benchmarkReconciliation(): Promise<void> { return this.implementation.benchmarkReconciliation(); }

	async exportBenchmark(): Promise<void> { return this.implementation.exportBenchmark(); }

	private readonly connection: OrditoAiConnection;

	private readonly diagrams: OrditoAiDiagrams;
	private readonly codeUpdates: OrditoAiCodeUpdates;

	private readonly structural: OrditoAiStructural;

	private readonly implementation: OrditoAiImplementation;
	private readonly featureCode: OrditoAiFeatureCode;

	constructor(
		@IOrditoProjectService private readonly project: OrditoAiProject,
		@IOrditoCodeService private readonly code: IOrditoCodeService,
		@INotificationService private readonly notifications: INotificationService,
		@IProgressService private readonly progress: IProgressService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IWorkspaceTrustRequestService private readonly trust: IWorkspaceTrustRequestService,
		@IOrditoOperationService private readonly operations: OrditoOperationService,
		@IInstantiationService instantiation: IInstantiationService
	) {
		super();
		const self = this;
		const workflow: OrditoAiWorkflow = {
			get busy() { return self.busy; }, set busy(value) { self.busy = value; },
			get activityStatus() { return self.activityStatus; }, set activityStatus(value) { if (value === undefined) { self.activityStatus = undefined; } else { self.report(value); } },
			changed: () => this.changes.fire(), report: message => this.report(message), info: message => this.info(message),
			request: (request, token) => this.request(request, token), run: (task, options) => this.run(task, options),
			clearImplementation: () => { this.implementation.clear(); }, buildDiagrams: () => this.diagrams.buildDiagrams(),
			get reviewSession() { return self.implementation.session; }
		};
		this.connection = this._register(instantiation.createInstance(OrditoAiConnection, workflow));
		this.diagrams = this._register(instantiation.createInstance(OrditoAiDiagrams, workflow, this.connection));
		this.codeUpdates = this._register(instantiation.createInstance(OrditoAiCodeUpdates, workflow, this.connection));
		this.structural = this._register(instantiation.createInstance(OrditoAiStructural, workflow));
		this.implementation = this._register(instantiation.createInstance(OrditoAiImplementation, workflow, this.connection));
		this.featureCode = this._register(instantiation.createInstance(OrditoAiFeatureCode, workflow, this.connection));

		let projectId = project.model.id;
		this._register(project.onDidChange(() => {
			if (projectId !== project.model.id) { this.structural.resetProject(); this.diagrams.resetProject(); projectId = project.model.id; }
			this.featureCode.followProject();
			this.structural.updateContinuity();
			if (!this.busy) { this.activityStatus = undefined; this.changes.fire(); }
		}));
		this._register(code.onDidChange(() => {
			this.diagrams.followCodeContext();
			this.implementation.followCodeContext();
		}));
		this.diagrams.followCodeContext();
		this.featureCode.followProject();

	}
}

registerSingleton(IOrditoAiService, OrditoAiService, InstantiationType.Delayed);

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ordito.ai.reconcile', title: localize2('ordito.ai.reconcileCommand', "Specsplice: Propose Bidirectional Reconciliation"), f1: false }); }
	override run(accessor: ServicesAccessor, preview: CodePreview, resolutions?: CodeResolution[], direction?: 'model' | 'code'): Promise<CodePreview | undefined> { return accessor.get(IOrditoAiService).reconcile(preview, resolutions, direction); }
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ordito.ai.updateCodebase', title: localize2('ordito.ai.updateCodebaseCommand', "Specsplice: Update Codebase from Diagrams"), f1: true }); }
	override async run(accessor: ServicesAccessor): Promise<void> {
		const project = accessor.get(IOrditoProjectService), ai = accessor.get(IOrditoAiService), editors = accessor.get(IEditorService), notifications = accessor.get(INotificationService);
		try {
			await project.restore();
			await ai.updateCodebase();
			if (ai.codeUpdateState) { await editors.openEditor({ resource: OrditoInput.RESOURCE, options: { pinned: true, revealIfOpened: true } }); }
		} catch (error) { if (!isCancellationError(error)) { notifications.error(orditoErrorNotification(error, 'ai', project.model)); } }
	}
});

for (const [id, title, method] of [
	['ordito.ai.connect', localize2('ordito.ai.connectCommand', "Specsplice: Connect Claude Code or Codex"), 'connect'],
	['ordito.ai.cli', localize2('ordito.ai.cliCommand', "Specsplice: Open AI CLI"), 'openCli'],
	['ordito.ai.reviewDiagramProposal', localize2('ordito.explore.reviewCommand', "Specsplice: Review Diagram Draft"), 'reviewDiagramProposal'],
	['ordito.ai.configureDiagramBudget', localize2('ordito.explore.budgetCommand', "Specsplice: Configure Exploration Budget"), 'configureDiagramBudget'],
	['ordito.ai.configureRequestBudget', localize2('ordito.ai.requestBudgetCommand', "Specsplice: Configure AI Request Budget"), 'configureRequestBudget'],
	['ordito.ai.chooseDiagramModel', localize2('ordito.ai.diagramModelCommand', "Choose Diagram Model"), 'chooseDiagramModel'],
	['ordito.ai.returnToDiagrams', localize2('ordito.ai.returnToDiagramsCommand', "Specsplice: Back to Diagrams"), 'returnToDiagrams'],
	['ordito.ai.chat', localize2('ordito.ai.chatCommand', "Specsplice: Chat with Codex"), 'chat'],
	['ordito.ai.buildDiagrams', localize2('ordito.ai.buildDiagramsCommand', "Specsplice: Build Semantic Diagrams"), 'buildDiagrams'],
	['ordito.ai.resumeDiagrams', localize2('ordito.ai.resumeDiagramsCommand', "Specsplice: Resume Diagram Generation"), 'resumeDiagrams'],
	['ordito.ai.updateDiagrams', localize2('ordito.ai.updateDiagramsCommand', "Specsplice: Update Diagrams from Codebase"), 'updateDiagrams'],
	['ordito.ai.implement', localize2('ordito.ai.implementCommand', "Specsplice: Implement Feature"), 'implement'],
	['ordito.ai.interpret', localize2('ordito.ai.interpretCommand', "Specsplice: Interpret Unresolved Evidence"), 'interpret'],
	['ordito.ai.review', localize2('ordito.ai.reviewCommand', "Specsplice: Review Implementation"), 'review'],
	['ordito.ai.verify', localize2('ordito.ai.verifyCommand', "Specsplice: Verify Implementation"), 'verify'],
	['ordito.ai.apply', localize2('ordito.ai.applyCommand', "Specsplice: Apply Verified Implementation"), 'apply'],
	['ordito.ai.undo', localize2('ordito.ai.undoCommand', "Specsplice: Undo Implementation"), 'undo'],
	['ordito.ai.resume', localize2('ordito.ai.resumeCommand', "Specsplice: Resume Implementation"), 'resume'],
	['ordito.ai.recover', localize2('ordito.ai.recoverCommand', "Specsplice: Recover Interrupted Implementation"), 'recover'],
	['ordito.ai.configureContinuity', localize2('ordito.continuity.command', "Specsplice: Start or Stop Continuous Preparation"), 'configureContinuity'],
	['ordito.ai.structuralTechnicalReview', localize2('ordito.pure.technical.command', "Specsplice: Inspect Technical Review"), 'structuralTechnicalReview'],
	['ordito.ai.structuralReverse', localize2('ordito.pure.reverse.command', "Specsplice: Reverse Model Behavior from Code"), 'structuralReverse'],
	['ordito.ai.structuralResume', localize2('ordito.pure.resume.command', "Specsplice: Resume Model Behavior Review"), 'structuralResume'],
	['ordito.ai.structuralRecover', localize2('ordito.pure.recover.command', "Specsplice: Recover Model Behavior Publication"), 'structuralRecover'],
	['ordito.ai.simulateStates', localize2('ordito.states.simulation.command', "Specsplice: Simulate State Machine"), 'simulateStates'],
	['ordito.ai.editPureCriteria', localize2('ordito.pure.criteria.command', "Specsplice: Edit Independent Business Expectations"), 'editPureCriteria'],
	['ordito.ai.movePureSource', localize2('ordito.pure.move.command', "Specsplice: Move Model Behavior Source"), 'movePureSource'],
	['ordito.ai.benchmark', localize2('ordito.ai.benchmarkCommand', "Specsplice: Compare AI Models"), 'benchmark'],
	['ordito.ai.benchmarkReconciliation', localize2('ordito.ai.benchmarkReconciliationCommand', "Specsplice: Compare Reconciliation Models"), 'benchmarkReconciliation'],
	['ordito.ai.exportBenchmark', localize2('ordito.ai.exportBenchmarkCommand', "Specsplice: Export Model Benchmark Results"), 'exportBenchmark']
] as const) {
	registerAction2(class extends Action2 {
		constructor() { super({ id, title, f1: true }); }
		override async run(accessor: ServicesAccessor): Promise<void> {
			try { await accessor.get(IOrditoAiService)[method](); }
			catch (error) { if (!isCancellationError(error)) { accessor.get(INotificationService).error(orditoErrorNotification(error, 'ai', accessor.get(IOrditoProjectService).model)); } }
		}
	});
}
