import { elementKinds, relationKinds, type ModelDiagnostic, type Schema, viewKinds } from './modelTypes.js';

export function object(properties: Record<string, Schema>, optional: string[] = []): Schema {
	return { type: 'object', properties, required: Object.keys(properties).filter(key => !optional.includes(key)), additionalProperties: false };
}

export function array(items: Schema): Schema { return { type: 'array', items }; }

export const text: Schema = { type: 'string' };

export const nonempty: Schema = { type: 'string', minLength: 1, pattern: '\\S' };

export const identifier: Schema = { type: 'string', minLength: 1, pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]*$' };

export function checkShape(value: unknown, schema: Schema, path: string, diagnostics: ModelDiagnostic[]): void {
	if (schema.anyOf) {
		if (!schema.anyOf.some(branch => { const errors: ModelDiagnostic[] = []; checkShape(value, branch, path, errors); return errors.length === 0; })) { diagnostics.push({ code: 'shape', severity: 'error', path, args: ['union'] }); }
		return;
	}
	if (schema.type === 'null') {
		if (value !== null) { diagnostics.push({ code: 'shape', severity: 'error', path, args: ['null'] }); }
		return;
	}
	const fail = (expected: string) => diagnostics.push({ code: 'shape', severity: 'error', path, args: [expected] });
	if (schema.type === 'object') {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			fail('object');
			return;
		}
		const record = value as Record<string, unknown>;
		for (const key of schema.required ?? []) {
			if (!Object.hasOwn(record, key)) {
				diagnostics.push({ code: 'shape', severity: 'error', path: `${path}/${key}`, args: ['required'] });
			}
		}
		for (const [key, child] of Object.entries(record)) {
			if (Object.hasOwn(schema.properties ?? {}, key)) {
				checkShape(child, schema.properties![key], `${path}/${key}`, diagnostics);
			} else if (schema.additionalProperties === false) {
				diagnostics.push({ code: 'shape', severity: 'error', path: `${path}/${key}`, args: ['unexpected property'] });
			}
		}
	} else if (schema.type === 'array') {
		if (!Array.isArray(value)) {
			fail('array');
			return;
		}
		value.forEach((child, index) => checkShape(child, schema.items!, `${path}/${index}`, diagnostics));
	} else {
		const expected = schema.type === 'integer' ? 'number' : schema.type;
		if (typeof value !== expected || (typeof value === 'number' && (!Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))))) {
			fail(schema.type!);
			return;
		}
		if (typeof value === 'number' && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum)) { fail('range'); }
		if (schema.const !== undefined && value !== schema.const) {
			fail(String(schema.const));
		}
		if (schema.enum && !schema.enum.includes(value as string)) {
			fail(schema.enum.join(' | '));
		}
		if (typeof value === 'string' && ((schema.minLength !== undefined && value.length < schema.minLength) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) {
			fail(schema.pattern ?? `minLength ${schema.minLength}`);
		}
	}
}

export const knowledgeSchema: Schema = { anyOf: [
	object({ state: { type: 'string', enum: ['unknown'] }, reason: nonempty }),
	object({ state: { type: 'string', enum: ['omitted'] } }),
	object({ state: { type: 'string', enum: ['known'] }, value: { anyOf: [{ type: 'null' }, text, { type: 'number' }, { type: 'boolean' }] } })
] };

