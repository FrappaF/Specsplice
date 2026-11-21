import { modelStackPlan } from '../../src/vs/workbench/contrib/ordito/common/modelStack.ts';
import { modelTaskIntent } from '../../src/vs/workbench/contrib/ordito/common/modelWorkflow.ts';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, realpath, lstat, writeFile, rm } from 'node:fs/promises';
import { isAbsolute, join, posix } from 'node:path';
import { lock, managed, atomicJson, snapshotId } from '../runtime/projectStore.ts';
import { projectMetadataName, projectMetadataPath } from '../runtime/projectPaths.ts';
import { assertNoInterruptedOperation } from '../code-import/reconciliationJournal.ts';
import { physicalImage, replacePhysicalImage, samePhysicalImage, contentHash, type PhysicalMutation } from '../runtime/sourceChanges.ts';
import { runProcess } from './process.ts';
import { refreshStructuralSourceIndex } from './structuralSourceIndex.ts';
import { readBoundedText } from './io.ts';
import { prepareStructuralSourceContext } from './structuralContext.ts';
import { predicateRegion, readPredicateRegion, reversePredicate, predicateFile, assertPureProject, projectCoverage, type PredicateArtifact, type ProjectCriteria, type InteractionCase, type PredicateCase, type StateCase, type MessagingCase, type StructuralProjectSession as StructuralSession, type ProjectSnapshot } from '../../src/vs/workbench/contrib/ordito/common/modelProject.ts';
import { compileModelMessaging, simulateMessaging, emitModelMessaging, messagingRegion, readMessagingRegion, reverseModelMessaging } from '../../src/vs/workbench/contrib/ordito/common/modelMessaging.ts';
import { compileModelStateMachine, interpretModelStateMachine } from '../../src/vs/workbench/contrib/ordito/common/modelStates.ts';
import { emitModelStateMachine, stateMachineRegion, readStateMachineRegion, reverseModelStateMachine } from '../../src/vs/workbench/contrib/ordito/common/stateRuntime.ts';
import { compileModelInteraction, interpretModelInteraction } from '../../src/vs/workbench/contrib/ordito/common/modelInteractions.ts';
import { emitModelInteraction, interactionRegion, readInteractionRegion, reverseModelInteraction } from '../../src/vs/workbench/contrib/ordito/common/interactionRuntime.ts';
import { evaluateModelPredicate, emitModelPredicate } from '../../src/vs/workbench/contrib/ordito/common/modelExpressions.ts';
import { canonicalJson, hashSemanticModel } from '../../src/vs/workbench/contrib/ordito/common/modelSerialization.ts';
import { modelProjectProfile, modelArchetypeRevision } from '../../src/vs/workbench/contrib/ordito/common/modelProfiles.ts';
import { readSemanticModel } from '../../src/vs/workbench/contrib/ordito/common/modelValidation.ts';
import { type SemanticModelV4 } from '../../src/vs/workbench/contrib/ordito/common/modelTypes.ts';
import type { ModelTaskRequest } from '../../src/vs/workbench/contrib/ordito/common/modelTaskContext.ts';

export type { StructuralSession };
export interface StructuralPreparation { status: 'staged' | 'aligned'; calls: 0; session?: StructuralSession }
const ownedRegion = (source: string, artifact: PredicateArtifact) => artifact.messagingId ? readMessagingRegion(source) : artifact.stateMachineId ? readStateMachineRegion(source) : artifact.interactionId ? readInteractionRegion(source) : readPredicateRegion(source);
const artifactCode = (model: SemanticModelV4, artifact: PredicateArtifact) => artifact.messagingId ? emitModelMessaging(model, artifact.messagingId) : artifact.stateMachineId ? emitModelStateMachine(model, artifact.stateMachineId) : artifact.interactionId ? emitModelInteraction(model, artifact.interactionId) : emitModelPredicate(model, model.foundation.predicates!.find(predicate => predicate.id === artifact.predicateId)!);
const predicateFailure = (error: unknown): PredicateCase['expected'] => error instanceof Error && (error.message === 'arithmeticZero' || error.message === 'arithmeticPrecision') ? error.message : 'typeError';
const image = (content: string, mode = 0o644) => ({ content, mode });
const git = async (root: string, args: string[]) => {
	const result = await runProcess('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], root, { env: { PATH: process.env.PATH, HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
	if (result.code) { throw new Error('Structural Git operation failed: ' + result.stderr); } return result.stdout.trim();
};
async function directory(root: string): Promise<string> { const path = await managed(root, 'structural'); for (const name of ['sessions', 'snapshots', 'verification']) { await mkdir(join(path, name), { recursive: true }); if (await realpath(join(path, name)) !== join(path, name)) { throw new Error('Redirected structural directory'); } } return path; }
async function json<T>(path: string): Promise<T> { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) { throw new Error('Invalid structural metadata'); } return JSON.parse(await readBoundedText(path, 16 * 1024 * 1024)) as T; }
async function baseline(root: string): Promise<ProjectSnapshot | null> {
	const path = await directory(root); let pointer: { id: string };
	try { pointer = await json<{ id: string }>(join(path, 'active.json')); }
	catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { return null; } throw error; }
	if (!snapshotId(pointer.id)) { throw new Error('Invalid structural pointer'); }
	// A lost authoritative snapshot is not a new project. Only the derived source index is reconstructible.
	let value: ProjectSnapshot;
	try { value = await json<ProjectSnapshot>(join(path, 'snapshots', pointer.id + '.json')); }
	catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { throw new Error('Missing common structural baseline; restore the snapshot before reconciliation'); } throw error; }
	if (value.id !== pointer.id || value.version !== 1) { throw new Error('Invalid structural snapshot'); } return value;
}
function seal(session: StructuralSession): string { const { status, verification, reviewId, ...immutable } = session; return contentHash(canonicalJson(immutable)); }
async function save(session: StructuralSession): Promise<void> { if (Buffer.byteLength(JSON.stringify(session)) > 16 * 1024 * 1024) { throw new Error('Structural session exceeds journal budget'); } await atomicJson(join(await directory(session.root), 'sessions', session.id + '.json'), session); }

