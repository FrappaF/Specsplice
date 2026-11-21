import { isSourceEvidenceModel } from '../common/modelFoundation.js';
import { localize } from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IFilesConfigurationService } from '../../../services/filesConfiguration/common/filesConfigurationService.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { isDiffEditor } from '../../../../editor/browser/editorBrowser.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IOrditoProjectService } from '../browser/orditoProjectService.js';
import { resolveOrditoMetadataDirectory } from '../browser/orditoProjectFiles.js';
import { IOrditoCodeService } from '../browser/orditoCodeService.js';
import { IOrditoOperationService, OrditoOperationService } from '../browser/orditoOperationService.js';
import { getModelImpact } from '../common/modelImpact.js';
import { CodePreview, CodeReconciliationContext, CodeResolution } from '../common/codeBridge.js';
import { type PreparedReview, type Proposal, type CollaborationSession, type ModelBenchmark, type OrditoAiProject, type OrditoAiWorkflow } from './orditoAiTypes.js';
import { OrditoAiConnection } from './orditoAiConnection.js';

/** Implementation, reconciliation and measured model comparison; lifecycle belongs to this component. */
export class OrditoAiImplementation extends Disposable {
	private _session: CollaborationSession | undefined;

	private async openReport(root: string, name: string, contents: string, identity?: string, show = true): Promise<void> {
		const directory = identity && /^[\w-]+$/.test(identity) ? identity : generateUuid();
		const report = URI.joinPath(await resolveOrditoMetadataDirectory(this.files, URI.file(root)), 'reports', directory, name);
		await this.files.createFolder(URI.joinPath(report, '..'));
		await this.files.writeFile(report, VSBuffer.fromString(contents + '\n'));
		await this.filesConfiguration.updateReadonly(report, { value: localize('ordito.ai.report.readonly', "This is a saved implementation review. Prepare a new review to change its inputs.") });
		if (show) { await this.editors.openEditor({ resource: report, options: { pinned: true, override: 'default' } }); }
	}

	private planContents(plan: Proposal['plan'], usage?: Proposal['usage']): string {
		return ['# ' + localize('ordito.ai.plan.title', "Implementation Plan"), plan.summary,
			'## ' + localize('ordito.ai.plan.steps', "Implementation Steps"), plan.steps.map((step, index) => `${index + 1}. ${step.description}`).join('\n'),
			'## ' + localize('ordito.ai.plan.files', "Planned File Changes"), plan.changes.map(change => `- ${change.kind}: ${change.file} · ${change.reason}`).join('\n'),
			'## ' + localize('ordito.ai.plan.tests', "Planned Tests"), (plan.tests ?? []).map(test => `- ${test.description}`).join('\n') || localize('ordito.ai.plan.noTests', "No Tests Declared."),
			'## ' + localize('ordito.ai.plan.questions', "Open Questions"), plan.questions.map(item => `- ${item.question} · ${item.reason}`).join('\n') || localize('ordito.ai.plan.noQuestions', "No Clarifications Requested."),
			'## ' + localize('ordito.ai.plan.limitations', "Limitations"), (plan.limitations ?? []).map(item => `- ${item}`).join('\n') || localize('ordito.ai.plan.noLimitations', "No Limitations Declared."),
			usage ? localize('ordito.ai.planTokens', "Reported Plan Tokens · Input: {0} · Output: {1}", usage.inputTokens ?? localize('ordito.ai.unknown', "Unavailable"), usage.outputTokens ?? localize('ordito.ai.unknown', "Unavailable")) : ''
		].filter(Boolean).join('\n\n');
	}


