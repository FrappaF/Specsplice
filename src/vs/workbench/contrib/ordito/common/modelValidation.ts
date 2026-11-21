import { containmentKinds, type ElementKind, type ModelDiagnostic, type ModelField, type ObjectKind, type RelationKind, type SemanticElement, type SemanticModel, type SemanticModelV4 } from './modelTypes.js';
import { modelObjects } from './modelFoundation.js';
import { validateBlueprint } from './modelContractValidation.js';
import { checkShape, semanticModelSchema, semanticModelV3Schema, semanticModelV4Schema, semanticModelV5Schema } from './modelSchema.js';
import { acceptsNotationElement, acceptsNotationRelation } from './modelNotation.js';
import { scenarioLayers, scenarioReachability } from './modelScenario.js';

/** Shared ownership rule used by validation and guided editors. */
export function isValidModelOwnership(child: SemanticElement, owner: SemanticElement, role: 'architecture' | 'lifecycle'): boolean {
	const architecturalOwners: readonly ElementKind[] = ['system', 'container', 'component', 'package', 'class', 'interface'];
	return role === 'lifecycle' ? child.kind === 'state' && ['resource', 'entity', 'class'].includes(owner.kind) : architecturalOwners.includes(owner.kind) && !['feature', 'actor', 'state'].includes(child.kind);
}