/** Read strict project-owned test data, never executable tests or an AI assertion of success. */
async function criteria(root: string, model: SemanticModelV4): Promise<ProjectCriteria> {
	const value = await json<ProjectCriteria>(await projectMetadataPath(root, 'criteria.json'));
	if (value.version !== 1 || typeof value.revision !== 'string' || !value.revision || !Array.isArray(value.cases) || !value.cases.length && !value.interactions?.length && !value.states?.length && !value.messaging?.length || value.cases.length + (value.interactions?.length ?? 0) + (value.states?.length ?? 0) + (value.messaging?.length ?? 0) > 1000 || new Set([...value.cases, ...value.interactions ?? [], ...value.states ?? [], ...value.messaging ?? []].map(entry => entry.id)).size !== value.cases.length + (value.interactions?.length ?? 0) + (value.states?.length ?? 0) + (value.messaging?.length ?? 0)) { throw new Error('Invalid independent criteria'); }
	for (const entry of value.cases) {
		const predicate = model.foundation.predicates?.find(predicate => predicate.id === entry.predicateId);
		const operation = model.foundation.blueprint?.operations.find(operation => operation.id === predicate?.operationId);
		if (!predicate) { continue; }
		if (!entry.id || !operation?.acceptanceCriteria.some(criterion => criterion.id === entry.criterionId) || !entry.input || Array.isArray(entry.input) || typeof entry.input !== 'object' || ![true, false, null, 'typeError', 'arithmeticZero', 'arithmeticPrecision'].includes(entry.expected)) { throw new Error('Independent criterion does not resolve'); }
	}
	for (const predicate of model.foundation.predicates ?? []) {
		const operation = model.foundation.blueprint!.operations.find(operation => operation.id === predicate.operationId)!;
		if (!operation.acceptanceCriteria.length || operation.acceptanceCriteria.some(criterion => !value.cases.some(entry => entry.predicateId === predicate.id && entry.criterionId === criterion.id))) { throw new Error('Every predicate criterion needs an independent case'); }
	}
	if (value.interactions !== undefined && !Array.isArray(value.interactions)) { throw new Error('Invalid independent interaction criteria'); }
	let replyCount = 0, replyDelay = 0;
	for (const entry of value.interactions ?? []) {
		const interaction = model.foundation.interactions.find(interaction => interaction.id === entry.interactionId);
		if (!interaction?.execution) { continue; }
		const contract = model.foundation.blueprint?.operations.find(operation => operation.id === interaction.execution!.operationId);
		if (!entry.id || !contract?.acceptanceCriteria.some(criterion => criterion.id === entry.criterionId) || !entry.input || typeof entry.input !== 'object' || Array.isArray(entry.input) || !entry.replies || typeof entry.replies !== 'object' || !['completed', 'failed'].includes(entry.expected?.outcome) || !Array.isArray(entry.expected.calls) || entry.expected.calls.some(id => typeof id !== 'string') || !entry.expected.outputs || typeof entry.expected.outputs !== 'object' || entry.expected.outcome === 'failed' && typeof entry.expected.error !== 'string') { throw new Error('Independent interaction criterion does not resolve'); }
		for (const replies of Object.values(entry.replies)) { if (!Array.isArray(replies)) { throw new Error('Invalid scripted replies'); } for (const reply of replies) { if (!reply || !Number.isSafeInteger(reply.delayMs) || reply.delayMs < 0 || reply.delayMs > 30000) { throw new Error('Invalid scripted delay'); } replyCount++; replyDelay += reply.delayMs; } }
	}
	if (value.states !== undefined && !Array.isArray(value.states)) { throw new Error('Invalid independent state criteria'); }
	for (const entry of value.states ?? []) {
		const machine = model.foundation.stateMachines?.find(machine => machine.id === entry.machineId); if (!machine) { continue; }
		const contract = model.foundation.blueprint!.operations.find(operation => operation.id === machine.operationId);
		if (!entry.id || !contract?.acceptanceCriteria.some(criterion => criterion.id === entry.criterionId) || !entry.scenario || typeof entry.scenario.instanceId !== 'string' || !entry.scenario.input || !Array.isArray(entry.scenario.events) || entry.scenario.events.length > 1000 || !entry.expected || typeof entry.expected.stateId !== 'string' || !['none', 'completed', 'cancelled', 'failed'].includes(entry.expected.doStatus) || entry.expected.error !== null && typeof entry.expected.error !== 'string' || ![entry.expected.statuses, entry.expected.errors, entry.expected.transitions, entry.expected.calls, entry.expected.phases].every(Array.isArray)) { throw new Error('Independent state criterion does not resolve'); }
		for (const data of [entry.scenario.replies, ...entry.scenario.events.map(step => step.replies)]) { if (!data || typeof data !== 'object' || Array.isArray(data)) { throw new Error('Invalid state reply data'); } for (const replies of Object.values(data)) { if (!replies || typeof replies !== 'object' || Array.isArray(replies)) { throw new Error('Invalid state reply data'); } for (const entries of Object.values(replies)) { if (!Array.isArray(entries)) { throw new Error('Invalid state reply data'); } for (const reply of entries) { if (!reply || !Number.isSafeInteger(reply.delayMs) || reply.delayMs < 0 || reply.delayMs > 30000) { throw new Error('Invalid state delay'); } replyCount++; replyDelay += reply.delayMs; } } } }
	}
	for (const machine of model.foundation.stateMachines ?? []) { const contract = model.foundation.blueprint!.operations.find(operation => operation.id === machine.operationId)!; if (!contract.acceptanceCriteria.length || contract.acceptanceCriteria.some(criterion => !value.states?.some(entry => entry.machineId === machine.id && entry.criterionId === criterion.id))) { throw new Error('Every state machine criterion needs an independent case'); } }
	if (value.messaging !== undefined && !Array.isArray(value.messaging)) { throw new Error('Invalid independent messaging criteria'); }
	for (const entry of value.messaging ?? []) { const topology = model.foundation.messaging?.find(topology => topology.id === entry.messagingId); if (!topology) { continue; } const contracts = [...topology.publishers, ...topology.subscriptions].map(binding => model.foundation.blueprint!.operations.find(operation => operation.id === binding.operationId)!); if (!entry.id || !contracts.some(contract => contract.acceptanceCriteria.some(criterion => criterion.id === entry.criterionId)) || !entry.scenario || !Array.isArray(entry.scenario.steps) || entry.scenario.steps.length > 1000 || !entry.expected || ![entry.expected.published, entry.expected.deliveries, entry.expected.deadLetters, entry.expected.errors].every(entries => Array.isArray(entries) && entries.every(value => typeof value === 'string'))) { throw new Error('Independent messaging criterion does not resolve'); } }
	for (const topology of model.foundation.messaging ?? []) { for (const binding of [...topology.publishers, ...topology.subscriptions]) { const contract = model.foundation.blueprint!.operations.find(operation => operation.id === binding.operationId)!; if (!contract.acceptanceCriteria.length || contract.acceptanceCriteria.some(criterion => !value.messaging?.some(entry => entry.messagingId === topology.id && entry.criterionId === criterion.id))) { throw new Error('Every messaging binding criterion needs an independent case'); } } }
	if (replyCount > 1000 || replyDelay > 5000) { throw new Error('Scripted verification exceeds 1000 replies or 5000 ms of authored delay; narrow the job'); }
	for (const interaction of model.foundation.interactions.filter(entry => entry.execution)) {
		const contract = model.foundation.blueprint!.operations.find(operation => operation.id === interaction.execution!.operationId)!;
		if (!contract.acceptanceCriteria.length || contract.acceptanceCriteria.some(criterion => !value.interactions?.some(entry => entry.interactionId === interaction.id && entry.criterionId === criterion.id))) { throw new Error('Every interaction criterion needs an independent case'); }
	}
	return value;
}
async function currentModel(root: string): Promise<SemanticModelV4> { const model = readSemanticModel(JSON.parse((await physicalImage(root, `${await projectMetadataName(root)}/model.json`))?.content ?? 'null')); if ((model.version !== 4 && model.version !== 5)) { throw new Error('Structural project requires v4'); } return model; }
async function noInterrupted(root: string): Promise<void> { await assertNoInterruptedOperation(root); const path = join(await directory(root), 'sessions'); for (const file of await readdir(path)) { if (!file.endsWith('.json')) { continue; } const session = await readStructuralSession(root, file.slice(0, -5)); if (['publishing', 'undoing'].includes(session.status)) { throw new Error('Interrupted structural publication requires recovery'); } } }

