import { Ajv2020 } from 'ajv/dist/2020.js';
import { orditoCodeProtocolVersion, diagramCheckpointReasoningEfforts, maxDiagramCheckpointTimeoutMinutes, type CodeBridgeProtocol, type CodeRequest } from '../../src/vs/workbench/contrib/ordito/common/codeBridge.ts';

const nonempty = { type: 'string', minLength: 1 };

const requestSchemas = [
	{
		type: 'object', additionalProperties: false, required: ['operation', 'root', 'config', 'messages'],
		dependentRequired: { snapshot: ['sessionId'], sessionId: ['snapshot'], checkpoint: ['snapshot', 'sessionId'], checkpointTimeoutMinutes: ['checkpoint'], checkpointReasoningEffort: ['checkpoint'] },
		properties: {
			operation: { const: 'diagramChat' }, requestId: nonempty, root: nonempty, snapshot: nonempty, sessionId: nonempty,
			checkpoint: { const: true }, checkpointTimeoutMinutes: { type: 'integer', minimum: 1, maximum: maxDiagramCheckpointTimeoutMinutes }, checkpointReasoningEffort: { enum: diagramCheckpointReasoningEfforts }, config: nonempty,
			messages: { type: 'array', minItems: 1, maxItems: 60, items: { type: 'object', additionalProperties: false, required: ['role', 'text'], properties: { role: { enum: ['user', 'assistant'] }, text: nonempty } } }
		}
	},
	{ type: 'object', additionalProperties: false, required: ['operation', 'snapshot', 'request'], properties: { operation: { const: 'exploration' }, snapshot: nonempty, request: nonempty } },
	{ type: 'object', additionalProperties: false, required: ['operation', 'root', 'config', 'context'], properties: { operation: { const: 'codeUpdate' }, requestId: nonempty, root: nonempty, config: nonempty, context: nonempty } },
	{ type: 'object', additionalProperties: false, required: ['operation', 'root'], properties: { operation: { const: 'import' }, root: nonempty, modelFile: nonempty, scope: { type: 'object' }, syntaxOnly: { type: 'boolean' }, bundles: { type: 'array', items: nonempty, maxItems: 20 } } },
	{ type: 'object', additionalProperties: false, required: ['operation', 'snapshot'], properties: { operation: { enum: ['inspect', 'preview', 'history'] }, snapshot: nonempty, inventoryOnly: { type: 'boolean' }, scope: { type: 'object' }, renames: { type: 'array' }, resolutions: { type: 'array', maxItems: 1000, items: { type: 'object', additionalProperties: false, required: ['path', 'choice'], properties: { path: nonempty, choice: { enum: ['model', 'code'] } } } }, bundles: { type: 'array', items: nonempty, maxItems: 20 } } },
	{ type: 'object', additionalProperties: false, required: ['operation', 'snapshot', 'id'], properties: { operation: { enum: ['undoSync', 'recoverSync'] }, snapshot: nonempty, id: nonempty } },
	{ type: 'object', additionalProperties: false, required: ['operation', 'token'], properties: { operation: { const: 'apply' }, token: nonempty } },
	{ type: 'object', additionalProperties: false, required: ['operation', 'token', 'config', 'sourceFiles'], properties: { operation: { const: 'reconciliationPrepare' }, token: nonempty, config: nonempty, clarification: { type: 'string', maxLength: 8000 }, sourceFiles: { type: 'array', uniqueItems: true, items: nonempty }, resolutions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'choice'], properties: { path: nonempty, choice: { enum: ['model', 'code'] } } } } } },
	{ type: 'object', additionalProperties: false, required: ['operation', 'token', 'reviewId'], properties: { operation: { const: 'reconciliationPropose' }, token: nonempty, reviewId: nonempty } },
	{ type: 'object', additionalProperties: false, required: ['operation', 'snapshot', 'config'], properties: { operation: { const: 'diagramPrepare' }, snapshot: nonempty, config: nonempty, resume: nonempty, clarification: { type: 'string', maxLength: 8000 } } },
	{ type: 'object', additionalProperties: false, required: ['operation', 'snapshot', 'id', 'reviewId'], properties: { operation: { enum: ['diagramStep', 'diagramApprovePlan'] }, snapshot: nonempty, id: nonempty, reviewId: nonempty } },
	{ type: 'object', additionalProperties: false, required: ['operation', 'snapshot', 'target'], properties: { operation: { const: 'restore' }, snapshot: nonempty, target: nonempty } },
	{ type: 'object', additionalProperties: false, required: ['operation', 'snapshot', 'file', 'revision', 'start', 'end'], properties: { operation: { const: 'source' }, snapshot: nonempty, file: nonempty, revision: nonempty, start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 } } }
];

const ajv = new Ajv2020();

const valid = ajv.compile<Exclude<CodeRequest, { operation: 'collaboration' }>>({ oneOf: requestSchemas });

const requestValidators = requestSchemas.map(schema => ({ operations: schema.properties.operation.enum ?? [schema.properties.operation.const!], validate: ajv.compile(schema) }));

export const codeBridgeProtocol: CodeBridgeProtocol = { version: orditoCodeProtocolVersion, operations: ['collaboration', ...requestValidators.flatMap(item => item.operations)] };

function invalidRequest(request: unknown): Error {
	const operation = request && typeof request === 'object' && Object.hasOwn(request, 'operation') ? (request as { operation?: unknown }).operation : undefined;
	const validator = requestValidators.find(item => item.operations.includes(operation as string));
	if (!validator) { return new Error('Invalid code bridge request: missing or unsupported operation. Rebuild Specsplice and restart the application if it was updated.'); }
	validator.validate(request);
	// Schema diagnostics contain field names and constraints, never source/configuration values.
	return new Error(`Invalid code bridge request (${operation}): ${ajv.errorsText(validator.validate.errors, { dataVar: 'request' }).slice(0, 500)}`);
}

/** Validate untrusted transport data before dispatching a typed engine request. */
export function validateCodeRequest(value: unknown): asserts value is Exclude<CodeRequest, { operation: 'collaboration' }> {
	if (!valid(value)) { throw invalidRequest(value); }
}
