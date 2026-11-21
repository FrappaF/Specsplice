import './media/orditoCodebaseExploration.css';
import * as dom from '../../../../base/browser/dom.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { type ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { featureCodeProfiles, parseFeatureCodeCases, type FeatureCodeGenerationRun } from '../common/featureCodeGeneration.js';
import { type IOrditoAiService } from './orditoAiService.js';
import { type OrditoControls } from './orditoControls.js';
import { OrditoEditingWizard } from './orditoEditingWizard.js';
import { renderOrditoErrorNotice } from './orditoErrorNotice.js';
import { describeOrditoError } from './orditoErrors.js';
import { OrditoFormDialog } from './orditoFormDialog.js';
import { prependOrditoIcon } from './orditoIcons.js';
import { type OrditoProjectService } from './orditoProjectService.js';

export function hasFeatureCodeReview(run: FeatureCodeGenerationRun | undefined): boolean {
	return !!run?.reviewId && ['ready', 'verified', 'failed', 'applied', 'undone', 'interrupted'].includes(run.status);
}

function featureCodeStatus(run: FeatureCodeGenerationRun, busy: boolean): string {
	switch (run.status) {
		case 'prepared': return localize('ordito.featureCode.prepared', "Feature Plan Ready");
		case 'generating': {
			if (!busy) { return localize('ordito.featureCode.interrupted', "Generation Paused · Checkpoint Saved"); }
			const feature = run.tasks.find(task => task.status !== 'ready');
			return feature ? localize('ordito.featureCode.generatingFeature', "Preparing Code · {0}", feature.name) : localize('ordito.featureCode.generating', "Preparing Code");
		}
		case 'waitingUser': return localize('ordito.featureCode.waiting', "A Feature Needs Your Input");
		case 'ready': return localize('ordito.featureCode.ready', "Changes Ready for Review · Verification Required");
		case 'verified': return run.files.length ? localize('ordito.featureCode.verified', "Verification Passed · Ready to Apply") : localize('ordito.featureCode.verifiedUnchanged', "Verification Passed · No File Changes");
		case 'failed': return run.verification ? localize('ordito.featureCode.verificationFailed', "Verification Failed · Application Blocked") : localize('ordito.featureCode.failed', "Code Generation Needs Attention");
		case 'applied': return localize('ordito.featureCode.applied', "Changes Applied Locally");
		case 'undone': return localize('ordito.featureCode.undone', "Local Changes Undone");
		case 'interrupted': return localize('ordito.featureCode.interrupted', "Generation Paused · Checkpoint Saved");
	}
}

function taskStatus(status: FeatureCodeGenerationRun['tasks'][number]['status']): string {
	switch (status) {
		case 'pending': return localize('ordito.featureCode.taskPending', "Pending");
		case 'running': return localize('ordito.featureCode.taskRunning', "Preparing");
		case 'ready': return localize('ordito.featureCode.taskReady', "Prepared");
		case 'waitingUser': return localize('ordito.featureCode.taskWaiting', "Needs Input");
		case 'failed': return localize('ordito.featureCode.taskFailed', "Needs Attention");
	}
}

function profileLabel(profile: { language: string; runtime: string; framework: string | null }): string {
	return localize('ordito.featureCode.stackValue', "{0} · {1} · {2}", profile.language, profile.runtime, profile.framework ?? localize('ordito.featureCode.noFramework', "No Framework"));
}