/** Checks identity, references and ownership independently from target generation rules. */
function validateV4References(value: SemanticModel): ModelDiagnostic[] {
	const model = value as SemanticModelV4;
	const f = model.foundation;
	const diagnostics: ModelDiagnostic[] = [];
	const report = (code: ModelDiagnostic['code'], path: string, ...args: string[]) => diagnostics.push({ code, path, args, severity: 'error' });
	const elements = new Map(model.semantics.elements.map(element => [element.id, element]));
	const objects = modelObjects(model);
	const reference = (kind: ObjectKind, id: string, path: string) => { if (!objects.has(`${kind}:${id}`)) { report('missingReference', path, id); } };
	const unique = (items: { id?: string }[], path: string) => {
		const seen = new Set<string>();
		for (const item of items) { if (item.id && seen.has(item.id)) { report('duplicateId', path, item.id); } if (item.id) { seen.add(item.id); } }
	};
	for (const [key, items] of Object.entries(f)) { if (Array.isArray(items)) { unique(items, `/foundation/${key}`); } }
	unique(f.platform.bindings, '/foundation/platform/bindings');
	const fields: ModelField[] = f.types.flatMap(type => type.fields);
	const operations: { id?: string }[] = [];
	for (const [elementIndex, element] of model.semantics.elements.entries()) {
		const elementPath = `/semantics/elements/${elementIndex}`;
		if (element.scope && element.kind !== 'system') { report('ownership', `${elementPath}/scope`, element.id, 'systemScopeOnly'); }
		if (element.behavior) { operations.push(element.behavior); fields.push(...element.behavior.inputs, ...element.behavior.outputs); }
		for (const member of element.details?.members ?? []) { if (member.kind === 'method') { operations.push(member); } else { fields.push(member); } }
		for (const [section, members] of [['behavior/inputs', element.behavior?.inputs ?? []], ['behavior/outputs', element.behavior?.outputs ?? []], ['details/members', element.details?.members ?? []]] as const) {
			members.forEach((member, index) => { if (member.typeId) { reference('type', member.typeId, `${elementPath}/${section}/${index}/typeId`); } });
		}
	}
	unique(fields, '/fields'); unique(operations, '/operations');
	for (const type of f.types) { for (const field of type.fields) { if (field.typeId) { reference('type', field.typeId, `/foundation/types/${type.id}/fields/${field.id}/typeId`); } } }
	const ownership = new Map<string, string>();
	for (const entry of f.ownership) {
		const path = `/foundation/ownership/${entry.id}`;
		reference('element', entry.elementId, path + '/elementId'); reference('element', entry.ownerId, path + '/ownerId');
		if (ownership.has(entry.elementId)) { report('ownership', path, entry.elementId, 'multipleOwners'); }
		ownership.set(entry.elementId, entry.ownerId);
		const owner = elements.get(entry.ownerId); const child = elements.get(entry.elementId);
		if (owner && child && !isValidModelOwnership(child, owner, entry.role)) { report('ownership', path, entry.elementId, 'invalidOwner'); }
	}
	for (const entry of f.ownership) {
		const seen = new Set([entry.elementId]); let owner: string | undefined = entry.ownerId;
		while (owner) { if (seen.has(owner)) { report('containmentCycle', `/foundation/ownership/${entry.id}`, entry.elementId); break; } seen.add(owner); owner = ownership.get(owner); }
	}
	const memberships = new Set<string>();
	for (const entry of f.memberships) {
		const path = `/foundation/memberships/${entry.id}`;
		reference('element', entry.elementId, path + '/elementId'); reference('element', entry.featureId, path + '/featureId');
		if (elements.get(entry.featureId)?.kind !== 'feature') { report('ownership', path, entry.featureId, 'expectedFeature'); }
		const key = `${entry.featureId}:${entry.elementId}`; if (memberships.has(key)) { report('ownership', path, entry.elementId, 'duplicateMembership'); } memberships.add(key);
	}
	for (const entry of f.integrations) {
		const path = `/foundation/integrations/${entry.id}`;
		reference('element', entry.consumerId, path + '/consumerId'); reference('element', entry.externalId, path + '/externalId');
		if (elements.get(entry.externalId)?.scope !== 'external') { report('ownership', path, entry.externalId, 'expectedExternal'); }
	}
	for (const topology of f.messaging ?? []) {
		const path = `/foundation/messaging/${topology.id}`;
		for (const broker of topology.brokers) { reference('element', broker.elementId, path + '/brokers'); }
		for (const message of topology.messages) { reference('type', message.payloadTypeId, path + '/messages'); }
		for (const binding of [...topology.publishers, ...topology.subscriptions]) { reference('element', binding.ownerId, path + '/bindings'); reference('operation', binding.operationId, path + '/bindings'); }
	}
	for (const view of model.views.filter(view => view.messagingId)) { reference('messaging', view.messagingId!, `/views/${view.id}/messagingId`); }
	for (const machine of f.stateMachines ?? []) { const path = `/foundation/stateMachines/${machine.id}`; reference('element', machine.ownerId, path + '/ownerId'); reference('operation', machine.operationId, path + '/operationId'); for (const state of machine.states) { reference('element', state.elementId, path + '/states'); } for (const event of machine.events) { reference('operation', event.operationId, path + '/events'); } for (const action of machine.actions) { reference('interaction', action.interactionId, path + '/actions'); } }
	for (const view of model.views.filter(view => view.stateMachineId)) { reference('stateMachine', view.stateMachineId!, `/views/${view.id}/stateMachineId`); if (view.kind !== 'state') { report('contract', `/views/${view.id}`, view.id, 'stateViewKind'); } }
	for (const view of model.views.filter(view => view.interactionId)) { reference('interaction', view.interactionId!, `/views/${view.id}/interactionId`); if (view.kind !== 'sequence' && !(model.version === 5 && view.kind === 'activity' && f.interactions.some(interaction => interaction.id === view.interactionId && interaction.profile === 'descriptive'))) { report('contract', `/views/${view.id}`, view.id, 'interactionViewKind'); } }
	for (const entry of f.occurrences) {
		const path = `/foundation/occurrences/${entry.id}`;
		if (entry.profile !== 'descriptive') { reference('operation', entry.operationId ?? '', path + '/operationId'); } reference('element', entry.from, path + '/from'); reference('element', entry.to, path + '/to');
		const target = elements.get(entry.to);
		if (target && entry.profile !== 'descriptive' && !entry.messagingBindingId && !f.blueprint?.operations.some(operation => operation.id === entry.operationId && (operation.ownerId === target.id || f.blueprint?.ports.some(port => port.elementId === target.id && port.direction === 'provided' && f.blueprint?.interfaces.some(contract => contract.id === port.interfaceId && contract.operationIds.includes(operation.id)))) ) && target.behavior?.id !== entry.operationId && !target.details?.members.some(member => member.kind === 'method' && member.id === entry.operationId)) { report('ownership', path, entry.operationId ?? '', 'operationOwner'); }
	}
	for (const occurrence of f.occurrences.filter(entry => entry.messagingBindingId)) {
		const publishers = (f.messaging ?? []).flatMap(topology => topology.publishers.filter(binding => binding.id === occurrence.messagingBindingId).map(binding => ({ topology, binding }))), subscriptions = (f.messaging ?? []).flatMap(topology => topology.subscriptions.filter(binding => binding.id === occurrence.messagingBindingId).map(binding => ({ topology, binding })));
		const matches = [...publishers, ...subscriptions];
		if (matches.length !== 1) { report('missingReference', `/foundation/occurrences/${occurrence.id}`, occurrence.messagingBindingId!); }
		else { const { topology, binding } = matches[0], broker = topology.brokers.find(broker => broker.id === topology.channels.find(channel => channel.id === binding.channelId)?.brokerId), publishing = publishers.length === 1; if (occurrence.operationId !== binding.operationId || occurrence.from !== (publishing ? binding.ownerId : broker?.elementId) || occurrence.to !== (publishing ? broker?.elementId : binding.ownerId) || occurrence.execution) { report('contract', `/foundation/occurrences/${occurrence.id}`, occurrence.id, 'messagingDirection'); } }
	}
	for (const machine of f.stateMachines ?? []) { for (const event of machine.events.filter(event => event.subscriptionId)) { const subscriptions = (f.messaging ?? []).flatMap(topology => topology.subscriptions.filter(sub => sub.id === event.subscriptionId)); if (subscriptions.length !== 1 || subscriptions[0].operationId !== event.operationId) { report('contract', `/foundation/stateMachines/${machine.id}`, event.id, 'messagingEventContract'); } } }
	for (const entry of f.frames) { for (const id of entry.occurrenceIds) { reference('occurrence', id, `/foundation/frames/${entry.id}/occurrenceIds`); } }
	for (const entry of f.interactions) {
		const path = `/foundation/interactions/${entry.id}`;
		if (entry.ownerId) { reference('element', entry.ownerId, path + '/ownerId'); }
		for (const id of entry.occurrenceIds) { reference('occurrence', id, path + '/occurrenceIds'); }
		for (const id of entry.frameIds) { reference('frame', id, path + '/frameIds'); }
		if (entry.legacyViewId && !model.views.some(view => view.id === entry.legacyViewId && view.kind === 'sequence')) { report('missingReference', path + '/legacyViewId', entry.legacyViewId); }
		for (const id of entry.legacyRelationOrder ?? []) { reference('relation', id, path + '/legacyRelationOrder'); }
	}
	for (const binding of f.platform.bindings) { reference('element', binding.elementId, `/foundation/platform/bindings/${binding.id}/elementId`); }
	for (const entry of f.migration?.unresolvedOwnershipIds ?? []) { reference('element', entry, '/foundation/migration/unresolvedOwnershipIds'); }
	unique(f.tasks ?? [], '/foundation/tasks');
	for (const task of f.tasks ?? []) {
		reference(task.target.kind, task.target.id, `/foundation/tasks/${task.id}/target`);
		const revisions = [task.revision, ...task.history.map(entry => entry.revision)];
		if (new Set(revisions).size !== revisions.length) { report('contract', `/foundation/tasks/${task.id}/revision`, task.id, 'duplicateIntentRevision'); }
	}
	const assertions = new Map<string, string>();
	for (const assertion of f.assertions) {
		const path = `/foundation/assertions/${assertion.id}`;
		reference(assertion.subject.kind, assertion.subject.id, path + '/subject');
		if (assertion.acceptance.status === 'accepted') {
			const key = `${assertion.subject.kind}:${assertion.subject.id}:${assertion.field}`; const serialized = JSON.stringify(assertion.value.state === 'known' ? ['known', assertion.value.value] : assertion.value.state === 'unknown' ? ['unknown', assertion.value.reason] : ['omitted']);
			if (assertions.has(key) && assertions.get(key) !== serialized) { report('assertionConflict', path, assertion.subject.id, assertion.field); } assertions.set(key, serialized);
		}
	}
	for (const decision of f.decisions) {
		const path = `/foundation/decisions/${decision.id}`;
		for (const id of decision.scopeIds) { reference('element', id, path + '/scopeIds'); }
		unique(decision.constraints, path + '/constraints');
		for (const constraint of decision.constraints) { reference(constraint.subject.kind, constraint.subject.id, path + `/constraints/${constraint.id}/subject`); }
	}
	diagnostics.push(...validateBlueprint(model));
	return diagnostics;
}

