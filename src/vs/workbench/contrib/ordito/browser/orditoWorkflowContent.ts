import { orditoErrorNotification, describeOrditoError } from './orditoErrors.js';
import { renderOrditoErrorNotice } from './orditoErrorNotice.js';
import { localize } from '../../../../nls.js';
import * as dom from '../../../../base/browser/dom.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { isSourceEvidenceModel } from '../common/modelFoundation.js';
import { IOrditoCodeService } from './orditoCodeService.js';
import { IOrditoAiService } from './orditoAiService.js';
import { OrditoProjectService } from './orditoProjectService.js';
import { OrditoControls } from './orditoControls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { viewLabels } from './orditoLabels.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { getDiagramExplorationPhase } from '../common/diagramExplorationState.js';
import { renderOrditoCodeActions } from './orditoCodeActions.js';
import { type OrditoFeatureCodeGeneration, hasFeatureCodeReview } from './orditoFeatureCodeGeneration.js';
import { assertPureProject } from '../common/modelProject.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { type ThemeIcon } from '../../../../base/common/themables.js';
import { OrditoActionMenu } from './orditoActionMenu.js';
import { OrditoCodebaseExploration } from './orditoCodebaseExploration.js';
import { diagramCheckpointTimeoutSetting, diagramExplorationBudgetSetting, getDiagramCheckpointTimeoutMinutes } from '../common/diagramExplorationSettings.js';
import { getProjectDiagramExplorationBudget } from '../common/diagramExplorationBudget.js';

interface OrditoWorkflowContentHost {
	paragraph(parent: HTMLElement, content: string): void;
	button(parent: HTMLElement, label: string, action: () => void, id?: string): HTMLButtonElement;
	documentStatus(): string;
	readonly root: HTMLElement;
	showReview(): void;
}

/** Renders AI workflow, settings and secondary tools for the Specsplice editor. */
export class OrditoWorkflowContent {
	private group(parent: HTMLElement, title: string, description?: string): HTMLElement {
		const section = dom.append(parent, dom.$('section.ordito-action-group'));
		dom.append(section, dom.$('h2')).textContent = title;
		if (description) { this.host.paragraph(section, description); }
		return dom.append(section, dom.$('div.ordito-action-list'));
	}

