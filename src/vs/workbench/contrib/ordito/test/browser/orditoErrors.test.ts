import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileOperationError, FileOperationResult } from '../../../../../platform/files/common/files.js';
import { orditoErrorNotification, describeOrditoError } from '../../browser/orditoErrors.js';
import { type ModelDiagnostic, type SemanticModel } from '../../common/modelTypes.js';
import { InvalidSemanticModelError } from '../../common/modelValidation.js';

suite('Specsplice error explanations', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const model: SemanticModel = { version: 3, id: 'shop', name: 'Shop', semantics: { elements: [{ id: 'cart', name: 'Customer Cart', kind: 'resource' }], relations: [] }, views: [], codeMappings: [], verifications: [] };

	test('explains all model diagnostic categories with an actionable resolution', () => {
		const examples: { code: ModelDiagnostic['code']; args: string[]; resolution: string }[] = [
			{ code: 'shape', args: ['string'], resolution: 'expected format' },
			{ code: 'duplicateId', args: ['cart'], resolution: 'different identifier' },
			{ code: 'missingReference', args: ['cart'], resolution: 'existing object or type' },
			{ code: 'incompatibleRelation', args: ['transition', 'state', 'actor'], resolution: 'compatible endpoints' },
			{ code: 'containmentCycle', args: ['cart'], resolution: 'outside this element' },
			{ code: 'invalidParent', args: ['cart', 'resource'], resolution: 'compatible parent' },
			{ code: 'missingCriterion', args: ['accept', 'cart'], resolution: 'behavior contract' },
			{ code: 'missingError', args: ['rejected', 'cart'], resolution: 'No Error' },
			{ code: 'viewEndpoint', args: ['link'], resolution: 'both endpoint elements' },
			{ code: 'legacyClassification', args: ['link'], resolution: 'Edit Relationship' },
			{ code: 'ownership', args: ['cart', 'invalidOwner'], resolution: 'architectural owner' },
			{ code: 'assertionConflict', args: [], resolution: 'one consistent accepted value' },
			{ code: 'c4Scope', args: [], resolution: 'Include its subject' },
			{ code: 'contract', args: ['port', 'requiredInterfaceUnsatisfied'], resolution: 'Interface Connection' },
			{ code: 'decisionHistory', args: [], resolution: 'Project Decisions' }
		];
		assert.deepStrictEqual(examples.map(({ code, args, resolution }) => {
			const info = describeOrditoError(new InvalidSemanticModelError([{ code, args, path: '/example', severity: 'error' }]), 'edit', model);
			return [code, info.cause.length > 0, info.resolution.includes(resolution), !!info.details];
		}), examples.map(({ code }) => [code, true, true, true]));
	});

	test('retains multiple problems, resolves model names and keeps paths in technical details', () => {
		const info = describeOrditoError(new InvalidSemanticModelError([
			{ code: 'containmentCycle', args: ['cart'], path: '/semantics/elements/0/parentId', severity: 'error' },
			{ code: 'missingError', args: ['rejected', 'cart'], path: '/semantics/relations/0/errorCode', severity: 'error' }
		]), 'edit', model);
		assert.deepStrictEqual({ name: info.cause.includes('Customer Cart'), hasSecondCause: info.cause.includes('rejected'), hasBothFixes: info.resolution.includes('descendants') && info.resolution.includes('No Error'), hasPathInCause: info.cause.includes('/semantics'), details: info.details }, {
			name: true, hasSecondCause: true, hasBothFixes: true, hasPathInCause: false,
			details: 'Element cart contains itself through its parents (/semantics/elements/0/parentId).\nError rejected is not declared by cart.'
		});
	});

	test('distinguishes disk conflicts, missing files, permissions and full disks', () => {
		const errors = [
			new FileOperationError('Conflict on model.json', FileOperationResult.FILE_MODIFIED_SINCE),
			new FileOperationError('Missing model.json', FileOperationResult.FILE_NOT_FOUND),
			Object.assign(new Error('Cannot write model.json'), { code: 'EACCES' }),
			Object.assign(new Error('Cannot write model.json'), { code: 'ENOSPC' })
		];
		assert.deepStrictEqual(errors.map(error => describeOrditoError(error, 'save').cause), [
			'The file changed on disk, or another file already occupies the destination.',
			'A required file or folder no longer exists at the selected path.',
			'The file or folder cannot be accessed with the current permissions, or is locked.',
			'There is not enough free disk space.'
		]);
	});

	test('separates malformed JSON, stale edits, derived diagrams and unsupported transitions', () => {
		assert.deepStrictEqual([
			describeOrditoError(new SyntaxError('Unexpected token at position 4'), 'load').resolution.includes('JSON syntax'),
			describeOrditoError(new Error('The project changed while the dialog was open.')).resolution.includes('reopen the editing form'),
			describeOrditoError(new Error('This diagram is derived from its linked behavior.')).resolution.includes('linked interaction or scenario'),
			describeOrditoError(new Error('Unsupported resource transition: link')).resolution.includes('same resource'),
			describeOrditoError(new Error('Unknown diagram: removed')).resolution.includes('select an existing object')
		], [true, true, true, true, true]);
	});

	test('uses the supplied validation message and keeps unexpected failures honest', () => {
		const validation = describeOrditoError('Enter a name.', 'validation');
		const unexpected = describeOrditoError(new Error('Provider Offline'), 'ai');
		assert.deepStrictEqual({ validation, unexpected }, {
			validation: { title: 'Check the Entered Values', cause: 'Enter a name.', resolution: 'Correct the highlighted fields and try saving again.', details: 'Enter a name.' },
			unexpected: { title: 'Could Not Complete the AI Request', cause: 'The operation failed, but Specsplice could not determine the cause.', resolution: 'Review the current project and retry the operation. If it fails again, copy Technical Details to report the problem.', details: 'Provider Offline' }
		});
	});

	test('keeps changed business expectations and criteria actionable without opening technical details', () => {
		const expectations = describeOrditoError('Independent business expectations changed. Prepare a new review before running verification or applying.', 'ai');
		const criteria = describeOrditoError('Criteria changed. Open them again.', 'ai');
		const specification = describeOrditoError('The Specification Changed. Run a New Simulation.', 'ai');
		assert.deepStrictEqual({
			expectations: [expectations.cause, expectations.resolution],
			criteria: [criteria.cause, criteria.resolution],
			specification: [specification.cause, specification.resolution]
		}, {
			expectations: ['Independent business expectations changed after the current review was prepared.', 'Prepare a new review before running verification or applying.'],
			criteria: ['The independent test criteria changed while they were being edited.', 'Open the test criteria again and review their current values before saving. Then prepare a new review before verification or application.'],
			specification: ['The specification changed after the simulation or review was prepared.', 'Review the current specification, then run a new simulation or prepare a new review before applying.']
		});
	});

	test('explains how to resume when the diagram assistant reaches its time limit', () => {
		const info = describeOrditoError(new Error('The assistant reached the time limit for this request. Completed drafts are retained. Send a follow-up to continue.'), 'ai');
		assert.equal(info.cause, 'The AI provider did not finish before the request timed out.');
		assert.match(info.resolution, /Continue Generation.*saved step/);
	});

	test('explains how to recover a missing source selection for Connect', () => {
		const info = describeOrditoError(new Error('No source element selected'), 'edit', model);
		assert.deepStrictEqual([info.cause, info.resolution], ['No source element is selected for the new relationship.', 'Select the source element in the diagram, choose Connect, then select a compatible target element.']);
	});

	test('notifications include cause, resolution and unmodified provider details', () => {
		const message = orditoErrorNotification(new Error('Cannot find or execute Codex. Install: npm install -g @openai/codex. https://example.test/setup'), 'ai');
		assert.deepStrictEqual([message.includes('Cause:'), message.includes('How to resolve:'), message.includes('Technical Details: Cannot find or execute Codex.'), message.includes('npm install -g @openai/codex'), message.includes('https://example.test/setup')], [true, true, true, true, true]);
	});

	test('gives a recovery path when the native Codex catalog lacks the selected diagram model', () => {
		const details = 'The Selected Diagram Model Is Not Available in Codex Chat: gpt-6.2-sol. Choose an Available Model and Retry.';
		const info = describeOrditoError(new Error(details), 'ai');
		assert.deepStrictEqual(info, {
			title: 'Could Not Complete the AI Request',
			cause: 'The selected diagram model is missing from the Codex Chat catalog.',
			resolution: 'Open AI Settings and choose Refresh Account and Models. If your signed-in Codex CLI supports the same model, use Choose Model and CLI to enter its absolute executable path, then retry.',
			details
		});
	});
});