export async function readStructuralSession(root: string, id: string): Promise<StructuralSession> {
	if (!snapshotId(id) || await realpath(root) !== root) { throw new Error('Invalid structural session identity'); }
	const session = await json<StructuralSession>(join(await directory(root), 'sessions', id + '.json'));
	if (session.version !== 1 || session.root !== root || session.id !== id || session.worktree !== await projectMetadataPath(root, 'worktrees', id) || session.reviewId !== seal(session) || new Set(session.mutations.map(edit => edit.file)).size !== session.mutations.length) { throw new Error('Structural review was modified'); }
	return session;
}

/** Bootstrap has no source import and no provider dependency. Existing history is never committed. */
async function repository(root: string): Promise<string> {
	try { await lstat(join(root, '.git')); } catch (error) {
		if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) { throw error; }
		await git(root, ['init', '-q']);
		await git(root, ['-c', 'user.name=Specsplice', '-c', 'user.email=ordito@localhost', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'Initialize diagram-driven project']);
	}
	if (await git(root, ['rev-parse', '--show-toplevel']) !== root) { throw new Error('Open the Git repository root'); }
	return git(root, ['rev-parse', 'HEAD']);
}

/** Explicit job. Every file is derived from a validated predicate; custom code is outside execution scope. */
export async function prepareStructuralProject(root: string, direction: 'forward' | 'reverse' = 'forward', paths: Record<string, string> = {}, maxInputBytes = 196608, signal?: AbortSignal): Promise<StructuralPreparation> {
	if (!Number.isInteger(maxInputBytes) || maxInputBytes < 1 || maxInputBytes > 196608) { throw new Error('Invalid structural input budget'); }
	signal?.throwIfAborted();
	root = await realpath(root);
	return lock(root, async () => {
		signal?.throwIfAborted();
		await noInterrupted(root);
		const manifestImage = await physicalImage(root, 'package.json');
		if (manifestImage) {
			const manifest = JSON.parse(manifestImage.content) as { type?: string; engines?: { node?: string; bun?: string }; dependencies?: object; devDependencies?: object; optionalDependencies?: object };
			if (manifest.type !== 'module' || !(manifest.engines?.node === '24.22.1' && !manifest.engines.bun || manifest.engines?.bun === '1.3.2' && !manifest.engines.node) || [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies].some(entries => entries && Object.keys(entries).length)) { throw new Error('Unsupported manifest, toolchain or external dependencies'); }
		}
		const model = await currentModel(root), nextModel = structuredClone(model), base = await baseline(root);
		if (base) {
			const expected = modelProjectProfile(base.model).toolchain, manifest = manifestImage ? JSON.parse(manifestImage.content) as { engines?: Record<string, string> } : undefined;
			if (!manifest?.engines || Object.keys(manifest.engines).length !== 1 || manifest.engines[expected.runtime] !== expected.version) { throw new Error('Manifest runtime changed outside the reviewed stack plan'); }
		}
		const sourceIndex = await refreshStructuralSourceIndex(root);
		if (!['forward', 'reverse'].includes(direction)) { throw new Error('Invalid structural direction'); }
		const previous = base?.artifacts ?? [], generatedTests: Record<string, string> = {}, artifacts: PredicateArtifact[] = [], mutations: PhysicalMutation[] = [];
		if (direction === 'reverse' && !base) { throw new Error('Reverse requires a common structural baseline'); }
		const put = async (file: string, content: string | null, mode?: number): Promise<void> => { const before = await physicalImage(root, file); const after = content === null ? null : image(content, mode ?? before?.mode); if (!samePhysicalImage(before, after)) { mutations.push({ file, before, after }); } };
		if ((model.foundation.predicates?.length ?? 0) + model.foundation.interactions.filter(entry => entry.execution).length + (model.foundation.stateMachines?.length ?? 0) + (model.foundation.messaging?.length ?? 0) > 64) { throw new Error('Project job exceeds 64 executable targets; narrow the project'); }
		if ((model.foundation.predicates ?? []).some(predicate => model.foundation.interactions.some(interaction => interaction.execution && interaction.id === predicate.id))) { throw new Error('Executable binding identity collision'); }
		const executableIds = [...model.foundation.predicates ?? [], ...model.foundation.interactions.filter(entry => entry.execution), ...model.foundation.stateMachines ?? [], ...model.foundation.messaging ?? []].map(entry => entry.id); if (new Set(executableIds).size !== executableIds.length) { throw new Error('Executable binding identity collision'); }
		const ids = new Set([...(model.foundation.messaging ?? []).map(topology => topology.id), ...(model.foundation.stateMachines ?? []).map(machine => machine.id), ...(model.foundation.predicates ?? []).map(predicate => predicate.id), ...model.foundation.interactions.filter(entry => entry.execution).map(entry => entry.id), ...previous.map(artifact => artifact.predicateId)]);
		if (Object.keys(paths).some(id => !ids.has(id))) { throw new Error('Physical mapping outside project scope'); }
		for (const id of ids) {
			const old = previous.find(artifact => artifact.predicateId === id), topology = model.foundation.messaging?.find(entry => entry.id === id), isMessaging = !!topology || !!old?.messagingId, machine = model.foundation.stateMachines?.find(entry => entry.id === id), isState = !!machine || !!old?.stateMachineId, interaction = model.foundation.interactions.find(entry => entry.id === id && entry.execution), isInteraction = !!interaction || !!old?.interactionId, predicate = model.foundation.predicates?.find(predicate => predicate.id === id), common = base?.model.foundation.predicates?.find(predicate => predicate.id === id);
			if (old && (topology || machine || interaction || predicate) && (Boolean(topology) !== Boolean(old.messagingId) || Boolean(machine) !== Boolean(old.stateMachineId) || Boolean(interaction) !== Boolean(old.interactionId))) { throw new Error('Conflict: executable identity changed kind'); }
			let file = paths[id] ?? old?.file ?? predicateFile(id).replace('predicate-', isMessaging ? 'messaging-' : isState ? 'state-' : isInteraction ? 'interaction-' : 'predicate-');
			const matches = sourceIndex.entries.filter(entry => entry.identity?.id === id);
			if (matches.length > 1) { throw new Error('Ambiguous physical identity: duplicate owned sources'); }
			if (direction === 'reverse' && old && !paths[id] && !await physicalImage(root, file) && matches.length) { file = matches[0].file; }
			if (direction === 'reverse' && old && file !== old.file && await physicalImage(root, old.file)) { throw new Error('Ambiguous physical identity: both old and moved source exist'); }
			if (!/^src\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/){0,7}[A-Za-z0-9_-][A-Za-z0-9_.-]*\.mjs$/.test(file)) { throw new Error('Physical scope requires a bounded src ESM path'); }
			const source = await physicalImage(root, file);
			if (artifacts.some(artifact => artifact.file === file)) { throw new Error('Duplicate physical destination'); }
			if (isMessaging) {
				const commonTopology = base?.model.foundation.messaging?.find(entry => entry.id === id), oldSource = old ? await physicalImage(root, old.file) : null;
				if (direction === 'reverse') {
					if (!old || !commonTopology || !source) { throw new Error('Partial messaging mapping: existing source and baseline required'); }
					if (canonicalJson(model.foundation) !== canonicalJson(base!.model.foundation)) { throw new Error('Conflict: messaging model changed since common baseline'); }
					if (readMessagingRegion(source.content).region !== old.region) { const candidate = reverseModelMessaging(base!.model, id, source.content); nextModel.foundation.messaging = nextModel.foundation.messaging!.map(entry => entry.id === id ? candidate.foundation.messaging!.find(entry => entry.id === id)! : entry); }
				} else {
					if (old && (!oldSource || readMessagingRegion(oldSource.content).region !== old.region)) { throw new Error('Conflict: messaging source changed since common baseline; use Reverse'); }
					if (!topology) { if (old && oldSource) { const rest = oldSource.content.replace(old.region, ''); await put(old.file, rest.trim() ? rest : null); } continue; }
					if (old && file !== old.file) { if (source) { throw new Error('Rename destination already exists'); } await put(old.file, null); } else if (!old && source) { throw new Error('New messaging destination already exists'); }
				}
				artifacts.push({ predicateId: id, messagingId: id, operationId: (topology ?? commonTopology)!.publishers[0].operationId, file, region: '' }); continue;
			}
			if (isState) {
				const commonMachine = base?.model.foundation.stateMachines?.find(entry => entry.id === id), oldSource = old ? await physicalImage(root, old.file) : null;
				if (direction === 'reverse') {
					if (!old || !commonMachine || !source) { throw new Error('Partial state mapping: existing source and baseline required'); }
					if (canonicalJson(model.foundation) !== canonicalJson(base!.model.foundation)) { throw new Error('Conflict: state model changed since common baseline'); }
					if (readStateMachineRegion(source.content).region !== old.region) { const candidate = reverseModelStateMachine(base!.model, id, source.content); nextModel.foundation.stateMachines = nextModel.foundation.stateMachines!.map(entry => entry.id === id ? candidate.foundation.stateMachines!.find(entry => entry.id === id)! : entry); }
				} else {
					if (old && (!oldSource || readStateMachineRegion(oldSource.content).region !== old.region)) { throw new Error('Conflict: state source changed since common baseline; use Reverse'); }
					if (!machine) { if (old && oldSource) { const rest = oldSource.content.replace(old.region, ''); await put(old.file, rest.trim() ? rest : null); } continue; }
					if (old && file !== old.file) { if (source) { throw new Error('Rename destination already exists'); } await put(old.file, null); } else if (!old && source) { throw new Error('New state destination already exists'); }
				}
				artifacts.push({ predicateId: id, stateMachineId: id, operationId: (machine ?? commonMachine)!.operationId, file, region: '' }); continue;
			}
			if (isInteraction) {
				const commonInteraction = base?.model.foundation.interactions.find(entry => entry.id === id);
				const oldSource = old ? await physicalImage(root, old.file) : null;
				if (direction === 'reverse') {
					if (!old || !commonInteraction) { throw new Error('Reverse has no common interaction identity'); }
					if (canonicalJson(model.foundation) !== canonicalJson(base!.model.foundation)) { throw new Error('Conflict: interaction model changed since common baseline'); }
					if (!source) { throw new Error('Partial interaction mapping: deleted executable source requires an explicit model edit'); }
					if (readInteractionRegion(source.content).region !== old.region) {
						const candidate = reverseModelInteraction(base!.model, id, source.content);
						for (const key of ['occurrences', 'frames', 'interactions'] as const) {
							for (const entry of candidate.foundation[key]) {
								const prior = base!.model.foundation[key].find(item => item.id === entry.id), current = nextModel.foundation[key].find(item => item.id === entry.id);
								if (canonicalJson(entry) === canonicalJson(prior ?? null)) { continue; }
								if (canonicalJson(current ?? null) !== canonicalJson(prior ?? null) && canonicalJson(current ?? null) !== canonicalJson(entry)) { throw new Error('Conflict: overlapping interaction source plans'); }
								Object.assign(current!, entry);
							}
						}
					}
				} else {
					if (old && (!oldSource || readInteractionRegion(oldSource.content).region !== old.region)) { throw new Error('Conflict: interaction source changed since common baseline; use Reverse'); }
					if (!interaction) { if (old && oldSource) { const rest = oldSource.content.replace(old.region, ''); await put(old.file, rest.trim() ? rest : null); } continue; }
					if (old && file !== old.file) { if (source) { throw new Error('Rename destination already exists'); } await put(old.file, null); }
					else if (!old && source) { throw new Error('New interaction destination already exists'); }
				}
				artifacts.push({ predicateId: id, interactionId: id, operationId: (interaction ?? commonInteraction)!.execution!.operationId, file, region: '' });
				continue;
			}
			if (direction === 'reverse') {
				if (!old || !common) { throw new Error('Reverse has no common identity'); }
				if (canonicalJson(model.foundation) !== canonicalJson(base!.model.foundation)) { throw new Error('Conflict: model changed since common baseline'); }
				if (!source) { nextModel.foundation.predicates = nextModel.foundation.predicates?.filter(predicate => predicate.id !== id); continue; }
				const candidate = reversePredicate(base!.model, source.content, common);
				nextModel.foundation.predicates = nextModel.foundation.predicates!.map(predicate => predicate.id === id ? candidate : predicate);
				const region = predicateRegion(nextModel, candidate); await put(file, source.content.replace(readPredicateRegion(source.content).region, region));
				artifacts.push({ predicateId: id, operationId: candidate.operationId, file, region });
			} else {
				const oldSource = old ? await physicalImage(root, old.file) : null;
				if (old && (!oldSource || readPredicateRegion(oldSource.content).region !== old.region)) { throw new Error('Conflict: source changed since common baseline; use Reverse'); }
				if (!predicate) { if (oldSource && old) { const remainder = oldSource.content.replace(old.region, ''); await put(old.file, remainder.trim() ? remainder : null); } continue; }
				const region = predicateRegion(model, predicate);
				if (old && file !== old.file) { if (source) { throw new Error('Rename destination already exists'); } await put(old.file, null); await put(file, oldSource!.content.replace(old.region, region), oldSource!.mode); }
				else { if (!old && source) { throw new Error('New predicate destination already exists'); } await put(file, oldSource ? oldSource.content.replace(old!.region, region) : region); }
				artifacts.push({ predicateId: id, operationId: predicate.operationId, file, region });
			}
		}
		for (const artifact of artifacts.filter(artifact => artifact.interactionId || artifact.stateMachineId || artifact.messagingId)) {
			artifact.region = artifact.messagingId ? messagingRegion(nextModel, artifact.messagingId) : artifact.stateMachineId ? stateMachineRegion(nextModel, artifact.stateMachineId) : interactionRegion(nextModel, artifact.interactionId!);
			const old = previous.find(entry => entry.predicateId === artifact.predicateId), original = await physicalImage(root, direction === 'reverse' ? artifact.file : old?.file ?? artifact.file);
			await put(artifact.file, original ? original.content.replace(ownedRegion(original.content, artifact).region, artifact.region) : artifact.region, original?.mode);
		}
		const archetype = modelProjectProfile(nextModel);
		const stackPlan = base && modelProjectProfile(base.model).profile.id !== archetype.profile.id ? await modelStackPlan(base.model, nextModel) : undefined;
		if (!artifacts.length && !base) { throw new Error('No executable predicate remains'); }
		if (artifacts.length) { assertPureProject(nextModel); }
		const metadataDirectory = await projectMetadataName(root);
		const metadata = `${metadataDirectory}/model.json`, criteriaFile = `${metadataDirectory}/criteria.json`;
		const independent = artifacts.length ? await criteria(root, nextModel) : await json<ProjectCriteria>(join(root, criteriaFile));
		for (const artifact of artifacts) {
			const file = 'test/' + artifact.file.slice(4, -4) + '.test.mjs';
			const importPath = posix.relative(posix.dirname(file), artifact.file);
			const predicate = nextModel.foundation.predicates?.find(predicate => predicate.id === artifact.predicateId);
			const derived = independent.cases.filter(entry => entry.predicateId === artifact.predicateId).map(entry => { let expected: PredicateCase['expected']; try { expected = evaluateModelPredicate(nextModel, predicate!, entry.input); } catch (error) { expected = predicateFailure(error); } return { ...entry, expected }; });
			const content = artifact.messagingId ? messagingHarness(nextModel, artifact.messagingId, independent.messaging ?? [], importPath, false) : artifact.stateMachineId ? await stateHarness(nextModel, artifact.stateMachineId, independent.states ?? [], importPath, false) : artifact.interactionId ? await interactionHarness(nextModel, artifact.interactionId, independent.interactions ?? [], importPath, false) : `// Specsplice generated checks; independent project criteria are verified separately.\nimport test from 'node:test';import assert from 'node:assert/strict';import check from '${importPath}';\nfor(const c of ${JSON.stringify(derived)}){test(c.id,()=>{if(c.expected==='typeError'){assert.throws(()=>check(c.input),/input type mismatch/);}else if(typeof c.expected==='string'){assert.throws(()=>check(c.input),error=>error.message===c.expected);}else{assert.equal(check(c.input),c.expected);}}); }\n`;
			const old = previous.find(item => item.predicateId === artifact.predicateId);
			const oldTest = old ? 'test/' + old.file.slice(4, -4) + '.test.mjs' : null;
			generatedTests[file] = content;
			if ((!old || oldTest !== file) && await physicalImage(root, file)) { throw new Error('Generated test destination already exists'); }
			if (oldTest && oldTest !== file) { await put(oldTest, null); }
			if (oldTest) { const prior = await physicalImage(root, oldTest); if (!prior || prior.content !== base!.tests[oldTest]) { throw new Error('Generated test changed since baseline'); } }
			await put(file, content, oldTest ? (await physicalImage(root, oldTest))?.mode : undefined);
		}
		for (const old of previous.filter(item => !artifacts.some(artifact => artifact.predicateId === item.predicateId))) { const file = 'test/' + old.file.slice(4, -4) + '.test.mjs'; if ((await physicalImage(root, file))?.content !== base!.tests[file]) { throw new Error('Generated test changed since baseline'); } await put(file, null); }
		const criteriaHash = contentHash(canonicalJson(independent)), profileHash = await modelArchetypeRevision(archetype);
		if (!base || stackPlan) {
			const manifest = JSON.stringify({ private: true, type: 'module', engines: { [archetype.toolchain.runtime]: archetype.toolchain.version }, dependencies: {}, devDependencies: {} }, null, '\t') + '\n';
			if (!base && await physicalImage(root, 'package.json')) { throw new Error('Bootstrap manifest already exists'); }
			await put('package.json', manifest);
			if (!await physicalImage(root, '.gitignore')) { await put('.gitignore', `${metadataDirectory}/\n`); }
		}
		// Mapping belongs to the structural snapshot; shared CodeMapping cannot address a predicate.
		await put(metadata, JSON.stringify(nextModel, null, '\t') + '\n');
		if (!mutations.length && base?.criteriaHash === criteriaHash && base.profileHash === profileHash && canonicalJson(base.artifacts) === canonicalJson(artifacts) && await hashSemanticModel(base.model) === await hashSemanticModel(model)) { return { status: 'aligned', calls: 0 }; }
		const id = randomUUID();
		const next: ProjectSnapshot = { version: 1, id, model: nextModel, artifacts, criteriaHash, profileHash, tests: generatedTests };
		const packets: StructuralSession['packets'] = [];
		for (const artifact of artifacts) {
			const prior = previous.find(item => item.predicateId === artifact.predicateId), sourceFile = direction === 'reverse' ? artifact.file : prior?.file, before = sourceFile ? await physicalImage(root, sourceFile) : null;
			const request: ModelTaskRequest = { version: 1, target: artifact.messagingId ? { kind: 'messaging', id: artifact.messagingId } : artifact.stateMachineId ? { kind: 'stateMachine', id: artifact.stateMachineId } : artifact.interactionId ? { kind: 'interaction', id: artifact.interactionId } : { kind: 'operation', id: artifact.operationId }, mode: direction === 'forward' ? 'generation' : 'reverse', ...(artifact.stateMachineId ? { additionalContext: [...new Set(Object.values(compileModelStateMachine(nextModel, artifact.stateMachineId).actions).flatMap(program => program.model.foundation.interactions.map(entry => entry.id)))].map(id => ({ kind: 'interaction' as const, id })) } : artifact.interactionId ? { additionalContext: compileModelInteraction(nextModel, artifact.interactionId).model.foundation.interactions.filter(entry => entry.id !== artifact.interactionId).map(entry => ({ kind: 'interaction' as const, id: entry.id })) } : {}), intent: modelTaskIntent(nextModel, artifact.messagingId ? 'messaging' : artifact.stateMachineId ? 'stateMachine' : artifact.interactionId ? 'interaction' : 'operation', artifact.messagingId ?? artifact.stateMachineId ?? artifact.interactionId ?? artifact.operationId, `Explicit ${direction} of owned behavior ${artifact.predicateId}`), profileId: archetype.profile.id, provider: { id: 'ordito-deterministic', model: 'structured-v1', configurationRevision: profileHash }, baselineRevision: contentHash(canonicalJson(base)), delta: [{ kind: artifact.messagingId ? 'messaging' : artifact.stateMachineId ? 'stateMachine' : artifact.interactionId ? 'interaction' : 'predicate', id: artifact.predicateId }], writeScope: { objects: [{ kind: 'operation', id: artifact.operationId }], files: before && sourceFile ? [sourceFile] : [], createOperationsUnder: [] }, retrievalScope: { objects: [], files: [] }, sources: before && sourceFile ? [{ file: sourceFile, revision: contentHash(before.content), language: 'javascript', length: before.content.length, producer: 'ordito-physical-v1', windows: [{ start: 0, text: before.content }] }] : [], budget: { maxInputBytes, maxContextBytes: maxInputBytes + 65536, outputReserveBytes: 65536, overheadReserveBytes: 0 } };
			signal?.throwIfAborted();
			packets.push({ request, packet: await prepareStructuralSourceContext(root, nextModel, request) });
		}
		signal?.throwIfAborted();
		const baseCommit = await repository(root), worktree = join(await managed(root, 'worktrees'), id);
		await git(root, ['worktree', 'add', '--detach', worktree, baseCommit]);
		const observed = await Promise.all([...new Set([metadata, criteriaFile, 'package.json', ...previous.map(artifact => artifact.file), ...artifacts.map(artifact => artifact.file), ...Object.keys(base?.tests ?? {}), ...Object.keys(generatedTests)])].map(async file => ({ file, value: await physicalImage(root, file) })));
		const session: StructuralSession = { version: 1, id, root, worktree, baseCommit, created: new Date().toISOString(), direction, status: 'staged', base, next, mutations, observed, modelHash: contentHash((await physicalImage(root, metadata))!.content), criteria: independent, criteriaHash, profileHash, packets, reviewId: '', calls: 0, cost: null, coverage: projectCoverage, ...(stackPlan ? { stackPlan } : {}), sourceInventory: sourceIndex.entries.map(entry => ({ file: entry.file, hash: entry.hash, mode: entry.mode })) };
		session.reviewId = seal(session);
		try { signal?.throwIfAborted(); for (const entry of observed) { if (!mutations.some(edit => edit.file === entry.file)) { await replacePhysicalImage(worktree, entry.file, await physicalImage(worktree, entry.file), entry.value); } } for (const mutation of mutations) { const actual = await physicalImage(worktree, mutation.file); await replacePhysicalImage(worktree, mutation.file, actual, mutation.after); } await save(session); }
		catch (error) { await git(root, ['worktree', 'remove', '--force', worktree]); throw error; }
		return { status: 'staged', calls: 0, session };
	});
}