	renderAiSettings(parent: HTMLElement): void {
		dom.append(parent, dom.$('h1')).textContent = localize('ordito.ai.settings', "AI Settings");
		if (!this.ai.available || this.configurationService.getValue<boolean>('chat.disableAIFeatures') === true) {
			this.host.paragraph(parent, localize('ordito.ai.disabled', "AI Features Are Disabled in Settings.")); return;
		}
		const account = this.group(parent, localize('ordito.ai.account', "Account and Model"), this.ai.connectionStatus);
		for (const [label, action] of [
			[localize('ordito.ai.diagramModel', "Choose Diagram Model"), () => this.ai.chooseDiagramModel()],
			[localize('ordito.ai.connectButton', "Connect Claude Code or Codex"), () => this.ai.connect()],
			[localize('ordito.ai.refresh', "Refresh Account and Models"), () => this.ai.refreshConnection()]
		] as const) { this.host.button(account, label, () => action().catch(error => this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model)))).disabled = this.ai.busy || this.code.busy; }
		const requests = this.group(parent, localize('ordito.ai.requestSettings', "AI Requests"), this.ai.requestStatus);
		this.host.button(requests, localize('ordito.ai.requestBudget', "Configure AI Request Budget"), () => this.ai.configureRequestBudget().catch(error => this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model)))).disabled = this.ai.busy || this.code.busy;
		this.host.paragraph(requests, localize('ordito.ai.requestBudgetHint', "Changing This Budget Sends No Request. Project Exploration Has a Separate Budget."));
		const incremental = this.configurationService.getValue<boolean>('ordito.diagramImport.incremental') !== false;
		const minutes = getDiagramCheckpointTimeoutMinutes(this.configurationService.getValue(diagramCheckpointTimeoutSetting));
		const limit = minutes === 1 ? localize('ordito.diagram.attemptOneMinute', "1 minute per attempt") : localize('ordito.diagram.attemptMinutes', "{0} minutes per attempt", minutes);
		const budget = this.group(parent, localize('ordito.ai.generationSettings', "Diagram Generation"), incremental ? limit : localize('ordito.ai.generationSettingsHint', "Control How Much Source the Assistant Can Explore While Preparing Diagrams."));
		if (incremental) {
			const initial = getProjectDiagramExplorationBudget(this.configurationService.getValue(diagramExplorationBudgetSetting));
			const summary = dom.$('p');
			summary.textContent = localize('ordito.diagram.defaultBudgetSummary', "New explorations · {0} local tool calls · {1} KiB of tool response data · {2} min · {3} reported turns", initial.maxToolCalls, Math.ceil(initial.maxReadBytes / 1024), Math.ceil(initial.maxDurationMs / 60_000), initial.maxModelTurns);
			budget.before(summary);
			this.host.button(budget, localize('ordito.diagram.setDefaultBudget', "Set Default Exploration Budget"), () => this.ai.configureDefaultDiagramBudget().catch(error => this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model))), 'default-exploration-budget');
			this.host.button(budget, localize('ordito.diagram.setAttemptLimit', "Set Diagram Attempt Time Limit"), () => this.ai.configureDiagramCheckpointTimeout().catch(error => this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model))), 'diagram-attempt-time-limit');
		}
		this.host.button(budget, localize('ordito.explore.adjustBudget', "Add Exploration Budget"), () => this.ai.configureDiagramBudget().catch(error => this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model))), 'add-exploration-budget').disabled = this.ai.busy || this.code.busy || !this.ai.diagramExploration;
		const advanced = this.controls.details(parent, localize('ordito.ai.advancedSettings', "Advanced · Model Benchmarks"), 'ai-benchmarks');
		for (const [label, action] of [
			[localize('ordito.ai.benchmarkButton', "Compare AI Models"), () => this.ai.benchmark()],
			[localize('ordito.ai.reconciliationBenchmarkButton', "Compare Reconciliation Models"), () => this.ai.benchmarkReconciliation()],
			[localize('ordito.ai.exportButton', "Export Model Benchmark Results"), () => this.ai.exportBenchmark()]
		] as const) { this.host.button(advanced, label, () => action().catch(error => this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model)))).disabled = this.ai.busy || this.code.busy; }
	}

	renderWorkflow(parent: HTMLElement, surface: 'workspace' | 'history' | 'import' = 'workspace'): void {
		const history = surface === 'history', landing = surface === 'import';
		if (this.ai.structuralProblem) {
			const issue = dom.append(parent, dom.$('section.ordito-structural-review')); issue.setAttribute('role', 'alert');
			this.host.paragraph(issue, localize('ordito.review.resolve', "Model and Code Need Review Before Applying")); this.host.paragraph(issue, this.ai.structuralProblem);
			this.host.button(issue, localize('ordito.review.revise', "Review Specification and Constraints"), () => this.commandService.executeCommand('ordito.blueprint'));
			this.host.button(issue, localize('ordito.task.edit', "Tasks and Clarifications"), () => this.commandService.executeCommand('ordito.taskIntent'));
		}
		const enabled = this.ai.available && this.configurationService.getValue<boolean>('chat.disableAIFeatures') !== true;
		const exploration = this.ai.diagramExploration;
		const context = this.code.context;
		const view = new OrditoCodebaseExploration(this.controls, this.ai, this.code);
		if (context && enabled && this.configurationService.getValue<boolean>('ordito.diagramImport.incremental') !== false && (exploration || context.diagramState === 'index')) {
			if (history || getDiagramExplorationPhase(exploration) !== 'applied') { view.render(parent, exploration, landing); }
			return;
		}
		if (landing) {
			const panel = dom.append(parent, dom.$('section.ordito-explore'));
			view.renderHeader(panel);
			if (!context) {
				dom.append(panel, dom.$('p', { role: 'status' })).textContent = localize('ordito.import.readingEvidence', "Preparing source evidence…");
			} else if (!enabled) {
				dom.append(panel, dom.$('p')).textContent = localize('ordito.import.aiRequired', "Enable AI features to interpret the source into diagrams. The technical index stays available as code evidence.");
			}
		}
		if (!context || !enabled) { return; }
		const progress = this.ai.diagramProgress;
		const pending = progress && progress.status !== 'complete';
		if (context.diagramState === 'index' || pending) {
			const banner = dom.append(parent, dom.$('section.ordito-workflow'));
			banner.setAttribute('aria-label', localize('ordito.diagramImport', "Build Diagrams"));
			const active = !!pending && this.ai.generatingDiagrams;
			const started = !!pending && (progress.calls > 0 || progress.completed > 0 || progress.status === 'failed' || progress.status === 'questions');
			const nextDiagram = progress?.plan?.find(item => item.status !== 'complete');
			this.host.paragraph(banner, pending && progress.status === 'plan' ? localize('ordito.diagramPlanReady', "Diagram Plan Ready · {0} Proposed Views", progress.plan?.length ?? 0) : active && nextDiagram ? localize('ordito.diagramViewRunning', "Generating {0} · {1} of {2} Diagrams Ready", nextDiagram.name, progress.plan!.filter(item => item.status === 'complete').length, progress.plan!.length) : active ? localize('ordito.diagramPlanning', "Analyzing Code and Planning Diagrams · {0} of {1} Steps", progress.completed, progress.total) : pending && progress.status === 'failed' ? localize('ordito.diagramPaused', "Diagram Generation Paused · {0} of {1} Steps Completed", progress.completed, progress.total) : pending && !started ? localize('ordito.diagramReady', "Ready to Propose Diagrams") : pending ? localize('ordito.diagramProgress', "Build Diagrams · {0} of {1} Steps Completed · {2}", progress.completed, progress.total, progress.model) : localize('ordito.indexReady', "Source Evidence Ready · Create Capability and Flow Diagrams with AI"));
			if (pending && progress.plan?.length) {
				const details = this.controls.details(banner, localize('ordito.diagramPlanDetails', "Diagram Plan and Steps"), 'diagram-plan');
				const list = dom.append(details, dom.$('ol.ordito-diagram-plan'));
				for (const item of progress.plan) {
					const row = dom.append(list, dom.$('li'));
					const label = dom.append(row, dom.$('span'));
					label.textContent = localize('ordito.diagramPlanItem', "{0} · {1} · {2}", item.name, viewLabels[item.kind], item.status === 'complete' ? localize('ordito.diagramStepComplete', "Ready") : active && item === nextDiagram ? localize('ordito.diagramStepRunning', "Generating") : localize('ordito.diagramStepPending', "Pending"));
					this.host.paragraph(row, item.intent);
				}
			}

			if (active) {
				const meter = dom.append(banner, dom.$('progress'));
				meter.setAttribute('max', String(progress.total)); meter.setAttribute('value', String(progress.completed));
				meter.setAttribute('aria-label', localize('ordito.diagramGenerationProgress', "Diagram Generation Progress"));
			} else {
				if (pending && progress.error) { renderOrditoErrorNotice(banner, describeOrditoError(progress.error, 'ai', this.project.model), this.controls); }
				if (pending && progress.questions.length) { this.host.paragraph(banner, progress.questions.join(' ')); }
				const resume = this.host.button(banner, progress?.status === 'plan' ? localize('ordito.reviewDiagramPlan', "Review Diagram Plan") : started ? localize('ordito.resumeDiagrams', "Resume Diagrams") : localize('ordito.buildDiagrams', "Build Diagrams with AI"), () => (pending ? this.ai.resumeDiagrams() : this.ai.buildDiagrams()));
				resume.disabled = this.ai.busy || this.code.busy; resume.classList.toggle('ordito-primary-action', started);
				if (pending) {
					const options = this.controls.details(banner, localize('ordito.diagramJobOptions', "Generation Options"), 'diagram-job-options');
					this.host.button(options, localize('ordito.restartDiagrams', "Start Again"), () => this.ai.buildDiagrams()).disabled = this.ai.busy || this.code.busy;
				}
			}
		} else if (this.code.changed) {
			const banner = dom.append(parent, dom.$('section.ordito-workflow'));
			this.host.paragraph(banner, localize('ordito.sourceChanged', "Code Has Changed. Choose Update Diagrams to Reflect the Changes Here."));
		}
		if ((!history || this.project.model.version === 4 || this.project.model.version === 5) && (this.ai.canApply || this.ai.canVerify)) {
			this.host.button(parent, this.ai.canApply ? localize('ordito.ai.applyButton', "Apply Verified Changes") : localize('ordito.ai.verifyButton', "Run Tests"), () => (this.ai.canApply ? this.ai.apply() : this.ai.verify())).disabled = this.ai.busy || this.code.busy || !this.project.editable || this.project.hasStructuralErrors || !this.ai.available || !this.code.available || this.configurationService.getValue<boolean>('chat.disableAIFeatures') === true;
		}
	}

	renderTools(toolbar: HTMLElement): void {
		toolbar.setAttribute('aria-label', localize('ordito.documentStatus', "Document Status"));
		const status = dom.append(toolbar, dom.$('span.ordito-sync-status'));
		status.setAttribute('role', 'status'); status.textContent = this.host.documentStatus();
	}

	renderCodeActions(parent: HTMLElement, settings: () => void, reviewActions?: (container: HTMLElement) => void, generation?: { ui: OrditoFeatureCodeGeneration; review(): void }): void {
		const busy = this.ai.busy || this.code.busy;
		const reason = this.project.loading || this.project.error ? localize('ordito.code.waitForProject', "Open a valid project before using code actions.") : busy ? localize('ordito.operationWait', "Wait for the Active Specsplice Operation to Finish.") : !this.project.editable ? localize('ordito.generation.readonly', "Open a writable project to prepare code changes.") : this.project.hasStructuralErrors ? localize('ordito.code.correctModel', "Correct the draft specification in Project Settings first.") : undefined;
		const aiDisabled = this.configurationService.getValue<boolean>('chat.disableAIFeatures') === true;
		const aiReason = reason ?? (aiDisabled ? localize('ordito.ai.disabled', "AI Features Are Disabled in Settings.") : !this.ai.available ? localize('ordito.code.aiUnavailable', "Connect an AI provider in AI Settings to prepare code changes.") : undefined);
		const structuralReason = reason ?? (!this.ai.available || !this.code.available ? localize('ordito.generation.unavailable', "Local code generation and verification are unavailable in this environment.") : !this.project.projectRoot ? localize('ordito.codeUpdate.saveFirst', "Open or Save a Project Before Updating Its Codebase.") : this.project.model.version !== 4 && this.project.model.version !== 5 ? localize('ordito.code.executableModel', "This action requires a project with executable behavior. Configure the model in Project Settings.") : undefined);
		let executable = false;
		try { const model = this.project.model; if (model.version === 4 || model.version === 5) { assertPureProject(model); executable = true; } } catch { /* The settings action remains available for incomplete designs. */ }
		const action = (label: string, run: () => Promise<void>, reason?: string) => ({ label, reason, run: () => run().catch(error => this.notifications.error(orditoErrorNotification(error, 'ai', this.project.model))) });
		const recovery = [
			action(localize('ordito.pure.resume', "Resume Model Behavior Review"), () => this.ai.structuralResume(), structuralReason),
			action(localize('ordito.pure.recover', "Recover Model Behavior Publication"), () => this.ai.structuralRecover(), structuralReason),
			action(localize('ordito.ai.resumeButton', "Resume Implementation"), () => this.ai.resume(), aiReason),
			action(localize('ordito.ai.recoverButton', "Recover Interrupted Implementation"), () => this.ai.recover(), aiReason),
			action(localize('ordito.undoSync', "Undo Last Sync"), () => this.commandService.executeCommand('ordito.undoSync'), reason ?? (!this.code.context ? localize('ordito.code.noSync', "Open a project linked to a codebase to manage synchronization.") : undefined)),
			action(localize('ordito.recoverSync', "Recover Sync"), () => this.commandService.executeCommand('ordito.restoreCodeSnapshot'), reason ?? (!this.code.context ? localize('ordito.code.noSync', "Open a project linked to a codebase to manage synchronization.") : undefined))
		];
		if (this.project.model.version !== 4 && this.project.model.version !== 5 && !isSourceEvidenceModel(this.project.model)) { recovery.push(action(localize('ordito.syncProject', "Sync Project"), () => this.code.sync(), reason ?? (!this.code.context ? localize('ordito.code.noSync', "Open a project linked to a codebase to manage synchronization.") : undefined))); }
		const worktree = this.project.model.version !== 4 && this.project.model.version !== 5 && this.code.context && this.ai.available && !aiDisabled && (this.ai.canApply || this.ai.canVerify) ? {
			...action(this.ai.canApply ? localize('ordito.ai.applyButton', "Apply Verified Changes") : localize('ordito.ai.verifyButton', "Run Tests"), () => this.ai.canApply ? this.ai.apply() : this.ai.verify(), aiReason ?? (!this.code.available ? structuralReason : undefined)),
			status: this.ai.status
		} : undefined;
		const updateReason = aiReason ?? (!this.project.projectRoot ? localize('ordito.codeUpdate.saveFirst', "Open or Save a Project Before Updating Its Codebase.") : undefined);
		const assisted = generation && typeof this.ai.inspectCodeGeneration === 'function' ? generation : undefined;
		const run = assisted && this.ai.codeGeneration;
		const setupReason = updateReason ?? (!this.project.model.semantics.elements.some(element => element.kind === 'feature') ? localize('ordito.featureCode.featureRequired', "Add a feature with a diagram before preparing code.") : undefined);
		const update = this.code.context || !assisted ? action(localize('ordito.codeUpdate.button', "Update Codebase from Diagrams"), () => this.ai.updateCodebase(), updateReason) : undefined;
		let reviewed = assisted && action(localize('ordito.featureCode.start', "Prepare Code from Diagrams"), () => assisted.ui.configure(), setupReason);
		if (assisted && run) {
			if (hasFeatureCodeReview(run)) { reviewed = action(localize('ordito.featureCode.openReview', "Review AI Code Changes"), async () => assisted.review(), aiReason); }
			else if (run.status === 'waitingUser') { reviewed = action(localize('ordito.featureCode.clarify', "Answer Clarifications"), () => assisted.ui.clarify(), aiReason); }
			else { reviewed = action(localize('ordito.featureCode.resume', "Resume Generation"), () => this.ai.resumeCodeGeneration(), aiReason); }
		}
		renderOrditoCodeActions(parent, this.controls, {
			update,
			reviewedGeneration: assisted && {
				action: run?.status === 'generating' && busy ? undefined : reviewed,
				prepareNew: run && ['ready', 'verified', 'failed', 'applied', 'undone'].includes(run.status) ? action(localize('ordito.featureCode.startNew', "Prepare New Code Changes"), () => assisted.ui.configure(), setupReason) : undefined,
				renderStatus: container => assisted.ui.renderProgress(container, run, this.controls, busy)
			},
			prepare: action(localize('ordito.review.prepare', "Prepare Model to Code Review"), () => this.ai.implement(), structuralReason ?? (!executable ? localize('ordito.code.behaviorRequired', "Complete the executable behavior and runtime in Project Settings to prepare a local code review.") : undefined)),
			continuity: action(localize('ordito.continuity.toggle', "Start or Stop Continuous Preparation"), () => this.ai.configureContinuity(), structuralReason),
			continuityStatus: this.ai.continuityStatus,
			worktree,
			review: this.ai.structuralReview ? { label: localize('ordito.ai.reviewButton', "Review Changes"), run: () => this.host.showReview() } : undefined,
			sources: this.code.context ? [
				action(localize('ordito.code.inspectButton', "Code Evidence"), () => this.code.inspect(), this.code.busy ? localize('ordito.operationWait', "Wait for the Active Specsplice Operation to Finish.") : undefined),
				action(localize('ordito.shortcuts.update', "Update Diagrams from Codebase"), () => this.commandService.executeCommand('ordito.ai.updateDiagrams'), aiReason)
			] : undefined,
			recovery, settings, reviewActions
		});
		this.renderWorkflow(parent, 'history');
	}

	renderProjectActions(parent: HTMLElement): void {
		parent.classList.add('ordito-action-menu');
		dom.append(parent, dom.$('h1')).textContent = localize('ordito.project.settingsTitle', "Project Settings");
		const menu = new OrditoActionMenu(this.controls);
		const commands = (container: HTMLElement, entries: readonly (readonly [string, string, ThemeIcon, string?, ('action' | 'navigation')?])[]) => {
			for (const [label, command, icon, description, kind] of entries) { menu.action(container, label, () => this.commandService.executeCommand(command), { icon, description, kind }); }
		};
		const files = menu.disclosure(parent, localize('ordito.project.files', "Open and Save"), 'project-files', { icon: Codicon.folderOpened, openByDefault: true });
		commands(files, [
			[localize('ordito.saveCopy', "Save Project Copy"), 'ordito.saveCopy', Codicon.saveAs, localize('ordito.project.copyHelp', "Save a separate copy of this project.")],
			[localize('ordito.reload', "Reload Project"), 'ordito.reload', Codicon.refresh, localize('ordito.project.reloadHelp', "Read the saved project again; review unsaved changes first.")],
			[localize('ordito.importCode', "Import Codebase"), 'ordito.importCodebase', Codicon.fileCode, localize('ordito.project.importHelp', "Start a source inventory from an existing codebase.")]
		]);
		const modelFiles = menu.disclosure(files, localize('ordito.project.modelFiles', "Advanced · Model Files"), 'project-model-files', { icon: Codicon.json });
		commands(modelFiles, [[localize('ordito.openModel', "Open Model"), 'ordito.openModel', Codicon.goToFile, undefined, 'navigation']]);
		if (this.project.error || this.project.loading) { return; }
		const model = menu.disclosure(parent, localize('ordito.project.design', "Model and Architecture"), 'project-architecture', { icon: Codicon.symbolStructure, openByDefault: true });
		const explore = menu.section(model, localize('ordito.project.explore', "Explore"), { compact: true });
		commands(explore, [[localize('ordito.systemMap', "System Map"), 'ordito.showSystemMap', Codicon.typeHierarchy, localize('ordito.project.mapHelp', "Explore boundaries, elements and relationships."), 'navigation']]);
		if ((this.project.model.version === 4 || this.project.model.version === 5) && this.project.editable) {
			const define = menu.section(model, localize('ordito.project.define', "Edit Specification"), { compact: true });
			commands(define, [
				[localize('ordito.blueprint.edit', "Edit Blueprint"), 'ordito.blueprint', Codicon.edit, localize('ordito.project.blueprintHelp', "Define structure, ownership and shared contracts.")],
				[localize('ordito.task.edit', "Tasks and Clarifications"), 'ordito.taskIntent', Codicon.tasklist],
				[localize('ordito.task.profile', "Choose Runtime and Review Stack Plan"), 'ordito.selectStructuralProfile', Codicon.server]
			]);
			const behavior = menu.disclosure(parent, localize('ordito.project.behavior', "Executable Behavior"), 'project-behavior', { icon: Codicon.symbolMethod });
			const edit = menu.section(behavior, localize('ordito.behavior.edit', "Edit Behavior"), { compact: true });
			commands(edit, [
				[localize('ordito.states.edit', "Edit Executable State Machine"), 'ordito.stateMachine', Codicon.circleLarge],
				[localize('ordito.interaction.edit', "Edit Executable Interaction"), 'ordito.interaction', Codicon.arrowSwap],
				[localize('ordito.predicate.edit', "Edit Pure Predicate"), 'ordito.predicate', Codicon.symbolOperator],
				[localize('ordito.messaging.edit', "Edit Messaging Topology"), 'ordito.messaging', Codicon.broadcast]
			]);
			const verify = menu.section(behavior, localize('ordito.behavior.verify', "Cases and Simulation"), { compact: true });
			if (this.project.model.foundation.messaging?.length) { commands(verify, [[localize('ordito.messaging.simulate', "Simulate Messaging"), 'ordito.simulateMessaging', Codicon.play]]); }
			if (this.project.model.foundation.stateMachines?.length) { commands(verify, [[localize('ordito.states.simulate', "Simulate State Machine"), 'ordito.ai.simulateStates', Codicon.play]]); }
			menu.action(verify, localize('ordito.pure.expectations', "Independent Business Expectations"), () => this.ai.editPureCriteria(), { icon: Codicon.beaker });
			const technical = menu.disclosure(behavior, localize('ordito.behavior.technical', "Code and Context"), 'project-behavior-code', { icon: Codicon.code });
			commands(technical, [[localize('ordito.task.preview', "Structural AI Context Preview"), 'ordito.prepareStructuralContext', Codicon.eye, undefined, 'navigation']]);
			menu.action(technical, localize('ordito.pure.reverse', "Reverse Model Behavior from Code"), () => this.ai.structuralReverse(), { icon: Codicon.arrowSwap });
		}
		const developer = menu.disclosure(parent, localize('ordito.project.developerTools', "Developer Tools"), 'project-developer-tools', { icon: Codicon.tools });
		commands(developer, [
			[localize('ordito.files', "Files"), 'ordito.openFiles', Codicon.files, undefined, 'navigation'],
			[localize('ordito.terminal', "Terminal"), 'ordito.openTerminal', Codicon.terminal, undefined, 'navigation'],
			[localize('ordito.debug', "Debug"), 'workbench.view.debug', Codicon.debugAlt, undefined, 'navigation'],
			[localize('ordito.git', "Git"), 'workbench.view.scm', Codicon.sourceControl, undefined, 'navigation']
		]);
	}

	constructor(
		private readonly host: OrditoWorkflowContentHost,
		private readonly controls: OrditoControls,
		private readonly project: OrditoProjectService,
		private readonly ai: IOrditoAiService,
		private readonly configurationService: IConfigurationService,
		private readonly notifications: INotificationService,
		private readonly code: IOrditoCodeService,
		private readonly commandService: ICommandService
	) {
	}
}