function reviewStage(run: FeatureCodeGenerationRun, busy: boolean) {
	switch (run.status) {
		case 'ready': return {
			title: localize('ordito.featureCode.reviewReady', "Changes Ready for Review"),
			description: localize('ordito.featureCode.reviewRequiresVerification', "Run verification before applying the changes."),
			icon: Codicon.checklist, tone: 'active'
		};
		case 'verified': return {
			title: localize('ordito.featureCode.reviewVerified', "Verification Passed"),
			description: run.files.length ? localize('ordito.featureCode.reviewReadyToApply', "Ready to apply to the local project.") : localize('ordito.featureCode.reviewUnchanged', "No file changes to apply."),
			icon: Codicon.pass, tone: 'success'
		};
		case 'failed': return {
			title: run.verification ? localize('ordito.featureCode.reviewVerificationFailed', "Verification Failed") : featureCodeStatus(run, busy),
			description: run.verification ? localize('ordito.featureCode.reviewApplyBlocked', "Verification must pass before you can apply the changes.") : undefined,
			icon: Codicon.warning, tone: 'attention'
		};
		case 'applied': return { title: featureCodeStatus(run, busy), icon: Codicon.check, tone: 'success' };
		case 'interrupted': return {
			title: localize('ordito.featureCode.reviewPaused', "Generation Paused"),
			description: localize('ordito.featureCode.reviewCheckpoint', "A checkpoint was saved for recovery."),
			icon: Codicon.history, tone: 'attention'
		};
		default: return { title: featureCodeStatus(run, busy), icon: Codicon.info, tone: 'ready' };
	}
}

/** User-facing setup and review for the staged AI code workflow. */
export class OrditoFeatureCodeGeneration extends Disposable {
	private readonly dialog = this._register(new MutableDisposable<OrditoEditingWizard | OrditoFormDialog>());
	private configuring = false;

	constructor(private readonly project: OrditoProjectService, private readonly ai: IOrditoAiService, private readonly container: () => HTMLElement) { super(); }