async function assertSourceInventory(session: StructuralSession): Promise<void> {
	if (!session.sourceInventory) { return; } // Historical reviews retain their existing preimage checks.
	const index = await refreshStructuralSourceIndex(session.root);
	if (canonicalJson(index.entries.map(entry => ({ file: entry.file, hash: entry.hash, mode: entry.mode }))) !== canonicalJson(session.sourceInventory)) { throw new Error('Structural source inventory changed after review'); }
}
async function assertCurrent(session: StructuralSession): Promise<void> {
	await assertSourceInventory(session);
	if (contentHash((await physicalImage(session.root, `${await projectMetadataName(session.root)}/model.json`))?.content ?? '') !== session.modelHash || contentHash(canonicalJson(await json<ProjectCriteria>(await projectMetadataPath(session.root, 'criteria.json')))) !== session.criteriaHash || await modelArchetypeRevision(modelProjectProfile(session.next.model)) !== session.profileHash || canonicalJson(await baseline(session.root)) !== canonicalJson(session.base) || await git(session.root, ['rev-parse', 'HEAD']) !== session.baseCommit) { throw new Error('Structural review is stale'); }
	for (const entry of session.observed) { if (!samePhysicalImage(await physicalImage(session.root, entry.file), entry.value)) { throw new Error('Structural input changed after review'); } }
	for (const mutation of session.mutations) { if (!samePhysicalImage(await physicalImage(session.root, mutation.file), mutation.before) || !samePhysicalImage(await physicalImage(session.worktree, mutation.file), mutation.after)) { throw new Error('Structural source or worktree changed after review'); } }
	for (const artifact of session.next.artifacts) {
		const mutation = session.mutations.find(edit => edit.file === artifact.file);
		const staged = await physicalImage(session.worktree, artifact.file);
		if (!staged || mutation && !samePhysicalImage(staged, mutation.after) || ownedRegion(staged.content, artifact).region !== artifact.region) { throw new Error('Structural worktree changed after review'); }
		if (!mutation && !samePhysicalImage(await physicalImage(session.root, artifact.file), staged)) { throw new Error('Unchanged source changed after review'); }
	}
}

