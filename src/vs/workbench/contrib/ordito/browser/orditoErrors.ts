import { localize } from '../../../../nls.js';
import { FileOperationError, FileOperationResult } from '../../../../platform/files/common/files.js';
import { type ModelDiagnostic, type SemanticModel } from '../common/modelTypes.js';
import { InvalidSemanticModelError } from '../common/modelValidation.js';
import { diagnosticMessage } from './orditoDiagnostics.js';

export type OrditoErrorContext = 'edit' | 'load' | 'save' | 'code' | 'ai' | 'validation';

/** The same explanation is used in contextual notices and workbench notifications. */
export interface OrditoErrorInfo {
	title: string;
	cause: string;
	resolution: string;
	details?: string;
}

function errorTitle(context: OrditoErrorContext): string {
	switch (context) {
		case 'edit': return localize('ordito.error.edit', "Could Not Complete the Change");
		case 'load': return localize('ordito.error.load', "Could Not Open the Project");
		case 'save': return localize('ordito.error.save', "Could Not Save the Project");
		case 'code': return localize('ordito.error.code', "Could Not Complete the Code Operation");
		case 'ai': return localize('ordito.error.ai', "Could Not Complete the AI Request");
		case 'validation': return localize('ordito.error.validation', "Check the Entered Values");
	}
}