	async configure(): Promise<void> {
		const modelUri = this.project.modelUri?.toString();
		if (this.configuring || this.dialog.value || !modelUri) { return; }
		this.configuring = true;
		try {
			const setup = await this.ai.inspectCodeGeneration();
			if (!setup || this._store.isDisposed || this.project.modelUri?.toString() !== modelUri) { return; }
			const version = this.project.documentVersion;
			if (setup.supportProblem) { throw new Error(setup.supportProblem); }
			if (!setup.profiles.length) { throw new Error(localize('ordito.featureCode.noProfile', "No supported code generation stack was found for this project.")); }
			const title = setup.mode === 'create' ? localize('ordito.featureCode.generate', "Generate Code from Diagrams") : localize('ordito.featureCode.prepareReviewed', "Prepare Reviewed Code Changes");
			const context = localize('ordito.featureCode.destination', "{0} · Destination: {1}", this.project.model.name, this.project.projectRoot?.fsPath ?? modelUri);
			const features = this.project.model.semantics.elements.filter(element => element.kind === 'feature' && (!setup.featureIds || setup.featureIds.includes(element.id)));
			if (!features.length) { throw new Error(localize('ordito.featureCode.noFeatures', "Add a feature with a diagram before preparing code.")); }
			const profiles = setup.profiles.map(profile => ({ id: profile.id, label: profileLabel(profile) }));
			const choices = features.map(feature => ({ id: feature.id, label: feature.name, description: feature.description, picked: true }));
			const wizard = this.dialog.value = new OrditoEditingWizard(this.container(), title);
			const request = await wizard.run(title, context, async () => {
				const profile = await wizard.pick(profiles, {
					title: setup.mode === 'create' ? localize('ordito.featureCode.chooseStack', "Choose Stack") : localize('ordito.featureCode.confirmStack', "Confirm Project Stack"),
					prompt: localize('ordito.featureCode.chooseStackHint', "The stack sets the language, runtime and framework for this generation."),
					activeItem: profiles.find(profile => profile.id === setup.defaultProfileId) ?? profiles[0]
				});
				if (!profile) { return; }
				const selected = await wizard.pick(choices, {
					title: localize('ordito.featureCode.chooseFeatures', "Select Features"),
					prompt: localize('ordito.featureCode.chooseFeaturesHint', "Choose at least one feature. Specsplice prepares each in order and reuses the shared code already staged."),
					canPickMany: true,
					requireSelection: true
				});
				if (!selected?.length) { return; }
				const intent = await wizard.input({ title: localize('ordito.featureCode.intent', "Implementation Notes"), prompt: localize('ordito.featureCode.intentHint', "Optional. Describe constraints or preferences for this generation."), validateInput: async value => value.length > 4000 ? localize('ordito.featureCode.intentLength', "Enter up to 4,000 characters.") : undefined });
				if (intent === undefined) { return; }
				const featureIds = selected.map(feature => feature.id);
				const casesText = await wizard.input({
					title: localize('ordito.featureCode.testCases', "Independent Verification Cases"),
					prompt: localize('ordito.featureCode.testCasesHint', "Enter known inputs and expected results as version 1 JSON, or leave this blank to use .ordito/feature-code-cases.json. Selected feature IDs: {0}.", featureIds.join(', ')),
					placeHolder: JSON.stringify({ version: 1, cases: [{ id: 'example', featureId: featureIds[0], input: {}, expected: {} }] }, null, 2),
					multiline: true,
					summarize: value => value.trim() ? localize('ordito.featureCode.enteredCases', "Use Entered Cases") : localize('ordito.featureCode.projectCases', "Use Project Cases"),
					validateInput: async value => {
						if (!value.trim()) { return; }
						try {
							const cases = parseFeatureCodeCases(value);
							if (featureIds.some(id => !cases.some(test => test.featureId === id))) { return localize('ordito.featureCode.caseCoverage', "Include a case for each selected feature, or leave this field blank to use the project file."); }
						} catch { return localize('ordito.featureCode.invalidCases', "Enter a version 1 JSON object with a cases array. Each case needs a unique id, a featureId, an input and an expected result."); }
						return undefined;
					}
				});
				if (casesText === undefined) { return; }
				return { profileId: profile.id, featureIds, intent: intent.trim() || undefined, ...(casesText.trim() ? { cases: parseFeatureCodeCases(casesText) } : {}) };
			}, {
				heading: localize('ordito.featureCode.reviewSetup', "Review Code Generation"),
				help: localize('ordito.featureCode.reviewSetupHint', "Specsplice prepares these features in a staging area. You review the files, run verification and apply the changes from Code."),
				confirm: localize('ordito.featureCode.prepare', "Prepare Code Changes")
			});
			if (!request) { return; }
			if (this.project.modelUri?.toString() !== modelUri || this.project.documentVersion !== version) { throw new Error(localize('ordito.featureCode.modelChanged', "The model changed during setup. Open code generation again for the current model.")); }
			await this.ai.prepareCodeGeneration(request);
		} finally { this.dialog.clear(); this.configuring = false; }
	}

	async clarify(): Promise<void> {
		const run = this.ai.codeGeneration;
		if (this.dialog.value || !run?.questions?.length) { return; }
		const dialog = this.dialog.value = new OrditoFormDialog(this.container(), { title: localize('ordito.featureCode.clarify', "Answer Clarifications"), description: localize('ordito.featureCode.clarifyHint', "Answer these questions to resume the current feature."), confirmLabel: localize('ordito.featureCode.resume', "Resume Generation") });
		try {
			const questions = dom.append(dialog.body, dom.$('ul'));
			for (const question of run.questions) { dom.append(questions, dom.$('li')).textContent = question; }
			const input = dialog.text(dialog.body, localize('ordito.featureCode.answer', "Answer"), undefined, { multiline: true, required: true });
			const answer = await dialog.open(() => input.value.trim());
			if (answer && this.ai.codeGeneration?.id === run.id) { await this.ai.resumeCodeGeneration(answer); }
		} finally { this.dialog.clear(); }
	}