/** Expected business observations are authored data; derived expectations are kept separate. */
async function interactionHarness(model: SemanticModelV4, id: string, cases: InteractionCase[], importPath: string, includeIndependent: boolean): Promise<string> {
	const entries = cases.filter(entry => entry.interactionId === id), derived: InteractionCase[] = [];
	for (const entry of entries) { const result = await interpretModelInteraction(model, id, entry.input, entry.replies); derived.push({ ...entry, id: 'derived.' + entry.id, expected: { outcome: result.outcome, calls: result.trace.filter(event => event.kind === 'call').map(event => event.id), outputs: result.outputs, ...(result.error ? { error: result.error.code } : {}) } }); }
	return `import test from 'node:test';import assert from 'node:assert/strict';import run from ${JSON.stringify(importPath)};\nfor(const c of ${JSON.stringify([...derived, ...(includeIndependent ? entries : [])])}){test(c.id,async()=>{const r=await run(c.input,c.replies);assert.deepEqual({outcome:r.outcome,calls:r.trace.filter(t=>t.kind==='call').map(t=>t.id),outputs:r.outputs,...(r.error?{error:r.error.code}:{})},c.expected);});}\n`;
}

async function stateHarness(model: SemanticModelV4, id: string, cases: StateCase[], importPath: string, includeIndependent: boolean): Promise<string> {
	const entries = cases.filter(entry => entry.machineId === id), derived: StateCase[] = [];
	for (const entry of entries) { derived.push({ ...entry, id: 'derived.' + entry.id, expected: await interpretModelStateMachine(model, id, entry.scenario) }); }
	return `import test from 'node:test';import assert from 'node:assert/strict';import run from ${JSON.stringify(importPath)};\nfor(const c of ${JSON.stringify([...derived, ...(includeIndependent ? entries : [])])}){test(c.id,async()=>assert.deepEqual(await run(c.scenario),c.expected));}\n`;
}