function explainDiagnostic(diagnostic: ModelDiagnostic, model?: SemanticModel): Pick<OrditoErrorInfo, 'cause' | 'resolution'> {
	const name = (id: string) => model?.semantics.elements.find(element => element.id === id)?.name
		?? model?.semantics.relations.find(relation => relation.id === id)?.name
		?? model?.views.find(view => view.id === id)?.name ?? id;
	const [id = '', reason = ''] = diagnostic.args;
	switch (diagnostic.code) {
		case 'shape': return {
			cause: localize('ordito.error.shape.cause', "A value has a missing or unsupported format. Expected: {0}.", id),
			resolution: localize('ordito.error.shape.fix', "Check the values in the form and use the expected format. For an imported model, correct the field identified in Technical Details.")
		};
		case 'duplicateId': return {
			cause: localize('ordito.error.duplicate.cause', "The identifier {0} is used more than once.", id),
			resolution: localize('ordito.error.duplicate.fix', "Use a different identifier for each object. When importing, also update references to the renamed identifier.")
		};
		case 'missingReference': return {
			cause: localize('ordito.error.reference.cause', "The change refers to an object or type that does not exist: {0}.", name(id)),
			resolution: localize('ordito.error.reference.fix', "Choose an existing object or type, or create it before linking it. If it was deleted, undo the deletion or remove its remaining references.")
		};
		case 'incompatibleRelation': return {
			cause: localize('ordito.error.relation.cause', "A {0} relationship cannot connect elements of type {1} and {2}.", id, reason, diagnostic.args[2] ?? ''),
			resolution: localize('ordito.error.relation.fix', "Choose a relationship supported by the diagram notation and by both endpoint types, or choose compatible endpoints.")
		};
		case 'containmentCycle': return {
			cause: localize('ordito.error.cycle.cause', "The parent of {0} would make it contain itself, directly or through other elements.", name(id)),
			resolution: localize('ordito.error.cycle.fix', "Choose a parent outside this element's descendants, or remove the parent assignment.")
		};
		case 'invalidParent': return {
			cause: /\/permissions\//.test(diagnostic.path)
				? localize('ordito.error.actor.cause', "The permission refers to {0}, which is a {1} rather than an actor.", name(id), reason)
				: localize('ordito.error.parent.cause', "The selected parent or feature {0} ({1}) cannot be used in this role.", name(id), reason),
			resolution: /\/permissions\//.test(diagnostic.path)
				? localize('ordito.error.actor.fix', "Choose an actor in the behavior contract's permissions, or create an actor before assigning permissions.")
				: localize('ordito.error.parent.fix', "Choose a compatible parent, or an element of type feature for feature membership. A lifecycle state must belong to a resource, entity or class.")
		};
		case 'missingCriterion': return {
			cause: localize('ordito.error.criterion.cause', "Acceptance criterion {0} is not declared on {1}.", id, name(reason)),
			resolution: localize('ordito.error.criterion.fix', "Select an existing acceptance criterion in the behavior contract, or add it before linking the verification.")
		};
		case 'missingError': return {
			cause: localize('ordito.error.declaredError.cause', "The error {0} is not declared by {1}.", id, name(reason)),
			resolution: localize('ordito.error.declaredError.fix', "Choose an error declared in the source element's behavior contract, add its declaration, or select No Error.")
		};
		case 'viewEndpoint': return {
			cause: localize('ordito.error.endpoint.cause', "The relationship {0} has an endpoint missing from this diagram.", name(id)),
			resolution: localize('ordito.error.endpoint.fix', "Add both endpoint elements to this diagram before including their relationship, or remove the relationship from this diagram.")
		};
		case 'legacyClassification': return {
			cause: localize('ordito.error.legacy.cause', "The imported relationship {0} has not been classified.", name(id)),
			resolution: localize('ordito.error.legacy.fix', "Open Edit Relationship and choose its semantic type before generating code.")
		};
		case 'ownership': return {
			cause: localize('ordito.error.owner.cause', "The architectural owner, lifecycle owner or feature membership of {0} is inconsistent.", name(id)),
			resolution: reason === 'invalidOwner'
				? localize('ordito.error.owner.invalidFix', "In Edit Blueprint, choose a system, container, component, package, class or interface as architectural owner. For a lifecycle state, choose a resource, entity or class.")
				: localize('ordito.error.owner.fix', "In Edit Blueprint, edit architectural ownership separately from feature membership. Choose one compatible owner per element and remove duplicate memberships.")
		};
		case 'assertionConflict': return {
			cause: localize('ordito.error.assertion.cause', "Accepted assertions give conflicting values for the same model fact."),
			resolution: localize('ordito.error.assertion.fix', "Review assertions in Edit Blueprint and keep one consistent accepted value before generating the affected target.")
		};
		case 'c4Scope': return {
			cause: localize('ordito.error.scope.cause', "This C4 diagram's subject or context is missing, hidden or incompatible with its architectural level."),
			resolution: localize('ordito.error.scope.fix', "Edit the diagram scope. Include its subject in the diagram, choose a subject and context compatible with its C4 level and check their architectural owners.")
		};
		case 'contract': return {
			cause: reason === 'requiredInterfaceUnsatisfied'
				? localize('ordito.error.contract.providerCause', "A required interface has no provider connection.")
				: localize('ordito.error.contract.cause', "A type, operation, port or interface contract is inconsistent or incomplete."),
			resolution: reason === 'requiredInterfaceUnsatisfied'
				? localize('ordito.error.contract.providerFix', "Open Edit Blueprint → Interface Connection, choose a provider and map its operations.")
				: localize('ordito.error.contract.fix', "Open Edit Blueprint and check the affected types, operations, ports and interface connections. Use matching types and operation signatures; Technical Details identifies the affected contract.")
		};
		case 'decisionHistory': return {
			cause: localize('ordito.error.decision.cause', "An architectural decision has inconsistent history or replacement links."),
			resolution: localize('ordito.error.decision.fix', "Open Project Decisions and check the decision revision and replacement. Link an existing decision and keep the replacement chain free of cycles.")
		};
	}
}