	private sourceReviewContents(prepared: CodeReconciliationContext): string {
		const lines = ['# ' + localize('ordito.ai.sync.sourcesTitle', "Sync Source Review"),
			localize('ordito.ai.sync.reviewHelp', "Review model changes in Reconciliation Design.json and the exact request and schema in Reconciliation Context.json. Source ranges omitted from these windows remain unknown.")];
		const append = (title: string, windows: { start: number; text: string }[] | undefined | null) => {
			lines.push('### ' + title);
			if (!windows?.length) { lines.push(localize('ordito.ai.sync.noSourceWindow', "No Source Window Available.")); return; }
			for (const window of windows) {
				const fence = '`'.repeat(Math.max(3, ...[...window.text.matchAll(/`+/g)].map(match => match[0].length + 1)));
				lines.push(localize('ordito.ai.sync.offset', "Source Offset: {0}", window.start), fence + 'text\n' + window.text + '\n' + fence);
			}
		};
		for (const source of prepared.sourceWindows ?? []) {
			lines.push('## ' + source.file);
			append(localize('ordito.ai.sync.common', "Common Baseline"), source.commonWindows);
			append(localize('ordito.ai.sync.current', "Current Source"), source.windows);
		}
		return lines.join('\n\n');
	}

	private syncProposalContents(result: CodePreview): string {
		const ai = result.ai;
		const edits = (ai?.sourceEdits ?? []) as { file: string }[];
		const modelEdits = (ai?.modelEdits ?? []) as { collection: string; id: string; value: { name?: string } | null }[];
		const bindings = (ai?.bindings ?? []) as { name: string; file: string; elementId: string }[];
		return ['# ' + localize('ordito.ai.sync.proposal.title', "Sync Proposal"), ai?.summary,
			'## ' + localize('ordito.ai.sync.proposal.status', "Review Status"),
			ai?.questions.length ? localize('ordito.ai.sync.proposal.blocked', "Apply Is Blocked Until the Open Questions Are Resolved.") : localize('ordito.ai.sync.proposal.ready', "Ready for Review. No Changes Have Been Applied."),
			localize('ordito.ai.sync.proposal.runtime', "Sync Has Not Run Runtime Tests or Builds."),
			'## ' + localize('ordito.ai.sync.proposal.files', "Proposed Source Files"), [...new Set(edits.map(edit => edit.file))].map(file => `- ${file}`).join('\n') || localize('ordito.ai.sync.proposal.noFiles', "No Source Changes Proposed."),
			'## ' + localize('ordito.ai.sync.proposal.model', "Model Changes"), modelEdits.map(edit => `- ${edit.value === null ? localize('ordito.ai.sync.proposal.remove', "Remove") : localize('ordito.ai.sync.proposal.update', "Update")} · ${edit.collection} · ${edit.value?.name ?? edit.id}`).join('\n') || localize('ordito.ai.sync.proposal.noModel', "No Model Changes Proposed."),
			'## ' + localize('ordito.ai.sync.proposal.questions', "Open Questions"), (ai?.questions ?? []).map(question => `- ${question}`).join('\n') || localize('ordito.ai.sync.proposal.noQuestions', "No Open Questions."),
			'## ' + localize('ordito.ai.sync.proposal.bindings', "AI Identity Mapping Proposals"),
			localize('ordito.ai.sync.proposal.bindingNature', "These are AI-proposed textual mappings. Static index bindings are reviewed separately in Coverage and Evidence."), bindings.map(binding => `- ${binding.name} · ${binding.file} · ${binding.elementId}`).join('\n') || localize('ordito.ai.sync.proposal.noBindings', "No AI Identity Mappings Proposed."),
			'## ' + localize('ordito.ai.sync.proposal.details', "Full Proposal"), `[${localize('ordito.ai.sync.proposal.json', "Open the Structured Proposal")}](${encodeURIComponent(localize('ordito.ai.sync.proposalFile', "Reconciliation Proposal.json"))})`
		].join('\n\n');
	}

	async interpret(): Promise<void> {
		await this.collaborate('interpret');
	}

	async reconcile(preview: CodePreview, resolutions: CodeResolution[] = [], direction?: 'model' | 'code'): Promise<CodePreview | undefined> {
		if (this.host.busy || this.operations.busy || !this.code.context) { return undefined; }
		if (this.code.context.diagramState === 'index' || isSourceEvidenceModel(this.project.model) || !this.project.model.views.some(view => view.nodes.length > 0)) {
			await this.host.buildDiagrams();
			return undefined;
		}
		if (!await this.connection.ensureConfigured()) { return undefined; }
		let result: CodePreview | undefined;
		await this.host.run(async token => {
			const config = await this.connection.readyConfig();
			const context = this.code.context;
			if (!config || !context || context.snapshot !== preview.context.snapshot || !await this.project.save()) { return; }
			const needsSourceReview = !!preview.ai?.questions.length;
			let clarification: string | undefined;
			if (preview.ai?.questions.length) {
				clarification = (await this.quick.input({ title: localize('ordito.ai.reconcileClarify', "Clarify the Reconciliation"), prompt: preview.ai.questions.join(' '), ignoreFocusLost: true, validateInput: async value => value.trim() ? undefined : localize('ordito.ai.reconcileClarify.required', "Enter an Answer Before Preparing a New Context.") }))?.trim();
				if (!clarification) { this.host.info(localize('ordito.ai.reconcileClarify.cancelled', "Sync Clarification Cancelled · No AI Request Was Made.")); return; }
			}
			if (preview.ai || preview.reconciliation?.status === 'verificationFailed') { preview = JSON.parse(await this.code.executeReconciliation({ operation: 'preview', snapshot: context.snapshot, scope: context.scope }, token)); }
			const changed = new Set([...preview.files.added, ...preview.files.changed]);
			for (const file of preview.context.files.filter(file => preview.context.declarations.some(item => item.evidence.file === file.path && preview.impact.elementIds.includes(item.id)))) { changed.add(file.path); }
			const suggested = preview.context.files.filter(file => changed.has(file.path) && file.status !== 'excluded' && file.status !== 'configuration');
			const selected = direction && suggested.length > 0 && !needsSourceReview ? suggested.map(file => ({ label: file.path })) : await this.quick.pick(preview.context.files.filter(file => file.status !== 'excluded' && file.status !== 'configuration').map(file => ({ label: file.path, picked: changed.has(file.path) })), { title: localize('ordito.ai.reconcileSources', "Review Source Files for Bidirectional Sync"), placeHolder: localize('ordito.ai.reconcileSourcesHint', "Select the affected implementation and callers in any language. Only bounded windows of selected files are sent."), canPickMany: true });
			if (!selected) { this.host.info(localize('ordito.ai.sync.cancelled', "Sync Context Review Cancelled · No AI Request Was Made.")); return; }
			const prepared: CodeReconciliationContext = JSON.parse(await this.code.executeReconciliation({ operation: 'reconciliationPrepare', token: preview.token, config: JSON.stringify(config), sourceFiles: selected.map(item => item.label), resolutions, clarification: [direction === 'model' ? 'Update the implementation to satisfy the edited diagrams and preserve unrelated code. Ask about concurrent changes.' : '', clarification].filter(Boolean).join('\n') }, token));
			await this.openReport(context.sourceRoot, localize('ordito.ai.sync.contextFile', "Reconciliation Context.json"), prepared.contents, prepared.reviewId);
			if (prepared.designContents) { await this.openReport(context.sourceRoot, localize('ordito.ai.sync.designFile', "Reconciliation Design.json"), prepared.designContents, prepared.reviewId); }
			if (prepared.sourceWindows) { await this.openReport(context.sourceRoot, localize('ordito.ai.sync.sourceFile', "Sync Source Review.md"), this.sourceReviewContents(prepared), prepared.reviewId); }
			if (!config.maxCalls) { this.host.info(localize('ordito.ai.reconcileContextOnly', "Reconciliation Context Prepared · The Saved Budget Allows No AI Calls.")); return; }
			this.host.activityStatus = localize('ordito.ai.sync.waiting', "Waiting for Sync Context Review · No Request Sent");
			const consent = await this.quick.pick([
				{ label: localize('ordito.ai.reconcileSend', "Request Sync Proposal"), detail: localize('ordito.ai.sync.oneRun', "1 Agent Run"), tooltip: localize('ordito.ai.reconcileBytes', "{0} input bytes including schema; {1} source bytes disclosed from {2} available. One CLI invocation, with the saved model and budget. Token estimate: {3}; actual usage is reported separately. No source or model is changed until Apply Sync.", prepared.metrics.inputBytes + prepared.metrics.schemaBytes, prepared.metrics.disclosedBytes, prepared.metrics.sourceBytes, prepared.metrics.estimatedTokens), propose: true },
				{ label: localize('ordito.ai.context.cancel', "Cancel"), propose: false }
			], { title: localize('ordito.ai.sync.review', "Review Sync Context"), placeHolder: localize('ordito.ai.sync.inspect', "Inspect Reports"), ignoreFocusLost: true });
			if (!consent?.propose) { this.host.info(localize('ordito.ai.sync.cancelled', "Sync Context Review Cancelled · No AI Request Was Made.")); return; }
			this.host.activityStatus = localize('ordito.ai.sync.proposing', "Waiting for the Sync Proposal");
			result = JSON.parse(await this.code.executeReconciliation({ operation: 'reconciliationPropose', token: preview.token, reviewId: prepared.reviewId }, token));
			this.host.activityStatus = result?.ai?.cached ? localize('ordito.ai.sync.cached', "Cached Sync Proposal · No New AI Request") : localize('ordito.ai.sync.ready', "Sync Proposal Ready · Review Before Applying");
			await this.openReport(context.sourceRoot, localize('ordito.ai.sync.proposalFile', "Reconciliation Proposal.json"), JSON.stringify(result?.ai ?? result?.reconciliation, null, '\t'), prepared.reviewId, false);
			if (result) { await this.openReport(context.sourceRoot, localize('ordito.ai.sync.summaryFile', "Sync Proposal.md"), this.syncProposalContents(result), prepared.reviewId); }
		});
		return result;
	}

	async collaborate(operation: 'plan' | 'interpret'): Promise<void> {
		if ((this.project.model.version === 4 || this.project.model.version === 5)) { this.host.info(localize('ordito.ai.v4Profile', "Choose a Compatible Generation Profile Before Implementing This Specification. You Can Continue Editing and Saving the Draft.")); return; }
		if (this.host.busy || this.operations.busy) { this.notifications.info(localize('ordito.ai.busy', "A Specsplice operation is already running. Wait for it to finish or cancel it before starting another.")); return; }
		if (!this.code.context) { this.host.info(localize('ordito.ai.importRequired', "Import a Git Codebase with a Commit and Add a Feature Before Implementing. Use Import Codebase or Sync Project.")); return; }
		if (!await this.connection.ensureConfigured()) { return; }
		await this.host.run(async token => {
			const config = await this.connection.readyConfig();
			if (!config) { return; }
			const context = this.code.context;
			if (!context || !this.project.model || !await this.project.save()) { throw new Error(localize('ordito.ai.importFirst', "Save the model and import or Sync its Git codebase first.")); }
			const projectId = this.project.model.id;
			const saveCurrent = async (): Promise<boolean> => {
				if (this.code.context?.snapshot !== context.snapshot || this.project.model?.id !== projectId) { throw new Error(localize('ordito.ai.contextChanged', "The active project changed. Prepare and review a new context.")); }
				const saved = await this.project.save();
				if (!saved) { this.host.info(localize('ordito.ai.saveCancelled', "The Model Was Not Saved. The AI Operation Was Cancelled.")); }
				return saved;
			};
			const feature = await this.quick.pick(this.project.model.semantics.elements.filter(element => element.kind === 'feature').map(element => ({ label: element.name, id: element.id })), { title: localize('ordito.ai.feature', "Implement Feature") });
			if (!feature) { this.host.info(localize('ordito.ai.featureCancelled', "No Feature Selected · AI Operation Cancelled. Add a Feature if the Project Is Empty.")); return; }
			const intent = (await this.quick.input({ title: localize('ordito.ai.intent', "Requested Behavior"), prompt: localize('ordito.ai.intentHint', "Describe the implementation change. Acceptance criteria come from the feature's behavioral contract."), ignoreFocusLost: true, validateInput: async value => value.trim() ? undefined : localize('ordito.ai.intentRequired', "Describe the requested behavior before continuing.") }))?.trim();
			if (!intent) { this.host.info(localize('ordito.ai.intentCancelled', "No Behavior Entered · AI Operation Cancelled.")); return; }
			const impact = getModelImpact(this.project.model, feature.id);
			const relatedIds = new Set([...impact.scope.map(element => element.id), ...impact.dependents.map(entry => entry.element.id)]);
			const suggested = new Set([...this.project.model.codeMappings.filter(mapping => relatedIds.has(mapping.elementId)).map(mapping => mapping.file), ...context.declarations.filter(declaration => relatedIds.has(declaration.id)).map(declaration => declaration.evidence.file)]);
			const selected = await this.quick.pick(context.files.filter(file => ['parsed', 'partial'].includes(file.status)).map(file => ({ label: file.path, picked: suggested.has(file.path) })), { title: localize('ordito.ai.sources', "Review Source Files to Share · Suggested from Model Evidence"), canPickMany: true });
			if (!selected) { this.host.info(localize('ordito.ai.filesCancelled', "File Review Cancelled · No AI Request Was Made.")); return; }
			const prepared = await this.host.request<PreparedReview>({ operation: 'prepare', config, request: { version: 1, snapshot: context.snapshot, featureId: feature.id, intent, constraints: [], sourceFiles: selected.map(file => file.label) } }, token);
			await this.openReport(context.sourceRoot, localize('ordito.ai.context.file', "Implementation Context.json"), JSON.stringify(prepared.context, null, '\t'), prepared.reviewId);
			if (!config.maxCalls) { this.host.info(localize('ordito.ai.contextOnly', "Context Prepared · No AI Request Was Made Because the Budget Is Zero.")); return; }
			this.host.activityStatus = localize('ordito.ai.context.waiting', "Waiting for Context Review · No Request Sent");
			const consent = await this.quick.pick([
				{ label: localize('ordito.ai.sendTo', "Send Context to {0}", config.provider === 'codex' ? 'Codex' : 'Claude Code'), detail: localize('ordito.ai.context.summary', "{0} Sources + Model Context", selected.length), tooltip: localize('ordito.ai.disclosure', "Includes the selected model elements, contracts, impact, source evidence and {0} selected files. The original CLI uses its own account and configuration.", selected.length), send: true },
				{ label: localize('ordito.ai.context.cancel', "Cancel"), send: false }
			], { title: localize('ordito.ai.context.review', "Review Implementation Context"), placeHolder: localize('ordito.ai.context.inspect', "Inspect Report"), ignoreFocusLost: true });
			if (!consent?.send) { this.host.info(localize('ordito.ai.reviewCancelled', "Operation Cancelled During Review.")); return; }
			if (!await saveCurrent()) { return; }
			if (operation === 'interpret') {
				const result = await this.host.request<{ status: string; hypotheses: { description: string; rationale: string }[]; questions: string[] }>({ operation, prepared, reviewId: prepared.reviewId }, token);
				if (result.status === 'not-needed') { this.notifications.info(localize('ordito.ai.noResiduals', "The selected evidence has no residual diagnostics to interpret. No AI request was made.")); }
				else { await this.editors.openEditor({ contents: localize('ordito.ai.hypotheses', "Hypotheses for Review · These Are Not Model Facts") + '\n\n' + result.hypotheses.map(item => item.description + '\n' + item.rationale).join('\n\n') + '\n\n' + result.questions.join('\n'), languageId: 'plaintext', options: { pinned: true } }); }
				return;
			}
			const proposal = await this.host.request<Proposal>({ operation, prepared, reviewId: prepared.reviewId }, token);
			await this.openReport(context.sourceRoot, localize('ordito.ai.plan.file', "Implementation Plan.md"), this.planContents(proposal.plan, proposal.usage), proposal.planId);
			if (proposal.plan.questions.length) { this.notifications.info(proposal.plan.questions.map(item => item.question).join('\n')); return; }
			if (config.maxCalls < 2) { this.host.info(localize('ordito.ai.planOnly', "Plan Ready · Generation Is Not Included in the Saved One-Run Budget.")); return; }
			this.host.activityStatus = localize('ordito.ai.plan.waiting', "Plan Ready · Waiting for Review");
			const accepted = await this.quick.pick([
				{ label: localize('ordito.ai.generate', "Generate in Worktree"), detail: localize('ordito.ai.plan.fileCount', "{0} Planned File Changes", proposal.plan.changes.length), tooltip: proposal.plan.summary, generate: true },
				{ label: localize('ordito.ai.context.cancel', "Cancel"), generate: false }
			], { title: localize('ordito.ai.plan.review', "Review Implementation Plan"), placeHolder: localize('ordito.ai.plan.inspect', "Inspect Plan"), ignoreFocusLost: true });
			if (!accepted?.generate) { this.host.info(localize('ordito.ai.generationCancelled', "Plan Ready · Generation Cancelled. Project Sources Are Unchanged.")); return; }
			if (!await saveCurrent()) { return; }
			this._session = await this.host.request<CollaborationSession>({ operation: 'stage', prepared, plan: proposal.plan, reviewId: proposal.planId }, token);
			this.host.activityStatus = undefined;
			this.storage.store('ordito.ai.session', JSON.stringify({ root: this._session.root, id: this._session.id }), StorageScope.WORKSPACE, StorageTarget.MACHINE);
			await this.reviewCurrent();
		});
	}

	async reviewCurrent(): Promise<void> {
		if (!this._session) { this.host.info(localize('ordito.ai.sessionRequired', "No Implementation Is Open. Implement a Feature or Resume a Saved Session First.")); return; }
		const session = this._session;
		if (session.plan) { await this.openReport(session.root, localize('ordito.ai.plan.file', "Implementation Plan.md"), this.planContents(session.plan), session.planId ?? session.id); }
		const directory = URI.joinPath(await resolveOrditoMetadataDirectory(this.files, URI.file(session.root)), 'collaboration', session.id, 'review');
		for (const file of session.generated.files) {
			const original = URI.joinPath(directory, 'before', file.file);
			const modified = URI.joinPath(directory, 'after', file.file);
			await this.files.createFolder(URI.joinPath(original, '..'));
			await this.files.createFolder(URI.joinPath(modified, '..'));
			await this.files.writeFile(original, VSBuffer.fromString(session.before.find(before => before.file === file.file)?.content ?? ''));
			await this.files.writeFile(modified, VSBuffer.fromString(file.content ?? ''));
			await this.filesConfiguration.updateReadonly([original, modified], { value: localize('ordito.ai.diff.readonly', "This is a saved implementation comparison. Edit the worktree and prepare a new review to change its contents.") });
			const pane = await this.editors.openEditor({ original: { resource: original }, modified: { resource: modified }, label: file.file, options: { pinned: true } });
			const control = pane?.getControl();
			if (isDiffEditor(control)) { control.updateOptions({ readOnly: true, originalEditable: false }); }
		}
		if (session.verification) { await this.openReport(session.root, localize('ordito.ai.verification.file', "Implementation Verification.txt"), session.verification.output, session.id); }
		await this.openReport(session.root, localize('ordito.ai.review.file', "Implementation Review.md"), ['# ' + localize('ordito.ai.review.title', "Implementation Review"), this.status,
			session.verification?.outcome === 'incomplete' || session.verification?.outcome === 'cancelled' ? localize('ordito.ai.verification.interrupted', "Worktree Verification: Cancelled or Interrupted · No Completed Result") : session.verification ? localize('ordito.ai.verification.summary', "Worktree Verification: {0} · {1} ms", session.verification.code === 0 ? localize('ordito.ai.verification.passed', "Passed") : localize('ordito.ai.verification.failed', "Failed"), session.verification.durationMs) : localize('ordito.ai.verification.notRun', "Worktree Verification: Not Run"),
			localize('ordito.ai.resultProject', "Project: {0}", session.root),
			localize('ordito.ai.resultFiles', "Changed files: {0}", session.generated.files.map(file => file.file).join(', ')),
			'## ' + localize('ordito.ai.generation.summary', "Generation Summary · Before Verification"), session.generated.summary,
			localize('ordito.ai.resultTokens', "Reported Generation Tokens · Input: {0} · Output: {1}", session.usage.inputTokens ?? localize('ordito.ai.unknown', "Unavailable"), session.usage.outputTokens ?? localize('ordito.ai.unknown', "Unavailable")),
			localize('ordito.ai.actualCost', "Actual charge: unavailable. Subscription quota and token counts are distinct."),
			localize('ordito.ai.sourceState', "Generated tests describe this reviewed worktree revision. Use Sync after applying or undoing source changes.")
			].join('\n\n'), session.id);
	}

	async verify(): Promise<void> {
		if (!this.canVerify) { this.host.info(localize('ordito.ai.verifyRequired', "Generate or Resume Changes Before Running Tests.")); return; }
		await this.host.run(async token => {
			if (!this._session) { this.host.info(localize('ordito.ai.sessionRequired', "No Implementation Is Open. Implement a Feature or Resume a Saved Session First.")); return; }
			const consent = await this.dialogs.confirm({ message: localize('ordito.ai.runTests', "Run the Reviewed Tests in the Worktree?"), detail: localize('ordito.ai.runTestsDetail', "Node.js runs the generated test files on this computer. The main project stays unchanged."), primaryButton: localize('ordito.ai.verify', "Run Tests") });
			if (!consent.confirmed) { this.host.info(localize('ordito.ai.reviewCancelled', "Operation Cancelled During Review.")); return; }
			const session = this._session;
			try {
				this._session = await this.host.request<CollaborationSession>({ operation: 'verify', root: session.root, id: session.id, reviewId: session.reviewId }, token);
			} catch (error) {
				if (token.isCancellationRequested && this._session === session && this.code.context?.sourceRoot === session.root) {
					try {
						this._session = await this.host.request<CollaborationSession>({ operation: 'session', root: session.root, id: session.id });
						await this.reviewCurrent();
					} catch { /* The persisted incomplete result remains recoverable through Resume. */ }
				}
				throw error;
			}
			this.host.activityStatus = undefined;
			await this.reviewCurrent();
		});
	}

	async changeSource(undo: boolean): Promise<void> {
		if (undo ? !this.canUndo : !this.canApply) { this.host.info(localize('ordito.ai.applyPrerequisite', "Apply Requires Passing Tests; Undo Requires an Applied Implementation. Review the Current Session First.")); return; }
		await this.host.run(async token => {
			if (!this._session) { this.host.info(localize('ordito.ai.sessionRequired', "No Implementation Is Open. Implement a Feature or Resume a Saved Session First.")); return; }
			if (this.code.context?.sourceRoot !== this._session.root) { throw new Error(localize('ordito.ai.wrongProject', "Open the code project associated with this implementation before changing its source files.")); }
			const consent = await this.dialogs.confirm({ message: undo ? localize('ordito.ai.undo', "Undo This Implementation?") : localize('ordito.ai.apply', "Apply the Verified Changes to the Project?"), detail: [this.status, localize('ordito.ai.resultFiles', "Changed files: {0}", this._session.generated.files.map(file => file.file).join(', ')), localize('ordito.ai.generation.summary', "Generation Summary · Before Verification") + ': ' + this._session.generated.summary].join('\n\n'), primaryButton: undo ? localize('ordito.ai.undoButton', "Undo Implementation") : localize('ordito.ai.applyButton', "Apply Changes") });
			if (!consent.confirmed) { this.host.info(localize('ordito.ai.reviewCancelled', "Operation Cancelled During Review.")); return; }
			if (!undo && !await this.project.save()) { this.host.info(localize('ordito.ai.saveCancelled', "The Model Was Not Saved. The AI Operation Was Cancelled.")); return; }
			this._session = await this.host.request<CollaborationSession>({ operation: undo ? 'undo' : 'apply', root: this._session.root, id: this._session.id, reviewId: this._session.reviewId }, token);
			this.host.activityStatus = undefined;
			await this.reviewCurrent();
		});
	}

	async resume(): Promise<void> {
		await this.host.run(async token => {
			const saved = this.storage.get('ordito.ai.session', StorageScope.WORKSPACE);
			if (!saved) { this.host.info(localize('ordito.ai.noSession', "No Specsplice implementation session is saved for this workspace.")); return; }
			const request: { root: string; id: string } = JSON.parse(saved);
			this._session = await this.host.request<CollaborationSession>({ ...request, operation: 'session' }, token);
			this.host.activityStatus = undefined;
			await this.reviewCurrent();
		});
	}

	async recover(): Promise<void> {
		await this.host.run(async token => {
			const saved = this.storage.get('ordito.ai.session', StorageScope.WORKSPACE);
			if (!saved) { this.host.info(localize('ordito.ai.noRecovery', "No Saved Implementation Is Available to Recover in This Workspace.")); return; }
			const request: { root: string; id: string } = JSON.parse(saved);
			this._session = await this.host.request<CollaborationSession>({ ...request, operation: 'recover' }, token);
			this.host.activityStatus = undefined;
		});
	}

	async benchmark(): Promise<void> {
		await this.compareModels(false);
	}

	async benchmarkReconciliation(): Promise<void> {
		await this.compareModels(true);
	}

	private async compareModels(reconciliation: boolean): Promise<void> {
		if (!await this.connection.ensureConfigured()) { return; }
		if (this.connection.config!.maxCalls < (reconciliation ? 1 : 2)) { this.host.info(localize('ordito.ai.benchmarkBudget', "The benchmark needs a saved AI request budget. Configure one run per reconciliation case or two per implementation case.")); return; }
		await this.host.run(async token => {
			const config = await this.connection.readyConfig();
			if (!config) { return; }
			const models = this.connection.nativeModels(config.provider);
			const alternatives = models.filter(model => model.id !== config.model);
			const alternative = alternatives.length ? (await this.quick.pick(alternatives, { title: localize('ordito.ai.compareModel', "Choose the Model to Compare") }))?.id
				: await this.quick.input({ title: localize('ordito.ai.compareModel', "Choose the Model to Compare"), prompt: localize('ordito.ai.compareExact', "Enter an exact model ID available to the same CLI account."), ignoreFocusLost: true });
			if (!alternative || alternative === config.model) { this.host.info(localize('ordito.ai.compareCancelled', "Choose a Different Model to Run a Comparison. No Benchmark Was Started.")); return; }
			const consent = await this.dialogs.confirm({ message: localize('ordito.ai.benchmarkConfirm', "Compare These Models on Three Sample Projects?"), detail: reconciliation ? localize('ordito.ai.reconcileBenchmarkDetail', "Compares Python, Java and Go in both directions and with concurrent conflicts. Starts eighteen CLI invocations for two models, using only generated sample projects. Records prompt/output size, reported tokens, latency, identity continuity and preservation of custom code. This benchmark checks structural reconciliation; it does not certify arbitrary behavior or all languages.") : localize('ordito.ai.benchmarkDetail', "Compares checkout, inventory and authorization in separate Git worktrees. Starts up to twelve agent runs and executes generated Node.js tests with independent acceptance checks on this computer. Only sample code is sent. Provider requests and retries within each run are managed by the original CLI; actual monetary charges may be unavailable."), primaryButton: localize('ordito.ai.benchmarkRun', "Run Model Benchmark") });
			if (!consent.confirmed) { this.host.info(localize('ordito.ai.reviewCancelled', "Operation Cancelled During Review.")); return; }
			const candidates = [config.model, alternative].map(model => ({ config: { ...config, model }, rates: models.find(candidate => candidate.id === model)?.rates }));
			const report = await this.host.request<ModelBenchmark>({ operation: reconciliation ? 'reconciliationBenchmark' : 'benchmark', candidates }, token);
			this.storage.store(reconciliation ? 'ordito.ai.reconciliationBenchmark' : 'ordito.ai.benchmark', JSON.stringify(report), StorageScope.PROFILE, StorageTarget.MACHINE);
			const summary = report.models.map(model => `${model.candidate.config.model}\n${model.cases.map(result => `${result.repository ?? `${result.language} · ${result.direction}`}: ${result.passed ? localize('ordito.ai.benchmarkPass', "Passed") : localize('ordito.ai.benchmarkFail', "Failed")} · ${result.durationMs} ms`).join('\n')}`).join('\n\n');
			await this.editors.openEditor({ contents: summary + '\n\n' + (report.defaultModel ? localize('ordito.ai.benchmarkDefault', "Measured economical default: {0}. It is offered first in model selection while available with the same quoted rates.", report.defaultModel) : localize('ordito.ai.benchmarkNoDefault', "No economical default was selected. Quality, account availability and comparable quoted consumption must all be known. Your explicit model selection is preserved.")), languageId: 'plaintext', options: { pinned: true } });
		});
	}

	async exportBenchmark(): Promise<void> {
		const report = this.storage.get('ordito.ai.reconciliationBenchmark', StorageScope.PROFILE) ?? this.storage.get('ordito.ai.benchmark', StorageScope.PROFILE);
		if (!report) { this.host.info(localize('ordito.ai.noBenchmark', "Run a model benchmark before exporting its measured results.")); return; }
		await this.editors.openEditor({ contents: JSON.stringify(JSON.parse(report), null, '\t'), languageId: 'json', options: { pinned: true } });
	}

	get canVerify(): boolean { return !!this._session && ['staged', 'failed', 'passed'].includes(this._session.status); }

	get canApply(): boolean { return this._session?.status === 'passed'; }

	get canUndo(): boolean { return this._session?.status === 'applied'; }

	get status(): string {
		if (!this._session) { return ''; }
		if (this._session.status === 'failed' && (this._session.verification?.outcome === 'incomplete' || this._session.verification?.outcome === 'cancelled')) { return localize('ordito.ai.verification.retry', "Verification Cancelled or Interrupted · Run Tests Again"); }
		const labels = { staged: localize('ordito.ai.staged', "Changes Ready for Review"), passed: localize('ordito.ai.passed', "Tests Passed · Ready to Apply"), failed: localize('ordito.ai.failed', "Verification Failed · Changes Not Applied"), applied: localize('ordito.ai.applied', "Applied · Undo Available"), undone: localize('ordito.ai.undone', "Changes Undone") };
		return labels[this._session.status];
	}

	constructor(
		private readonly host: Pick<OrditoAiWorkflow, 'changed' | 'busy' | 'buildDiagrams' | 'run' | 'info' | 'request' | 'activityStatus'>,
		private readonly connection: OrditoAiConnection,
		@IOrditoProjectService private readonly project: OrditoAiProject,
		@IOrditoCodeService private readonly code: IOrditoCodeService,
		@IQuickInputService private readonly quick: IQuickInputService,
		@INotificationService private readonly notifications: INotificationService,
		@IDialogService private readonly dialogs: IDialogService,
		@IFileService private readonly files: IFileService,
		@IEditorService private readonly editors: IEditorService,
		@IFilesConfigurationService private readonly filesConfiguration: IFilesConfigurationService,
		@IStorageService private readonly storage: IStorageService,
		@IOrditoOperationService private readonly operations: OrditoOperationService
	) {
		super();

	}
	get session(): CollaborationSession | undefined { return this._session; }
	clear(): void { this._session = undefined; }
	followCodeContext(): void { if (this._session && this.code.context && this._session.root !== this.code.context.sourceRoot) { this.clear(); this.host.changed(); } }
}