function messagingHarness(model: SemanticModelV4, id: string, cases: MessagingCase[], importPath: string, independent: boolean): string {
	const entries = cases.filter(entry => entry.messagingId === id), program = compileModelMessaging(model, id), derived = entries.map(entry => ({ ...entry, id: 'derived.' + entry.id, expected: simulateMessaging(program, entry.scenario) }));
	return `import test from 'node:test';import assert from 'node:assert/strict';import run from ${JSON.stringify(importPath)};\nfor(const c of ${JSON.stringify([...derived, ...(independent ? entries : [])])}){test(c.id,()=>assert.deepEqual(run(c.scenario),c.expected));}\n`;
}

/** Node permission restricts reads/writes/processes; only emitter-owned pure code enters this runner. */
export async function verifyStructuralProject(root: string, id: string, reviewId: string, signal?: AbortSignal): Promise<StructuralSession> {
	return lock(root, async () => {
		await noInterrupted(root); const session = await readStructuralSession(root, id);
		if (!['staged', 'passed', 'failed', 'rolledBack'].includes(session.status) || reviewId !== session.reviewId) { throw new Error('Review the exact staged structural changes'); }
		await assertCurrent(session);
		if (process.versions.node !== '24.22.1') { throw new Error('Trusted runner requires Node 24.22.1'); }
		const archetype = modelProjectProfile(session.next.model);
		const started = performance.now(), target = join(await directory(root), 'verification', randomUUID()); await mkdir(target);
		let output = '', code = 0, generated = 0;
		try {
			for (const [index, artifact] of session.next.artifacts.entries()) {
				const predicate = session.next.model.foundation.predicates?.find(predicate => predicate.id === artifact.predicateId);
				await writeFile(join(target, `p${index}.mjs`), artifactCode(session.next.model, artifact), { flag: 'wx' });
				if (artifact.messagingId) { const cases = session.criteria.messaging?.filter(entry => entry.messagingId === artifact.messagingId) ?? []; generated += cases.length; await writeFile(join(target, `p${index}.test.mjs`), messagingHarness(session.next.model, artifact.messagingId, cases, `./p${index}.mjs`, true), { flag: 'wx' }); continue; }
				if (artifact.stateMachineId) { const cases = session.criteria.states?.filter(entry => entry.machineId === artifact.stateMachineId) ?? []; generated += cases.length; await writeFile(join(target, `p${index}.test.mjs`), await stateHarness(session.next.model, artifact.stateMachineId, cases, `./p${index}.mjs`, true), { flag: 'wx' }); continue; }
				if (artifact.interactionId) { const cases = session.criteria.interactions?.filter(entry => entry.interactionId === artifact.interactionId) ?? []; generated += cases.length; await writeFile(join(target, `p${index}.test.mjs`), await interactionHarness(session.next.model, artifact.interactionId, cases, `./p${index}.mjs`, true), { flag: 'wx' }); continue; }
				const independent = session.criteria.cases.filter(entry => entry.predicateId === artifact.predicateId);
				const derived = independent.map(entry => { let expected; try { expected = evaluateModelPredicate(session.next.model, predicate!, entry.input); } catch (error) { expected = predicateFailure(error); } return { ...entry, id: 'derived.' + entry.id, expected }; }); generated += derived.length;
				const harness = `import test from 'node:test';import assert from 'node:assert/strict';import check from './p${index}.mjs';\nfor(const c of ${JSON.stringify([...derived, ...independent])}){test(c.id,()=>{if(c.expected==='typeError'){assert.throws(()=>check(c.input),/input type mismatch/);}else if(typeof c.expected==='string'){assert.throws(()=>check(c.input),error=>error.message===c.expected);}else{assert.equal(check(c.input),c.expected);}});}`;
				await writeFile(join(target, `p${index}.test.mjs`), harness, { flag: 'wx' });
			}
			for (const file of (await readdir(target)).filter(file => file.endsWith('.mjs'))) { const check = await runProcess(process.execPath, ['--check', join(target, file)], target, { signal, env: {} }); if (check.code) { throw new Error('Trusted syntax check failed'); } }
			let executable = process.execPath;
			if (archetype.profile.id === 'bun.esm') {
				const configured = process.env.ORDITO_BUN_EXECUTABLE;
				if (!configured || !isAbsolute(configured)) { throw new Error('Configure an absolute ORDITO_BUN_EXECUTABLE for Bun 1.3.2; no Node fallback'); }
				executable = await realpath(configured);
				const version = await runProcess(executable, ['--version'], target, { signal, env: {}, timeoutMs: 5000, maxBytes: 1024 });
				if (version.code || version.stdout.trim() !== archetype.toolchain.version) { throw new Error('Bun runtime version mismatch'); }
			}
			const argumentsPrefix = archetype.profile.id === 'bun.esm' ? ['test', '--timeout', '10000'] : ['--permission', `--allow-fs-read=${target}`, '--disallow-code-generation-from-strings', '--test', '--test-isolation=none', '--test-reporter=tap'];
			if (session.next.artifacts.length) { const result = await runProcess(executable, [...argumentsPrefix, ...session.next.artifacts.map((_, index) => `./p${index}.test.mjs`)], target, { signal, timeoutMs: 30000, maxBytes: 1024 * 1024, env: {} }); code = result.code; output = result.stdout + result.stderr; }
			await assertCurrent(session);
		} catch (error) { code = -1; output = error instanceof Error ? error.message : 'Verification failed'; }
		finally { await rm(target, { recursive: true, force: true }); }
		session.status = code === 0 ? 'passed' : 'failed'; session.verification = { code, output, durationMs: performance.now() - started, generated, independent: session.criteria.cases.filter(entry => session.next.artifacts.some(artifact => !artifact.interactionId && !artifact.stateMachineId && !artifact.messagingId && artifact.predicateId === entry.predicateId)).length + (session.criteria.interactions?.filter(entry => session.next.artifacts.some(artifact => artifact.interactionId === entry.interactionId)).length ?? 0) + (session.criteria.states?.filter(entry => session.next.artifacts.some(artifact => artifact.stateMachineId === entry.machineId)).length ?? 0) + (session.criteria.messaging?.filter(entry => session.next.artifacts.some(artifact => artifact.messagingId === entry.messagingId)).length ?? 0), revision: reviewId, policy: `${archetype.profile.id}@${archetype.profile.revision}/${archetype.toolchain.version}; ` + (archetype.profile.id === 'bun.esm' ? 'bun-trusted-emitter-v1; no Node permission flags; ' : 'node-permission-v3; ') + 'structured-emitter/scripted-data; flat states and caller-persisted checkpoints; local timers and cooperative cancellation; messaging configuration and simulation only, no live broker; no arbitrary project tests, dependencies, secrets or commands; no OS/network sandbox claim' }; await save(session); return session;
	});
}