/** Syntax is shared with the provider grammar; invalid references remain inspectable drafts. */
export function validateSemanticShape(value: unknown): ModelDiagnostic[] {
	const diagnostics: ModelDiagnostic[] = [];
	const version = value !== null && typeof value === 'object' && Object.hasOwn(value, 'version') ? (value as { version: number }).version : undefined;
	checkShape(value, version === 5 ? semanticModelV5Schema : version === 4 ? semanticModelV4Schema : version === 3 ? semanticModelV3Schema : semanticModelSchema, '', diagnostics);
	return diagnostics;
}

/** A draft may be incomplete or referentially invalid, but must retain an unambiguous JSON shape. */
export function readSemanticDraft(value: unknown): SemanticModel {
	const diagnostics = validateSemanticShape(value);
	if (diagnostics.length) { throw new InvalidSemanticModelError(diagnostics); }
	return structuredClone(value as SemanticModel);
}

const callers: readonly ElementKind[] = ['actor', 'view', 'component', 'controller', 'action', 'system', 'container', 'class', 'process'];

const executors: readonly ElementKind[] = ['component', 'controller', 'action', 'system', 'container', 'class', 'process'];

/** The compatibility matrix is shared by validation and future visual editors. */
export function isCompatibleRelation(kind: RelationKind, from: ElementKind, to: ElementKind): boolean {
	switch (kind) {
		case 'dependency': return true;
		case 'invocation': return callers.includes(from) && [...executors, 'contract', 'interface', 'view'].includes(to);
		case 'read':
		case 'write': return executors.includes(from) && ['resource', 'entity', 'table', 'dataStore'].includes(to);
		case 'transition': return from === 'state' && to === 'state';
		case 'realization': return ['component', 'controller', 'action', 'resource', 'view'].includes(from) && ['feature', 'contract', 'interface'].includes(to);
		case 'association': return ['entity', 'table', 'class', 'interface', 'actor', 'useCase', 'resource'].includes(from) && ['entity', 'table', 'class', 'interface', 'actor', 'useCase', 'resource'].includes(to);
		case 'inheritance': return ['class', 'interface'].includes(from) && ['class', 'interface'].includes(to);
		case 'composition':
		case 'aggregation': return ['class', 'entity', 'component', 'package', 'system', 'container'].includes(from) && ['class', 'entity', 'component', 'package', 'container', 'interface', 'resource'].includes(to);
		case 'implementation': return ['class', 'component', 'container'].includes(from) && ['interface', 'contract'].includes(to);
		case 'hosting': return ['deploymentNode', 'networkNode'].includes(from) && ['deploymentNode', 'networkNode', 'artifact', 'container', 'resource', 'dataStore'].includes(to);
		case 'communication': return ['actor', 'system', 'container', 'component', 'deploymentNode', 'networkNode', 'resource', 'dataStore'].includes(from) && ['actor', 'system', 'container', 'component', 'deploymentNode', 'networkNode', 'resource', 'dataStore'].includes(to);
		case 'controlFlow': return ['actor', 'view', 'controller', 'action', 'decision', 'process', 'start'].includes(from) && ['view', 'controller', 'action', 'decision', 'process', 'end'].includes(to);
		case 'dataFlow': return ['actor', 'system', 'process', 'dataStore', 'resource'].includes(from) && ['actor', 'system', 'process', 'dataStore', 'resource'].includes(to) && (from === 'process' || to === 'process');
		case 'include':
		case 'extend': return from === 'useCase' && to === 'useCase';
	}
}