/** Preserve every diagnostic while separating actionable language from model paths and codes. */
export function describeOrditoError(error: unknown, context: OrditoErrorContext = 'edit', model?: SemanticModel): OrditoErrorInfo {
	const title = errorTitle(context);
	if (error instanceof InvalidSemanticModelError && error.diagnostics.length) {
		const errors = error.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
		const diagnostics = errors.length ? errors : error.diagnostics;
		const explanations = diagnostics.map(diagnostic => explainDiagnostic(diagnostic, model));
		return {
			title,
			cause: [...new Set(explanations.map(explanation => explanation.cause))].join('\n'),
			resolution: [...new Set(explanations.map(explanation => explanation.resolution))].join('\n'),
			details: diagnostics.map(diagnostic => diagnosticMessage(diagnostic, model)).join('\n')
		};
	}
	const properties = error && typeof error === 'object' ? error as { message?: string; code?: string } : undefined;
	const message = error instanceof Error ? error.message : typeof error === 'string' ? error
		: typeof properties?.message === 'string' ? properties.message : String(error ?? '');
	const code = typeof properties?.code === 'string' ? properties.code : '';
	const result = error instanceof FileOperationError ? error.fileOperationResult : undefined;
	const info = (cause: string, resolution: string): OrditoErrorInfo => ({ title, cause, resolution, details: message || undefined });
	if (['EACCES', 'EPERM', 'EROFS', 'NoPermissions'].includes(code) || result === FileOperationResult.FILE_PERMISSION_DENIED || result === FileOperationResult.FILE_WRITE_LOCKED || /\b(?:EACCES|EPERM|permission denied|read.only file|write.locked)\b/i.test(message)) {
		return info(localize('ordito.error.permission.cause', "The file or folder cannot be accessed with the current permissions, or is locked."), localize('ordito.error.permission.fix', "Check the file and folder permissions and release any file lock. You can save a copy in a writable folder."));
	}
	if (code === 'ENOSPC' || /\bENOSPC\b|no space left on device/i.test(message)) {
		return info(localize('ordito.error.disk.cause', "There is not enough free disk space."), localize('ordito.error.disk.fix', "Free some disk space or save a copy on another drive, then save again."));
	}
	if (['ENOENT', 'FileNotFound', 'EntryNotFound'].includes(code) || result === FileOperationResult.FILE_NOT_FOUND || /\bENOENT\b/.test(message)) {
		return info(localize('ordito.error.fileMissing.cause', "A required file or folder no longer exists at the selected path."), localize('ordito.error.fileMissing.fix', "Check whether it was moved or deleted. Open the project from its current folder or restore the missing file, then retry."));
	}
	if (result === FileOperationResult.FILE_MODIFIED_SINCE || result === FileOperationResult.FILE_MOVE_CONFLICT || code === 'EEXIST' || /file.*(?:modified|changed).*disk|save conflict/i.test(message)) {
		return info(localize('ordito.error.diskConflict.cause', "The file changed on disk, or another file already occupies the destination."), localize('ordito.error.diskConflict.fix', "Save a copy of your changes, compare it with the current file on disk, then choose which version to keep."));
	}
	if (result === FileOperationResult.FILE_TOO_LARGE) {
		return info(localize('ordito.error.fileSize.cause', "The file exceeds the supported size limit."), localize('ordito.error.fileSize.fix', "Choose a smaller model or narrow the imported source selection."));
	}
	if (result === FileOperationResult.FILE_INVALID_PATH || result === FileOperationResult.FILE_IS_DIRECTORY || result === FileOperationResult.FILE_NOT_DIRECTORY) {
		return info(localize('ordito.error.path.cause', "The selected path is invalid or is not the expected kind of file or folder."), localize('ordito.error.path.fix', "Choose the project folder when opening a project, or a model JSON file when opening a model."));
	}
	if (error instanceof SyntaxError || /\bJSON\b.*(?:invalid|unexpected|parse)|(?:unexpected token|expected property name|unexpected end).*JSON/i.test(message)) {
		return info(localize('ordito.error.json.cause', "The data could not be read as valid JSON."), localize('ordito.error.json.fix', "Check the JSON syntax at the location in Technical Details. If you edited the model manually, undo that edit or restore a valid copy."));
	}
	if (/Independent business expectations changed/i.test(message)) {
		return info(localize('ordito.error.expectationsChanged.cause', "Independent business expectations changed after the current review was prepared."), localize('ordito.error.expectationsChanged.fix', "Prepare a new review before running verification or applying."));
	}
	if (/Criteria changed\. Open them again\./i.test(message)) {
		return info(localize('ordito.error.criteriaChanged.cause', "The independent test criteria changed while they were being edited."), localize('ordito.error.criteriaChanged.fix', "Open the test criteria again and review their current values before saving. Then prepare a new review before verification or application."));
	}
	if (/The starter criteria changed|The starter data changed or is invalid/i.test(message)) {
		return info(localize('ordito.error.starterChanged.cause', "The saved starter data or criteria changed or is invalid."), localize('ordito.error.starterChanged.fix', "Preserve your existing starter data and criteria before creating another starter. Use a separate empty project if you need a new example."));
	}
	if (/(?:specification|blueprint).*(?:changed|modified)/i.test(message)) {
		return info(localize('ordito.error.specificationChanged.cause', "The specification changed after the simulation or review was prepared."), localize('ordito.error.specificationChanged.fix', "Review the current specification, then run a new simulation or prepare a new review before applying."));
	}
	if (/stale|(?:project|source|context|manifest|snapshot).*(?:changed|modified)|readConflict:|writeConflict:/i.test(message)) {
		return info(localize('ordito.error.stale.cause', "The project or source changed after this operation was prepared."), localize('ordito.error.stale.fix', "Review the current project and reopen the editing form. For code or AI work, run Sync and prepare a new review before applying it."));
	}
	if (/No source element selected/i.test(message)) {
		return info(localize('ordito.error.sourceSelection.cause', "No source element is selected for the new relationship."), localize('ordito.error.sourceSelection.fix', "Select the source element in the diagram, choose Connect, then select a compatible target element."));
	}
	if (/derived from its linked behavior|executableScenarioRequiresDedicatedEditor|activityOrderMustComeFromScenario/i.test(message)) {
		return info(localize('ordito.error.derived.cause', "This diagram's participants and messages come from its linked behavior."), localize('ordito.error.derived.fix', "Edit the linked interaction or scenario to change its participants, messages or order."));
	}
	if (/Resource is outside this state diagram|Unsupported resource transition/i.test(message)) {
		return info(localize('ordito.error.state.cause', "The state or transition does not belong to this diagram's resource lifecycle."), localize('ordito.error.state.fix', "Choose states owned by the same resource and include that resource's lifecycle in the diagram before adding the transition."));
	}
	if (/Unsupported sequence message|Not a sequence diagram/i.test(message)) {
		return info(localize('ordito.error.sequence.cause', "The selected message or diagram does not support a sequence interaction."), localize('ordito.error.sequence.fix', "Use a sequence diagram with compatible message endpoints and message type."));
	}
	if (/Relationship cannot be included in this diagram/i.test(message)) {
		return info(localize('ordito.error.diagramRelation.cause', "The relationship is incompatible with this diagram or its visible endpoints."), localize('ordito.error.diagramRelation.fix', "Include both endpoint elements and choose a relationship supported by this diagram's notation."));
	}
	if (/Unknown (?:element|relation|diagram|node|resource|sequence entry)(?::|$)|unknownObject:|missingViewElement/i.test(message)) {
		return info(localize('ordito.error.objectMissing.cause', "The selected element, relationship or diagram is no longer available."), localize('ordito.error.objectMissing.fix', "Close the form and select an existing object in the current project. If it was deleted by mistake, undo that deletion."));
	}
	if (/architectural ownership and feature membership separately/i.test(message)) {
		return info(localize('ordito.error.separateOwnership.cause', "This model stores architectural ownership separately from feature membership."), localize('ordito.error.separateOwnership.fix', "Use Edit Blueprint to change the architectural owner or feature membership separately."));
	}
	if (/requires? (?:v4|model version 4)|Upgrade the model to version 4|Model version .* is not supported/i.test(message)) {
		return info(localize('ordito.error.version.cause', "This operation is not supported by the model's current version."), localize('ordito.error.version.fix', "Save a copy before upgrading an older model in Project Settings. For a model created by a newer Specsplice version, update the application."));
	}
	if (/(?:folder already contains|folder.*already contains) an A\.D\.E project/i.test(message)) {
		return info(localize('ordito.error.existing.cause', "The chosen folder already contains a Specsplice project."), localize('ordito.error.existing.fix', "Use Open Project to work on it, or choose an empty folder for the new project."));
	}
	if (/engine is out of date|Incompatible code bridge protocol/i.test(message)) {
		return info(localize('ordito.error.engine.cause', "The analysis engine and interface use incompatible versions."), localize('ordito.error.engine.fix', "Update or reinstall the complete application and reopen it. For a development build, run npm run build-fast -- --client-only in the Specsplice repository, then fully quit and reopen Specsplice."));
	}
	if (/Executable not found|Cannot find or execute|Invalid local CLI provider configuration|CLI program name|original CLI by name/i.test(message)) {
		return info(localize('ordito.error.cli.cause', "The configured AI CLI executable could not be found or its configuration is invalid."), localize('ordito.error.cli.fix', "Install the official Codex or Claude Code CLI. In AI Settings → Choose Model and CLI, select its program name or absolute path, then sign in and refresh the account."));
	}
	if (/The selected diagram model is not available in Codex Chat/i.test(message)) {
		return info(localize('ordito.error.codexChatModel.cause', "The selected diagram model is missing from the Codex Chat catalog."), localize('ordito.error.codexChatModel.fix', "Open AI Settings and choose Refresh Account and Models. If your signed-in Codex CLI supports the same model, use Choose Model and CLI to enter its absolute executable path, then retry."));
	}
	if (/unauthorized|not authenticated|not signed in|sign.in failed|authentication (?:failed|required)|\b401\b/i.test(message)) {
		return info(localize('ordito.error.auth.cause', "The AI account is not authenticated or its sign-in has expired."), localize('ordito.error.auth.fix', "Sign in again in AI Settings, then choose Refresh Account and Models before retrying."));
	}
	if (context === 'ai' && /The assistant reached the time limit for this request|The provider (?:CLI did not start responding|stopped responding before completing the request)/i.test(message)) {
		return info(localize('ordito.error.providerTimeout.cause', "The AI provider did not finish before the request timed out."), localize('ordito.error.providerTimeout.fix', "Choose Continue Generation to resume diagram exploration from the saved step. If it happens again, check the AI connection and selected model in AI Settings."));
	}
	if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT'].includes(code) || /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT)\b|fetch failed|network error/i.test(message)) {
		return info(localize('ordito.error.network.cause', "The remote service could not be reached or the connection was interrupted."), localize('ordito.error.network.fix', "Check your network connection and any proxy settings, then retry the request."));
	}
	if (/sessionBudgetIncreaseExceedsLimit/i.test(message)) {
		return info(localize('ordito.error.budgetIncrease.cause', "The requested increase is larger than the remaining capacity for this exploration."), localize('ordito.error.budgetIncrease.fix', "Open Add Exploration Budget again to see the available amounts."));
	}
	if (/request budget allows no AI calls|(?:context|request|session|input|byte|call|preparation).*(?:exceeds|exhausted|budget)|invalidSessionBudget|sessionStorageLimit/i.test(message)) {
		return info(localize('ordito.error.budget.cause', "The request exceeds a configured size, time or AI request limit, or the configured budget is invalid."), localize('ordito.error.budget.fix', "Narrow the selected scope or review the request budget in AI Settings, then prepare the request again."));
	}
	if (/baseline.*(?:dirty|clean)|working (?:tree|directory).*(?:dirty|clean)|uncommitted/i.test(message)) {
		return info(localize('ordito.error.git.cause', "The source workspace has changes that prevent creating a clean baseline."), localize('ordito.error.git.fix', "Save and review your source changes, commit or preserve them, then run Sync and prepare the operation again."));
	}
	if (context === 'validation' && message) {
		return info(message, localize('ordito.error.validation.fix', "Correct the highlighted fields and try saving again."));
	}
	return info(localize('ordito.error.unknown.cause', "The operation failed, but Specsplice could not determine the cause."), context === 'save'
		? localize('ordito.error.unknownSave.fix', "Keep the project open and try Save Copy in a writable folder. If it fails again, copy Technical Details to report the problem.")
		: localize('ordito.error.unknown.fix', "Review the current project and retry the operation. If it fails again, copy Technical Details to report the problem."));
}

/** Notifications retain the same three pieces of information as the contextual component. */
export function orditoErrorNotification(error: unknown, context: OrditoErrorContext = 'edit', model?: SemanticModel): string {
	const info = describeOrditoError(error, context, model);
	return localize('ordito.error.notification', "{0}\nCause: {1}\nHow to resolve: {2}\nTechnical Details: {3}", info.title, info.cause, info.resolution, info.details ?? '');
}