export const predicateSchema: Schema = object({ id: identifier, version: { type: 'integer', const: 1 }, operationId: identifier, phase: { type: 'string', enum: ['pre', 'post'] }, rootId: identifier, nodes: array({ anyOf: [
	object({ id: identifier, kind: { type: 'string', const: 'literal' }, typeId: identifier, value: { anyOf: [text, { type: 'number' }, { type: 'boolean' }, { type: 'null' }] } }),
	object({ id: identifier, kind: { type: 'string', const: 'reference' }, fieldId: identifier, path: array(identifier) }),
	object({ id: identifier, kind: { type: 'string', const: 'compare' }, operator: { type: 'string', enum: ['eq', 'ne', 'lt', 'le', 'gt', 'ge'] }, left: identifier, right: identifier }),
	object({ id: identifier, kind: { type: 'string', const: 'logic' }, operator: { type: 'string', enum: ['and', 'or', 'not'] }, operands: array(identifier) }),
	object({ id: identifier, kind: { type: 'string', const: 'check' }, operator: { type: 'string', enum: ['present', 'isNull'] }, operand: identifier }),
	object({ id: identifier, kind: { type: 'string', const: 'arithmetic' }, operator: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide', 'remainder'] }, left: identifier, right: identifier }),
	object({ id: identifier, kind: { type: 'string', const: 'collection' }, operator: { type: 'string', const: 'count' }, operand: identifier, typeId: identifier }),
	object({ id: identifier, kind: { type: 'string', const: 'collection' }, operator: { type: 'string', enum: ['any', 'every'] }, operand: identifier, value: identifier, comparison: { type: 'string', enum: ['eq', 'ne', 'lt', 'le', 'gt', 'ge'] } })
] }) });

export const expressionSchema: Schema = object({ version: { type: 'integer', const: 1 }, rootId: identifier, nodes: predicateSchema.properties!.nodes });

const argumentSchema = object({ fieldId: identifier, expression: expressionSchema });

const stepsSchema = array(identifier);

const frameFields = { id: identifier, occurrenceIds: array(identifier) };

const frameSchema: Schema = { anyOf: [
	object({ ...frameFields, kind: { type: 'string', const: 'unspecified' } }),
	object({ ...frameFields, kind: { type: 'string', const: 'alt' }, selection: { type: 'string', const: 'exclusive' }, operands: array(object({ id: identifier, guard: { anyOf: [expressionSchema, { type: 'null' }] }, steps: stepsSchema })) }),
	object({ ...frameFields, kind: { type: 'string', const: 'opt' }, guard: expressionSchema, steps: stepsSchema }),
	object({ ...frameFields, kind: { type: 'string', const: 'loop' }, guard: expressionSchema, steps: stepsSchema, iterationId: identifier, iterationTypeId: identifier, maxIterations: { type: 'integer', minimum: 1, maximum: 1000 }, limit: { type: 'string', const: 'error' } }),
	object({ ...frameFields, kind: { type: 'string', const: 'par' }, operands: array(object({ id: identifier, steps: stepsSchema })), join: { type: 'string', const: 'all' }, failure: { type: 'string', enum: ['cancel', 'collect'] }, resultOrder: { type: 'string', const: 'declared' }, resultId: identifier }),
	object({ ...frameFields, kind: { type: 'string', const: 'critical' }, resource: nonempty, scope: { type: 'string', const: 'interaction' }, steps: stepsSchema }),
	object({ ...frameFields, kind: { type: 'string', const: 'ref' }, interactionId: identifier, revision: nonempty, arguments: array(argumentSchema), resultId: identifier })
] };

const clarificationSchema = object({ question: nonempty, answer: nonempty });

const intentFields = { revision: nonempty, text: nonempty, clarifications: array(clarificationSchema) };

const referenceSchema = object({ kind: { type: 'string', enum: ['element', 'relation', 'field', 'operation', 'occurrence', 'frame', 'interaction', 'type', 'decision', 'binding', 'ownership', 'membership', 'integration', 'interface', 'port', 'connection', 'transport', 'module', 'fieldMapping', 'error', 'predicate', 'stateMachine', 'messaging'] }, id: identifier });

const pointer: Schema = { type: 'string', pattern: '^(?:/(?:[^~/]|~[01])*)+$' };

const constraintSchema = object({ id: identifier, subject: referenceSchema, field: pointer, value: knowledgeSchema, category: { type: 'string', enum: ['technology', 'library', 'protocol', 'dependency', 'persistence', 'concurrency'] }, operator: { type: 'string', enum: ['equals', 'notEquals'] } }, ['category', 'operator']);

const decisionStatus: Schema = { type: 'string', enum: ['proposed', 'accepted', 'rejected', 'deprecated', 'superseded'] };

const decisionRecord = { number: nonempty, title: nonempty, context: text, decision: text, consequences: array(text), supersededById: identifier };

const historySchema = object({ revision: nonempty, status: decisionStatus, scopeIds: array(identifier), constraints: array(constraintSchema), ...decisionRecord }, ['number', 'title', 'context', 'decision', 'consequences', 'supersededById']);

/** The same schema is exported, validated locally and included in the initial AI grammar. */
function createSemanticModelV4Schema(legacy: Schema): Schema {
	const schema = structuredClone(legacy);
	schema.$id = 'urn:ordito:model:4'; schema.title = 'Specsplice semantic model v4';
	schema.properties!.version = { type: 'integer', const: 4 };
	const element = schema.properties!.semantics.properties!.elements.items!;
	element.properties!.runtimeKind = { type: 'string', enum: ['application', 'service', 'spa', 'mobile', 'store', 'messaging'] };
	element.properties!.scope = { type: 'string', enum: ['governed', 'external'] };
	const behavior = element.properties!.behavior;
	behavior.properties!.id = identifier; behavior.required!.push('id');
	for (const section of ['inputs', 'outputs']) { identifyField(behavior.properties![section].items!); }
	const member = element.properties!.details.properties!.members.items!;
	identifyField(member);
	const field = object({ id: identifier, name: nonempty, type: text, typeId: identifier, required: { type: 'boolean' }, nullable: knowledgeSchema }, ['typeId', 'nullable']);
	const operation = structuredClone(behavior);
	Object.assign(operation.properties!, { ownerId: identifier, name: nonempty, effects: array(text), errors: array(object({ id: identifier, code: nonempty, description: text, typeId: identifier })) });
	operation.required!.push('ownerId', 'name', 'effects');
	const view = schema.properties!.views.items!;
	Object.assign(view.properties!, { subjectId: identifier, contextIds: array(identifier), interactionId: identifier, stateMachineId: identifier, messagingId: identifier });
	schema.properties!.foundation = object({
		messaging: array(object({ id: identifier, version: { type: 'integer', const: 1 }, revision: nonempty,
			brokers: array(object({ id: identifier, elementId: identifier, engine: { type: 'string', const: 'nats-jetstream' }, version: { type: 'string', const: '2.11.9' }, endpointRef: nonempty, credentialRef: { type: 'string', const: 'none' } })),
			messages: array(object({ id: identifier, name: nonempty, version: nonempty, payloadTypeId: identifier, compatibility: { type: 'string', const: 'exact' }, routingFieldId: identifier, correlationFieldId: identifier })),
			channels: array(object({ id: identifier, name: nonempty, brokerId: identifier, kind: { type: 'string', enum: ['queue', 'topic'] }, messageId: identifier, subject: nonempty, storage: { type: 'string', const: 'file' }, maxMessages: { type: 'integer', minimum: 1, maximum: 100000 }, duplicateWindowMs: { type: 'integer', minimum: 100, maximum: 120000 } })),
			publishers: array(object({ id: identifier, channelId: identifier, ownerId: identifier, operationId: identifier })),
			subscriptions: array(object({ id: identifier, channelId: identifier, ownerId: identifier, operationId: identifier, durable: nonempty, delivery: { type: 'string', const: 'at-least-once' }, ack: { type: 'string', const: 'explicit' }, ackWaitMs: { type: 'integer', minimum: 100, maximum: 30000 }, maxAttempts: { type: 'integer', minimum: 1, maximum: 10 }, backoffMs: array({ type: 'integer', minimum: 100, maximum: 30000 }), deadLetter: object({ subject: nonempty }), ordering: { type: 'string', const: 'serial' }, idempotency: { type: 'string', enum: ['none', 'file-ledger-v1'] } }))
		})),
		stateMachines: array(object({ id: identifier, version: { type: 'integer', const: 1 }, revision: nonempty, ownerId: identifier, operationId: identifier, profile: { type: 'string', const: 'flat' }, initialIds: array(identifier), finalIds: array(identifier), persistence: { type: 'string', const: 'snapshot-v1' },
			states: array(object({ elementId: identifier, entry: array(identifier), exit: array(identifier), doActionId: identifier }, ['doActionId'])),
			events: array(object({ id: identifier, operationId: identifier, subscriptionId: identifier }, ['subscriptionId'])),
			actions: array(object({ id: identifier, interactionId: identifier, revision: nonempty, arguments: array(argumentSchema) })),
			transitions: array(object({ id: identifier, from: identifier, to: identifier, eventId: identifier, kind: { type: 'string', enum: ['internal', 'external'] }, priority: { type: 'integer', minimum: 0, maximum: 1000 }, guard: { anyOf: [expressionSchema, { type: 'null' }] }, effects: array(identifier) }))
		})),
	tasks: array(object({ id: identifier, target: referenceSchema, ...intentFields, history: array(object(intentFields)) })),
	predicates: array(predicateSchema),
		ownership: array(object({ id: identifier, elementId: identifier, ownerId: identifier, role: { type: 'string', enum: ['architecture', 'lifecycle'] } })),
		memberships: array(object({ id: identifier, elementId: identifier, featureId: identifier })),
		integrations: array(object({ id: identifier, consumerId: identifier, externalId: identifier })),
		types: array(object({ id: identifier, name: nonempty, fields: array(field), kind: { type: 'string', enum: ['primitive', 'record', 'enum', 'collection', 'reference'] }, primitive: nonempty, values: array(nonempty), itemTypeId: identifier, targetTypeId: identifier, constraints: array(object({ id: identifier, kind: { type: 'string', enum: ['minimum', 'maximum', 'pattern', 'minLength', 'maxLength'] }, value: { anyOf: [text, { type: 'number' }] } })) }, ['kind', 'primitive', 'values', 'itemTypeId', 'targetTypeId', 'constraints'])),
		blueprint: object({
			operations: array(operation),
			interfaces: array(object({ id: identifier, elementId: identifier, version: nonempty, operationIds: array(identifier), invariants: array(text) })),
			ports: array(object({ id: identifier, elementId: identifier, interfaceId: identifier, direction: { type: 'string', enum: ['provided', 'required'] } })),
			connections: array(object({ id: identifier, requiredPortId: identifier, providedPortId: identifier, operations: array(object({ requiredOperationId: identifier, providedOperationId: identifier })) })),
			transports: array(object({ id: identifier, relationId: identifier, protocol: nonempty, format: nonempty, schemaTypeId: identifier, schemaVersion: nonempty })),
			modules: array(object({ id: identifier, elementId: identifier, consumerIds: array(identifier), library: knowledgeSchema, version: knowledgeSchema })),
			fieldMappings: array(object({ id: identifier, domainFieldId: identifier, targetFieldId: identifier, targetKind: { type: 'string', enum: ['column', 'member'] } }))
		}),
		occurrences: array(object({ id: identifier, operationId: identifier, from: identifier, to: identifier, errorId: identifier, messagingBindingId: identifier, execution: object({ mode: { type: 'string', enum: ['sync', 'async'] }, arguments: array(argumentSchema), resultId: identifier, response: { type: 'string', const: 'required' }, failure: { type: 'string', const: 'propagate' }, timeoutMs: { type: 'integer', minimum: 1, maximum: 30000 }, correlation: expressionSchema }) }, ['errorId', 'execution', 'messagingBindingId'])),
		frames: array(frameSchema),
		interactions: array(object({ id: identifier, ownerId: identifier, occurrenceIds: array(identifier), frameIds: array(identifier), legacyViewId: identifier, legacyRelationOrder: array(identifier), execution: object({ version: { type: 'integer', const: 1 }, revision: nonempty, operationId: identifier, steps: stepsSchema, outputs: array(argumentSchema) }) }, ['ownerId', 'legacyViewId', 'legacyRelationOrder', 'execution'])),
		assertions: array(object({
			id: identifier, subject: referenceSchema, field: pointer, value: knowledgeSchema,
			provenance: object({ kind: { type: 'string', enum: ['authored', 'extracted', 'inferred', 'observed'] }, producer: nonempty, revision: nonempty }),
			acceptance: object({ status: { type: 'string', enum: ['proposed', 'accepted', 'rejected'] }, revision: nonempty }),
			verification: object({ checkId: identifier, revision: nonempty, outcome: { type: 'string', enum: ['passed', 'failed', 'unknown'] }, evidence: nonempty })
		}, ['verification'])),
		platform: object({ bindings: array(object({ id: identifier, elementId: identifier, profileId: identifier, technology: knowledgeSchema })) }),
		decisions: array(object({ id: identifier, revision: nonempty, status: decisionStatus, scopeIds: array(identifier), constraints: array(constraintSchema), record: object({ ...decisionRecord, history: array(historySchema) }, ['supersededById']) }, ['record'])),
		migration: object({ sourceVersion: { type: 'integer', anyOf: [{ type: 'integer', const: 2 }, { type: 'integer', const: 3 }] }, unresolvedOwnershipIds: array(identifier) })
	}, ['migration', 'blueprint', 'predicates', 'stateMachines', 'messaging', 'tasks']);
	schema.required!.push('foundation');
	return schema;
}

const field = object({ name: nonempty, type: nonempty, required: { type: 'boolean' } });

const behavior = object({
	inputs: array(field), outputs: array(field), preconditions: array(nonempty), postconditions: array(nonempty),
	errors: array(object({ code: identifier, description: nonempty })),
	permissions: array(object({ actorId: identifier, capability: nonempty })),
	acceptanceCriteria: array(object({ id: identifier, given: nonempty, when: nonempty, then: nonempty }))
});

export const elementDetailsSchema = object({ technology: text, environment: text, members: array(object({ name: nonempty, type: text, kind: { type: 'string', enum: ['attribute', 'method'] }, key: { type: 'string', enum: ['none', 'primary', 'foreign', 'unique'] }, required: { type: 'boolean' } })) });

export const relationDetailsSchema = object({ sourceMultiplicity: { ...text, pattern: '^(?:|\\*|[0-9]+(?:\\.\\.(?:[0-9]+|\\*))?)$' }, targetMultiplicity: { ...text, pattern: '^(?:|\\*|[0-9]+(?:\\.\\.(?:[0-9]+|\\*))?)$' }, sourceMember: text, targetMember: text, protocol: text });

/** Portable JSON Schema; the committed JSON artifact is checked against this source. */
function modelSchema(version: 2 | 3): Schema {
	return {
		$schema: 'https://json-schema.org/draft/2020-12/schema',
		$id: `urn:ordito:model:${version}`,
		title: `Specsplice semantic model v${version}`,
		...object({
			version: { type: 'integer', const: version }, id: identifier, name: nonempty,
			semantics: object({
				elements: array(object({
					id: identifier, kind: { type: 'string', enum: elementKinds }, name: nonempty,
					description: text, parentId: identifier, behavior, details: elementDetailsSchema, legacyKind: { type: 'string', enum: ['class'] }
				}, ['description', 'parentId', 'behavior', 'legacyKind', 'details'])),
				relations: array(object({
					id: identifier, kind: { type: 'string', enum: relationKinds }, from: identifier, to: identifier, name: text,
					condition: nonempty, errorCode: identifier, details: relationDetailsSchema, classification: { type: 'string', enum: ['legacy-unclassified'] }
				}, ['condition', 'errorCode', 'classification', 'details']))
			}),
			views: array(object({
				...(version === 3 ? { featureId: identifier } : {}),
				id: identifier, name: nonempty, kind: { type: 'string', enum: viewKinds },
				nodes: array(object({ elementId: identifier, x: { type: 'number' }, y: { type: 'number' } })),
				relationIds: array(identifier)
			}, ['featureId'])),
			codeMappings: array(object({ id: identifier, elementId: identifier, file: nonempty, symbol: nonempty, revision: nonempty })),
			verifications: array(object({
				id: identifier, elementId: identifier, criterionId: identifier,
				outcome: { type: 'string', enum: ['passed', 'failed', 'unknown'] }, evidence: nonempty, revision: nonempty
			}))
		})
	};
}

export const semanticModelSchema = modelSchema(2);

export const semanticModelV3Schema = modelSchema(3);

export const semanticModelV4Schema = createSemanticModelV4Schema(semanticModelV3Schema);

/** V5 is additive: old executable contracts retain exactly their V4 grammar. */
export const semanticModelV5Schema = (() => {
	const schema = structuredClone(semanticModelV4Schema);
	schema.$id = 'urn:ordito:model:5'; schema.title = 'Specsplice semantic model v5'; schema.properties!.version.const = 5;
	const foundation = schema.properties!.foundation.properties!;
	foundation.evidence = array(object({ id: identifier, revision: nonempty, file: nonempty, start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 }, encoding: { type: 'string', const: 'utf-16' }, producer: nonempty, producerVersion: nonempty, nature: { type: 'string', enum: ['syntax', 'reference', 'text', 'documentation', 'runtime'] }, factIds: array(identifier) }));
	foundation.assertions.items!.properties!.evidenceIds = array(identifier);
	const occurrence = foundation.occurrences.items!;
	foundation.occurrences.items = { anyOf: [occurrence, object({ id: identifier, profile: { type: 'string', const: 'descriptive' }, name: nonempty, from: identifier, to: identifier, evidenceIds: array(identifier), operationId: identifier }, ['operationId'])] };
	const interaction = foundation.interactions.items!;
	interaction.properties!.profile = { type: 'string', const: 'executable' };
	foundation.interactions.items = { anyOf: [interaction, object({ id: identifier, profile: { type: 'string', const: 'descriptive' }, ownerId: identifier, occurrenceIds: array(identifier), frameIds: array(identifier), description: object({ trigger: nonempty, scope: nonempty, participantIds: array(identifier), evidenceIds: array(identifier), order: array(object({ before: identifier, after: identifier, evidenceIds: array(identifier), basis: { type: 'string', enum: ['extracted', 'inferred', 'observed', 'authored'] } })) }), authored: { type: 'boolean', const: true } }, ['ownerId', 'authored'])] };
	foundation.frames.items!.anyOf!.push(object({ id: identifier, occurrenceIds: array(identifier), kind: { type: 'string', const: 'unspecified' }, description: object({ operator: { type: 'string', enum: ['alt', 'opt', 'par', 'loop'] }, operands: array(object({ id: identifier, condition: knowledgeSchema, steps: array(identifier), evidenceIds: array(identifier) })) }) }));
	schema.properties!.views.items!.properties!.spec = object({ revision: nonempty, intent: nonempty, projectionRevision: nonempty, layoutRevision: nonempty, manualIds: array(identifier) });
	return schema;
})();

function identifyField(schema: Schema): void {
	schema.properties!.id = identifier;
	if (!schema.required!.includes('id')) { schema.required!.push('id'); }
	schema.properties!.typeId = identifier;
	schema.properties!.nullable = knowledgeSchema;
	// An unresolved type is a draft, not an invented primitive.
	schema.properties!.type = text;
}