/** Validates structure first, then graph references, containment and evidence. */
export function validateSemanticModel(value: unknown): ModelDiagnostic[] {
	const diagnostics = validateSemanticShape(value);
	if (diagnostics.length) {
		return diagnostics;
	}
	const model = value as SemanticModel;
	const { elements, relations } = model.semantics;
	const byId = new Map(elements.map(element => [element.id, element]));
	const relationById = new Map(relations.map(relation => [relation.id, relation]));
	const report = (code: ModelDiagnostic['code'], path: string, ...args: string[]) => diagnostics.push({ code, severity: 'error', path, args });
	const unique = (ids: string[], path: string) => {
		const seen = new Set<string>();
		ids.forEach((id, index) => {
			if (seen.has(id)) {
				report('duplicateId', `${path}/${index}`, id);
			}
			seen.add(id);
		});
	};
	// Entity namespaces are separate; references always declare their namespace.
	unique(elements.map(item => item.id), '/semantics/elements');
	unique(relations.map(item => item.id), '/semantics/relations');
	unique(model.views.map(item => item.id), '/views');
	unique(model.codeMappings.map(item => item.id), '/codeMappings');
	unique(model.verifications.map(item => item.id), '/verifications');
	const reference = (id: string, path: string) => {
		const element = byId.get(id);
		if (!element) {
			report('missingReference', path, id);
		}
		return element;
	};
	elements.forEach((element, index) => {
		const path = `/semantics/elements/${index}`;
		if (element.parentId) {
			const parent = reference(element.parentId, `${path}/parentId`);
			if (parent && !containmentKinds.includes(parent.kind)) {
				report('invalidParent', `${path}/parentId`, parent.id, parent.kind);
			}
			const seen = new Set([element.id]);
			let current: SemanticElement | undefined = element;
			while (current?.parentId) {
				if (seen.has(current.parentId)) {
					report('containmentCycle', `${path}/parentId`, element.id);
					break;
				}
				seen.add(current.parentId);
				current = byId.get(current.parentId);
			}
		}
		if (element.details) {
			unique(element.details.members.map(member => `${member.kind}:${member.name}:${member.kind === 'method' ? member.type : ''}`), `${path}/details/members`);
			for (const member of element.details.members) { if (member.kind === 'method' && member.key !== 'none' || element.kind === 'table' && member.kind !== 'attribute') { report('shape', `${path}/details/members`, 'Keys describe attributes; physical tables contain columns, not methods'); } }
		}
		if (element.behavior) {
			const behavior = element.behavior;
			unique(behavior.inputs.map(field => field.name), `${path}/behavior/inputs`);
			unique(behavior.outputs.map(field => field.name), `${path}/behavior/outputs`);
			unique(behavior.errors.map(error => error.code), `${path}/behavior/errors`);
			unique(behavior.acceptanceCriteria.map(criterion => criterion.id), `${path}/behavior/acceptanceCriteria`);
			behavior.permissions.forEach((permission, permissionIndex) => {
				const actor = reference(permission.actorId, `${path}/behavior/permissions/${permissionIndex}/actorId`);
				if (actor && actor.kind !== 'actor') {
					report('invalidParent', `${path}/behavior/permissions/${permissionIndex}/actorId`, actor.id, actor.kind);
				}
			});
		}
	});
	relations.forEach((relation, index) => {
		const path = `/semantics/relations/${index}`;
		const from = reference(relation.from, `${path}/from`);
		const to = reference(relation.to, `${path}/to`);
		if (from && to && (!isCompatibleRelation(relation.kind, from.kind, to.kind) || (relation.kind === 'transition' && from.parentId !== to.parentId))) {
			report('incompatibleRelation', path, relation.kind, from.kind, to.kind);
		}
		if (relation.details && from && to) {
			for (const [endpoint, member] of [[from, relation.details.sourceMember], [to, relation.details.targetMember]] as const) { if (member && !endpoint.details?.members.some(item => item.name === member)) { report('missingReference', `${path}/details`, endpoint.id, member); } }
		}
		if (from && relation.errorCode && !from.behavior?.errors.some(error => error.code === relation.errorCode)) {
			report('missingError', `${path}/errorCode`, relation.errorCode, from.id);
		}
		if (relation.classification) {
			diagnostics.push({ code: 'legacyClassification', severity: 'warning', path, args: [relation.id] });
		}
	});
	model.views.forEach((view, index) => {
		const path = `/views/${index}`;
		for (const node of view.nodes) { const element = byId.get(node.elementId); if (element && !(model.version === 5 && view.kind === 'activity' && view.interactionId) && !((model.version === 4 || model.version === 5) && (view.contextIds?.includes(element.id) || view.subjectId === element.id)) && !acceptsNotationElement(view.kind, element)) { report('shape', path, `Unsupported ${element.kind} in ${view.kind}`); } }
		for (const id of view.relationIds) { const relation = relationById.get(id); if (relation && !((model.version === 4 || model.version === 5) && view.subjectId && ['invocation', 'dependency', 'communication'].includes(relation.kind)) && !acceptsNotationRelation(view.kind, relation)) { report('shape', path, `Unsupported ${relation.kind} in ${view.kind}`); } }
		if (view.featureId) {
			const feature = reference(view.featureId, `${path}/featureId`);
			if (feature && feature.kind !== 'feature') { report('invalidParent', `${path}/featureId`, feature.id, feature.kind); }
		}
		unique(view.nodes.map(node => node.elementId), `${path}/nodes`);
		unique(view.relationIds, `${path}/relationIds`);
		const nodeIds = new Set(view.nodes.map(node => node.elementId));
		view.nodes.forEach((node, nodeIndex) => reference(node.elementId, `${path}/nodes/${nodeIndex}/elementId`));
		view.relationIds.forEach((id, relationIndex) => {
			const relation = relationById.get(id);
			if (!relation) {
				report('missingReference', `${path}/relationIds/${relationIndex}`, id);
			} else if (!nodeIds.has(relation.from) || !nodeIds.has(relation.to)) {
				report('viewEndpoint', `${path}/relationIds/${relationIndex}`, id);
			}
		});
	});
	model.codeMappings.forEach((mapping, index) => reference(mapping.elementId, `/codeMappings/${index}/elementId`));
	model.verifications.forEach((verification, index) => {
		const path = `/verifications/${index}`;
		const element = reference(verification.elementId, `${path}/elementId`);
		if (element && !element.behavior?.acceptanceCriteria.some(criterion => criterion.id === verification.criterionId)) {
			report('missingCriterion', `${path}/criterionId`, verification.criterionId, element.id);
		}
	});
	if ((model.version === 4 || model.version === 5)) { diagnostics.push(...validateV4References(model), ...validateExploration(model)); }
	return diagnostics;
}