/** Check all images before any write. Baseline activation is the transaction commit point. */
export async function publishStructuralProject(root: string, id: string, reviewId: string, undo = false): Promise<StructuralSession> {
	return lock(root, async () => {
		await noInterrupted(root); const session = await readStructuralSession(root, id);
		if (session.reviewId !== reviewId || (undo ? session.status !== 'applied' : session.status !== 'passed' || session.verification?.code !== 0 || session.verification.revision !== reviewId)) { throw new Error('Publication requires reviewed independent passing checks'); }
		if (!undo) { await assertCurrent(session); }
		else if (canonicalJson(await baseline(root)) !== canonicalJson(session.next)) { throw new Error('Later baseline prevents undo'); }
		const mutations = undo ? [...session.mutations].reverse().map(edit => ({ ...edit, before: edit.after, after: edit.before })) : session.mutations;
		for (const edit of mutations) { if (!samePhysicalImage(await physicalImage(root, edit.file), edit.before)) { throw new Error(`Manual edits in ${edit.file} prevent publication or undo. Restore the reviewed file or prepare a new review.`); } }
		// Also protect unchanged executable sources, model and criteria on undo.
		if (undo) { for (const entry of session.observed) { const edit = session.mutations.find(edit => edit.file === entry.file); if (!samePhysicalImage(await physicalImage(root, entry.file), edit ? edit.after : entry.value)) { throw new Error(`Manual input edits in ${entry.file} prevent undo. Restore the reviewed file before retrying.`); } } }
		if (undo) { for (const artifact of session.next.artifacts) { if (!session.mutations.some(edit => edit.file === artifact.file) && ownedRegion((await physicalImage(root, artifact.file))?.content ?? '', artifact).region !== artifact.region) { throw new Error(`Manual source edits in ${artifact.file} prevent undo. Restore the reviewed file before retrying.`); } } }
		session.status = undo ? 'undoing' : 'publishing'; await save(session);
		try {
			for (const mutation of mutations) { await replacePhysicalImage(root, mutation.file, mutation.before, mutation.after); }
			if (!undo) { await atomicJson(join(await directory(root), 'snapshots', session.id + '.json'), session.next); }
			const destination = undo ? session.base : session.next;
			if (destination) { await atomicJson(join(await directory(root), 'active.json'), { id: destination.id }); } else { await rm(join(await directory(root), 'active.json'), { force: true }); }
			await refreshStructuralSourceIndex(root);
			session.status = undo ? 'undone' : 'applied'; await save(session); return session;
		} catch (error) { await recoverStructuralLocked(root, id); throw error; }
	});
}