	renderProgress(parent: HTMLElement, run: FeatureCodeGenerationRun | undefined, controls: OrditoControls, busy: boolean): void {
		if (this.ai.codeGenerationProblem) { renderOrditoErrorNotice(parent, describeOrditoError(this.ai.codeGenerationProblem, 'ai', this.project.model), controls); }
		if (!run) { return; }
		dom.append(parent, dom.$('p.ordito-code-status', { role: 'status' })).textContent = featureCodeStatus(run, busy);
		if (busy && run.status === 'generating') { controls.button(parent, localize('ordito.featureCode.stop', "Stop Generation"), () => this.ai.cancelCodeGeneration(), 'feature-code-stop'); }
		if (!run.tasks.length) { return; }
		const details = controls.details(parent, localize('ordito.featureCode.progressDetails', "Feature Progress"), 'feature-code-progress');
		const list = dom.append(details, dom.$('ol'));
		for (const task of run.tasks) {
			const item = dom.append(list, dom.$('li'));
			item.textContent = localize('ordito.featureCode.taskRow', "{0} · {1}", task.name, taskStatus(task.status));
			for (const gap of task.gaps) { dom.append(item, dom.$('p')).textContent = gap; }
		}
	}

	renderReview(parent: HTMLElement, run: FeatureCodeGenerationRun, controls: OrditoControls, busy: boolean, close: () => void): HTMLElement {
		const title = localize('ordito.featureCode.reviewTitle', "AI Code Review");
		const section = dom.append(parent, dom.$('section.ordito-structural-review.ordito-explore.ordito-feature-code-review', { 'aria-label': title }));
		const header = dom.append(section, dom.$('header.ordito-explore-header'));
		const identity = dom.append(header, dom.$('div.ordito-explore-identity'));
		prependOrditoIcon(dom.append(identity, dom.$('span.ordito-explore-project-icon')), Codicon.codeReview);
		dom.append(dom.append(identity, dom.$('div.ordito-explore-heading')), dom.$('h1')).textContent = title;

		const action = (container: HTMLElement, label: string, icon: ThemeIcon, run: () => void | Promise<void>, id: string, primary = false) => {
			const button = controls.button(container, label, run, id);
			button.classList.add('ordito-explore-button');
			button.classList.toggle('ordito-primary-action', primary);
			prependOrditoIcon(button, icon);
			return button;
		};
		action(header, localize('ordito.featureCode.back', "Back to Code"), Codicon.arrowLeft, close, 'feature-code-back');

		const stage = reviewStage(run, busy);
		const card = dom.append(section, dom.$('div.ordito-explore-card'));
		const stageBody = dom.append(card, dom.$('div.ordito-explore-stage', { 'data-tone': stage.tone }));
		const stageMain = dom.append(stageBody, dom.$('div.ordito-explore-stage-main'));
		prependOrditoIcon(dom.append(stageMain, dom.$('span.ordito-explore-stage-icon')), stage.icon);
		const copy = dom.append(stageMain, dom.$('div.ordito-explore-stage-copy'));
		const status = dom.append(copy, dom.$('div.ordito-explore-live', { role: 'status' }));
		dom.append(status, dom.$('h2')).textContent = stage.title;
		if (stage.description) {
			dom.append(status, dom.$('p')).textContent = stage.description;
		}
		const toolbar = dom.append(stageBody, dom.$('div.ordito-explore-actions', { role: 'group', 'aria-label': localize('ordito.review.actions', "Review Actions") }));
		if (run.status === 'ready' || run.status === 'failed') {
			action(toolbar, localize('ordito.featureCode.verify', "Run Verification"), Codicon.play, () => this.ai.verifyCodeGeneration(), 'feature-code-verify', true).disabled = busy;
		}
		if (run.status === 'failed' && run.verification?.cases?.some(test => !test.passed)) {
			action(toolbar, localize('ordito.featureCode.repair', "Repair Failing Features"), Codicon.wrench, () => this.ai.resumeCodeGeneration(), 'feature-code-repair').disabled = busy;
		}
		if (run.status === 'applied') {
			action(toolbar, localize('ordito.review.undo', "Undo Local Changes"), Codicon.discard, () => this.ai.undoCodeGeneration(), 'feature-code-undo').disabled = busy;
		} else if (run.status === 'interrupted') {
			action(toolbar, localize('ordito.featureCode.recover', "Recover Code Generation"), Codicon.history, () => this.ai.recoverCodeGeneration(), 'feature-code-recover', true).disabled = busy;
		} else if (run.status !== 'undone' && (run.status !== 'verified' || run.files.length > 0)) {
			const verified = run.status === 'verified' && run.verification?.passed === true;
			action(toolbar, localize('ordito.review.publish', "Apply to Project"), Codicon.check, () => this.ai.applyCodeGeneration(), 'feature-code-apply', verified).disabled = busy || !verified;
		}

		const target = dom.append(card, dom.$('dl.ordito-feature-code-context.ordito-feature-code-target'));
		const destination = dom.append(target, dom.$('div'));
		dom.append(destination, dom.$('dt')).textContent = localize('ordito.featureCode.localDestination', "Local Destination");
		dom.append(dom.append(destination, dom.$('dd')), dom.$('code')).textContent = run.root;
		const profile = featureCodeProfiles.find(profile => profile.id === run.profileId);
		if (profile) {
			for (const [label, value] of [
				[localize('ordito.featureCode.language', "Language"), profile.language],
				[localize('ordito.featureCode.runtime', "Runtime"), profile.runtime],
				[localize('ordito.featureCode.framework', "Framework"), profile.framework ?? localize('ordito.featureCode.noFramework', "No Framework")]
			]) {
				const field = dom.append(target, dom.$('div'));
				dom.append(field, dom.$('dt')).textContent = label;
				dom.append(field, dom.$('dd')).textContent = value;
			}
		}

		const body = dom.append(section, dom.$('div.ordito-review-body.ordito-feature-code-evidence'));
		if (this.ai.codeGenerationProblem) { renderOrditoErrorNotice(body, describeOrditoError(this.ai.codeGenerationProblem, 'ai', this.project.model), controls); }
		const model = this.project.model;
		const operationCriteria = model.version === 4 || model.version === 5 ? model.foundation.blueprint?.operations.flatMap(operation => operation.acceptanceCriteria) ?? [] : [];
		const criteria = new Map([...model.semantics.elements.flatMap(element => element.behavior?.acceptanceCriteria ?? []), ...operationCriteria].map(criterion => [criterion.id, criterion.then]));
		const cases = run.verification?.cases ?? [];
		for (const task of run.tasks) {
			const group = dom.append(body, dom.$('section.ordito-explore-card.ordito-feature-code-group'));
			const heading = dom.append(group, dom.$('h3'));
			heading.textContent = task.name;
			prependOrditoIcon(heading, Codicon.symbolEvent);
			const views = (task.diagramIds ?? []).map(id => model.views.find(view => view.id === id)?.name ?? id);
			const acceptance = (task.criterionIds ?? []).map(id => criteria.get(id) ?? id);
			if (views.length || acceptance.length) {
				const context = dom.append(group, dom.$('dl.ordito-feature-code-context'));
				for (const [label, values] of [
					[localize('ordito.featureCode.diagrams', "Diagrams"), views],
					[localize('ordito.featureCode.acceptanceCriteria', "Acceptance Criteria"), acceptance]
				] as const) {
					if (!values.length) { continue; }
					const field = dom.append(context, dom.$('div'));
					dom.append(field, dom.$('dt')).textContent = label;
					const list = dom.append(dom.append(field, dom.$('dd')), dom.$('ul'));
					for (const value of values) {
						dom.append(list, dom.$('li')).textContent = value;
					}
				}
			}
			if (task.gaps.length) {
				const notes = dom.append(group, dom.$('div.ordito-feature-code-block'));
				dom.append(notes, dom.$('h4')).textContent = localize('ordito.featureCode.reviewGaps', "Implementation Notes");
				const list = dom.append(notes, dom.$('ul.ordito-feature-code-notes'));
				for (const gap of task.gaps) {
					dom.append(list, dom.$('li')).textContent = gap;
				}
			}
			const files = run.files.filter(file => file.featureId === task.id);
			if (files.length) {
				const changes = dom.append(group, dom.$('div.ordito-feature-code-block'));
				dom.append(changes, dom.$('h4')).textContent = localize('ordito.featureCode.changedFiles', "Changed Files");
				this.renderFiles(changes, files, controls, busy);
			}
			const featureCases = cases.filter(test => test.featureId === task.id);
			if (featureCases.length) {
				const verification = dom.append(group, dom.$('div.ordito-feature-code-block'));
				dom.append(verification, dom.$('h4')).textContent = localize('ordito.featureCode.verificationCases', "Verification Cases");
				const list = dom.append(verification, dom.$('ul.ordito-explore-views.ordito-feature-code-cases'));
				for (const test of featureCases) {
					const item = dom.append(list, dom.$('li'));
					const row = dom.append(item, dom.$('div.ordito-explore-view'));
					dom.append(row, dom.$('code')).textContent = test.id;
					const result = dom.append(row, dom.$('span.ordito-explore-tag', { 'data-tone': test.passed ? 'success' : 'attention' }));
					result.textContent = test.passed ? localize('ordito.featureCode.casePassed', "Passed") : localize('ordito.featureCode.caseFailed', "Failed");
					if (!test.passed && test.message) {
						dom.append(item, dom.$('p')).textContent = test.message;
					}
				}
			}
			if (!files.length && !views.length && !acceptance.length && !task.gaps.length && !featureCases.length) {
				dom.append(group, dom.$('p')).textContent = localize('ordito.featureCode.noFeatureChanges', "No file changes for this feature.");
			}
		}
		const shared = run.files.filter(file => !file.featureId);
		if (shared.length) {
			const group = dom.append(body, dom.$('section.ordito-explore-card.ordito-feature-code-group'));
			const heading = dom.append(group, dom.$('h3'));
			heading.textContent = localize('ordito.featureCode.sharedFiles', "Shared Project Files");
			prependOrditoIcon(heading, Codicon.files);
			this.renderFiles(group, shared, controls, busy);
		}
		if (run.verification?.output) {
			const details = controls.details(body, localize('ordito.review.results', "Verification Output"), 'feature-code-verification-output');
			const disclosure = details.parentElement!;
			disclosure.classList.add('ordito-explore-details', 'ordito-feature-code-output');
			prependOrditoIcon(disclosure.querySelector('summary')!, Codicon.chevronRight);
			const output = dom.append(details, dom.$('pre', { tabindex: '0' }));
			output.textContent = run.verification.output;
		}
		return section;
	}

	private renderFiles(parent: HTMLElement, files: FeatureCodeGenerationRun['files'], controls: OrditoControls, busy: boolean): void {
		const list = dom.append(parent, dom.$('ul.ordito-explore-views.ordito-feature-code-files'));
		for (const file of files) {
			const item = dom.append(list, dom.$('li'));
			const action = file.kind === 'create' ? localize('ordito.review.create', "Create") : file.kind === 'delete' ? localize('ordito.review.delete', "Delete") : localize('ordito.review.modify', "Modify");
			const name = dom.append(item, dom.$('span.ordito-feature-code-file-name'));
			prependOrditoIcon(name, Codicon.fileCode);
			dom.append(name, dom.$('code')).textContent = file.file;
			dom.append(name, dom.$('span.ordito-explore-tag')).textContent = action;
			const button = controls.button(item, localize('ordito.featureCode.diff', "Open Diff"), () => this.ai.openCodeGenerationDiff(file.file), `feature-code-diff:${file.file}`);
			button.classList.add('ordito-explore-button');
			button.setAttribute('aria-label', localize('ordito.featureCode.diffForFile', "Open Diff for {0}", file.file));
			prependOrditoIcon(button, Codicon.diff);
			button.disabled = busy;
		}
	}
}