export class InvalidSemanticModelError extends Error {
	readonly diagnostics: ModelDiagnostic[];
	constructor(diagnostics: ModelDiagnostic[]) {
		super('Invalid Specsplice semantic model');
		this.diagnostics = diagnostics;
	}
}

/** A validating boundary; successful return always yields a detached snapshot. */
export function readSemanticModel(value: unknown): SemanticModel {
	const diagnostics = validateSemanticModel(value);
	if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
		throw new InvalidSemanticModelError(diagnostics);
	}
	return structuredClone(value as SemanticModel);
}

/** Integrity and descriptive fidelity are independent of executable readiness. */
export function validateExploration(model: SemanticModelV4): ModelDiagnostic[] {
	if (model.version !== 5) { return []; }
	const diagnostics: ModelDiagnostic[] = [];
	const report = (code: ModelDiagnostic['code'], path: string, ...args: string[]) => diagnostics.push({ code, severity: 'error', path, args });
	const evidence = new Map((model.foundation.evidence ?? []).map(entry => [entry.id, entry]));
	if (evidence.size !== (model.foundation.evidence ?? []).length) { report('duplicateId', '/foundation/evidence', 'evidence'); }
	const anchors = (ids: string[], path: string) => { for (const id of ids) { if (!evidence.has(id)) { report('missingReference', path, id); } } };
	for (const entry of evidence.values()) {
		if (entry.start > entry.end || !/^[a-f0-9]{64}$/.test(entry.revision) || /[\\\x00]/.test(entry.file) || entry.file.startsWith('/') || entry.file.split('/').some(part => !part || part === '..' || part === '.')) { report('contract', '/foundation/evidence/' + entry.id, 'sourceAnchor'); }
	}
	for (const assertion of model.foundation.assertions) { anchors(assertion.evidenceIds ?? [], '/foundation/assertions/' + assertion.id); }
	const elements = new Set(model.semantics.elements.map(entry => entry.id));
	const occurrences = new Map(model.foundation.occurrences.map(entry => [entry.id, entry]));
	const ownership = new Set<string>();
	for (const interaction of model.foundation.interactions.filter(entry => entry.profile === 'descriptive')) {
		const path = '/foundation/interactions/' + interaction.id, description = interaction.description;
		if (!description || interaction.execution) { report('contract', path, 'descriptiveProfile'); continue; }
		anchors(description.evidenceIds, path);
		for (const id of description.participantIds) { if (!elements.has(id)) { report('missingReference', path, id); } }
		const local = new Set(interaction.occurrenceIds);
		if (local.size !== interaction.occurrenceIds.length) { report('duplicateId', path, 'occurrence'); }
		for (const id of local) {
			const call = occurrences.get(id);
			if (ownership.has(id)) { report('ownership', path, id); } ownership.add(id);
			if (!call || call.profile !== 'descriptive' || call.execution || !description.participantIds.includes(call.from) || !description.participantIds.includes(call.to)) { report('contract', path, id, 'descriptiveOccurrence'); }
			if (call) { anchors(call.evidenceIds ?? [], path + '/' + id); }
		}
		for (const edge of description.order) {
			if (!local.has(edge.before) || !local.has(edge.after) || edge.before === edge.after) { report('missingReference', path + '/order', edge.before, edge.after); }
			anchors(edge.evidenceIds, path + '/order');
			if (edge.basis !== 'authored' && !edge.evidenceIds.length) { report('contract', path + '/order', 'orderEvidenceRequired'); }
		}
		if (local.size && !scenarioLayers(interaction).length) { report('containmentCycle', path + '/order', interaction.id); }
		const reachability = scenarioReachability(interaction), framed = new Set<string>();
		for (const id of interaction.frameIds) {
			const frame = model.foundation.frames.find(entry => entry.id === id);
			if (!frame || frame.kind !== 'unspecified' || !frame.description) { report('contract', path + '/frames', id, 'descriptiveFrame'); continue; }
			const frameSteps = new Set<string>();
			if (frame.description.operands.length < (['alt', 'par'].includes(frame.description.operator) ? 2 : 1)) { report('contract', path + '/frames/' + id, 'descriptiveFrameArity'); }
			for (const operand of frame.description.operands) {
				anchors(operand.evidenceIds, path + '/frames/' + id);
				for (const step of operand.steps) { if (!local.has(step) || framed.has(step)) { report('contract', path + '/frames/' + id, step, 'operandOwnership'); } framed.add(step); frameSteps.add(step); }
			}
			if (frame.description.operator === 'alt') {
				for (const operand of frame.description.operands) {
					const others = frame.description.operands.filter(other => other.id !== operand.id).flatMap(other => other.steps);
					if (operand.steps.some(step => others.some(other => reachability.get(step)?.has(other)))) { report('contract', path + '/order', 'exclusiveBranchesCannotBeOrdered'); }
				}
			}
			if (frame.occurrenceIds.length !== frameSteps.size || frame.occurrenceIds.some(id => !frameSteps.has(id))) { report('contract', path + '/frames/' + id, 'frameCoverage'); }
		}
	}
	for (const view of model.views) {
		if (['sequence', 'activity'].includes(view.kind) && view.spec && !view.interactionId) { report('contract', '/views/' + view.id, 'scenarioRequired'); }
		if (!view.interactionId) { continue; }
		const scenario = model.foundation.interactions.find(entry => entry.id === view.interactionId);
		if (scenario?.profile !== 'descriptive') { continue; }
		const visible = new Set(view.nodes.map(node => node.elementId));
		for (const id of scenario.description?.participantIds ?? []) { if (!visible.has(id)) { report('viewEndpoint', '/views/' + view.id, id); } }
	}
	return diagnostics;
}