async function recoverStructuralLocked(root: string, id: string): Promise<StructuralSession> {
	const session = await readStructuralSession(root, id); const undo = session.status === 'undoing';
	if (!['publishing', 'undoing'].includes(session.status)) { throw new Error('No interrupted structural publication'); }
	const active = await baseline(root), from = undo ? session.next : session.base, to = undo ? session.base : session.next;
	const committed = canonicalJson(active) === canonicalJson(to);
	if (!committed && canonicalJson(active) !== canonicalJson(from)) { throw new Error('Unknown baseline prevents recovery'); }
	for (const entry of session.observed.filter(entry => !session.mutations.some(edit => edit.file === entry.file))) { if (!samePhysicalImage(await physicalImage(root, entry.file), entry.value)) { throw new Error('Unknown manual input edits prevent recovery'); } }
	const edits = undo ? session.mutations.map(edit => ({ ...edit, before: edit.after, after: edit.before })) : session.mutations;
	for (const edit of edits) { const actual = await physicalImage(root, edit.file); if (!samePhysicalImage(actual, edit.before) && !samePhysicalImage(actual, edit.after) || committed && !samePhysicalImage(actual, edit.after)) { throw new Error('Unknown manual edits prevent recovery'); } }
	if (!committed) { for (const edit of [...edits].reverse()) { if (samePhysicalImage(await physicalImage(root, edit.file), edit.after)) { await replacePhysicalImage(root, edit.file, edit.after, edit.before); } } }
	await refreshStructuralSourceIndex(root);
	session.status = committed ? undo ? 'undone' : 'applied' : undo ? 'applied' : 'rolledBack'; await save(session); return session;
}
export async function recoverStructuralProject(root: string, id: string): Promise<StructuralSession> { return lock(root, () => recoverStructuralLocked(root, id)); }
