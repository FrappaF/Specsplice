import '../../scripts/source-loader.mjs';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Client as McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import type { StdioClientTransport as McpTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CodeAiProgress, CodeDiagramCheckpointResult, CodeDiagramExploration } from '../../../src/vs/workbench/contrib/ordito/common/codeBridge.ts';
import type { DiagramExplorationResult, ExplorationRequest } from '../diagramSession.ts';

const { createCodeEngine } = await import('../../runtime/nativeHost.ts');
const { validateCodeRequest } = await import('../../runtime/codeProtocol.ts');
const { executeDiagramExploration, readExplorationSession } = await import('../diagramSession.ts');

type FakeTask = {
	id: string;
	intent: string;
	proposalId: string;
	commands?: object[];
	evidenceIds?: string[];
	readObjectIds?: string[];
	resume?: boolean;
	stall?: boolean;
};

type ToolResult<Data> = Omit<DiagramExplorationResult, 'data'> & { data: Data };

/** Body of the temporary CLI. Its only project interaction goes through the production MCP child. */
async function fakeProvider(Client: typeof McpClient, StdioClientTransport: typeof McpTransport) {
	let input = '';
	for await (const chunk of process.stdin) { input += chunk; }
	const requestMarker = '\nTask request:\n';
	const setting = (key: string) => JSON.parse(process.argv.find(arg => arg.startsWith(`mcp_servers.ordito.${key}=`))!.split('=').slice(1).join('='));
	const args: string[] = setting('args');
	const { checkpoint: { phase } } = JSON.parse(args.at(-1)!);
	assert.ok(process.argv.includes('model_reasoning_effort="medium"'));
	const output = process.argv[process.argv.indexOf('--output-last-message') + 1];
	const emit = (event: object) => process.stdout.write(JSON.stringify(event) + '\n');
	emit({ type: 'turn.started' });
	const client = new Client({ name: 'mercato-timeout-fixture', version: '1' });
	await client.connect(new StdioClientTransport({ command: setting('command'), args }));
	try {
		const call = async <Data>(name: string, arguments_ = {}) => {
			const result = (await client.callTool({ name, arguments: arguments_ })).structuredContent as ToolResult<Data>;
			assert.deepEqual(result.diagnostics, [], name);
			emit({ type: 'item.completed', item: { type: 'mcp_tool_call', tool: name } });
			return result;
		};
		if (phase === 'audit') {
			assert.match(input, /^You are the independent Specsplice diagram auditor\./);
			assert.ok(!input.includes(requestMarker));
			const tools = (await client.listTools()).tools.map(tool => tool.name);
			assert.ok(tools.includes('ordito_audit_inventory') && tools.includes('ordito_audit_submit'));
			assert.ok(!tools.includes('ordito_model_propose') && !tools.includes('ordito_task_update') && !tools.includes('ordito_audit_repair'));
			const readObjects = async <Item>(tool: string, args: object = {}) => {
				const items: Item[] = [];
				let cursor: string | null = null;
				do {
					const { data: { objects } } = await call<{ objects: { items: Item[]; nextCursor: string | null } }>(tool, { ...args, ...(cursor ? { cursor } : {}) });
					items.push(...objects.items);
					cursor = objects.nextCursor;
				} while (cursor);
				return items;
			};
			const inventory = await call<{ views: { id: string; name: string }[]; files: { items: { file: string; revision: string }[] } }>('ordito_audit_inventory');
			assert.deepEqual(inventory.data.views.map(view => view.name), ['Marketplace · Overview', 'Checkout Structure', 'Returns Structure']);
			for (const { id } of inventory.data.views) { await readObjects('ordito_audit_diagram', { viewId: id }); }
			const orders = inventory.data.files.items.find(file => file.file === 'src/orders.mjs');
			assert.ok(orders);
			await call('ordito_source_read', { file: orders.file, revision: orders.revision });
			const reuse = await readObjects<{ name: string; viewIds: string[] }>('ordito_audit_reuse');
			assert.equal(reuse.find(object => object.name === 'Order Store')?.viewIds.length, inventory.data.views.length);
			const report = await call<{ checkpointComplete?: boolean }>('ordito_audit_submit', { summary: 'Verified the shared order store across all three views.', findings: [] });
			assert.equal(report.data.checkpointComplete, true);
			await writeFile(output, 'Audit completed.');
			emit({ type: 'turn.completed' });
			return;
		}
		const task: FakeTask = JSON.parse(JSON.parse(input.slice(input.lastIndexOf(requestMarker) + requestMarker.length))[0].text);
		const inspected = await call<{ exploration: { nextTaskId: string; task: { proposalId?: string; previewedProposalId?: string } } }>('ordito_project_inspect');
		assert.equal(inspected.data.exploration.nextTaskId, task.id);
		const update = (status: 'running' | 'ready') => call<{ checkpointComplete?: boolean }>('ordito_task_update', { id: task.id, intent: task.intent, status, gaps: [], ...(status === 'ready' ? { proposalId: task.proposalId } : {}) });
		if (task.resume) {
			assert.deepEqual([inspected.data.exploration.task.proposalId, inspected.data.exploration.task.previewedProposalId], [task.proposalId, task.proposalId]);
		} else {
			const running = await update('running');
			const candidate = await call<{ status: string }>('ordito_model_propose', {
				taskId: task.id, proposalId: task.proposalId, baseSemanticRevision: running.semanticRevision,
				commands: task.commands, readEvidenceIds: task.evidenceIds, readObjectIds: task.readObjectIds, queryIds: [],
			});
			assert.equal(candidate.data.status, 'ready');
			await call('ordito_view_preview', { proposalId: task.proposalId });
		}
		if (task.stall) {
			// Leave a preview and its proposal checkpoint on disk, then stop emitting output.
			await new Promise(resolve => setTimeout(resolve, 15_000));
			throw new Error('Expected the provider process deadline to be enforced');
		}
		assert.equal((await update('ready')).data.checkpointComplete, true);
		await writeFile(output, 'Checkpoint completed.');
		emit({ type: 'turn.completed' });
	} finally { await client.close(); }
}

test('only checkpoint requests accept whole-minute attempt limits from 1 through 90', () => {
	const chat = { operation: 'diagramChat', root: '/unused', snapshot: '/unused', sessionId: 'checkpoint-session', config: '{}', messages: [{ role: 'user', text: 'Resume' }] };
	for (const checkpointTimeoutMinutes of [undefined, 1, 90]) {
		const request = { ...chat, checkpoint: true, ...(checkpointTimeoutMinutes === undefined ? {} : { checkpointTimeoutMinutes }) };
		assert.doesNotThrow(() => validateCodeRequest(request));
	}
	for (const checkpointTimeoutMinutes of [-1, 0, 91, 2.5, '20', null]) {
		assert.throws(() => validateCodeRequest({ ...chat, checkpoint: true, checkpointTimeoutMinutes }), /diagramChat.*checkpointTimeoutMinutes/);
	}
	assert.throws(() => validateCodeRequest({ ...chat, checkpointTimeoutMinutes: 20 }), /diagramChat.*checkpoint/);
	assert.throws(() => validateCodeRequest({ ...chat, checkpoint: false, checkpointTimeoutMinutes: 20 }), /diagramChat.*checkpoint/);
	assert.throws(() => validateCodeRequest({ operation: 'exploration', snapshot: '/unused', request: '{}', checkpointTimeoutMinutes: 20 }), /exploration.*additional properties/);
});

test('only checkpoint requests accept the scoped reasoning effort', () => {
	const chat = { operation: 'diagramChat', root: '/unused', snapshot: '/unused', sessionId: 'checkpoint-session', config: '{}', messages: [{ role: 'user', text: 'Resume' }] };
	for (const checkpointReasoningEffort of ['inherit', 'low', 'medium', 'high']) {
		assert.doesNotThrow(() => validateCodeRequest({ ...chat, checkpoint: true, checkpointReasoningEffort }));
	}
	assert.throws(() => validateCodeRequest({ ...chat, checkpointReasoningEffort: 'medium' }), /diagramChat.*checkpoint/);
	assert.throws(() => validateCodeRequest({ ...chat, checkpoint: true, checkpointReasoningEffort: 'invalid' }), /diagramChat.*checkpointReasoningEffort/);
});

test('Marketplace overview resumes its saved preview after a provider deadline', { timeout: 30_000, skip: process.platform === 'win32' }, async t => {
	const directory = await mkdtemp(join(tmpdir(), 'ordito-mercato-timeout-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const root = join(directory, 'mercato'), executable = join(directory, 'fake-codex.mjs');
	await cp(new URL('../../examples/user-guide/08-marketplace-codebase/', import.meta.url), root, { recursive: true });
	await writeFile(executable, [
		'#!/usr/bin/env node',
		`import assert from 'node:assert/strict';`,
		`import { writeFile } from 'node:fs/promises';`,
		`import { Client } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/client/index.js'))};`,
		`import { StdioClientTransport } from ${JSON.stringify(import.meta.resolve('@modelcontextprotocol/sdk/client/stdio.js'))};`,
		`await (${fakeProvider.toString()})(Client, StdioClientTransport);\n`,
	].join('\n'), { mode: 0o700 });
	const engine = createCodeEngine();
	const { snapshot } = JSON.parse(await engine.execute(JSON.stringify({ operation: 'import', root })));
	const { sessionId } = await executeDiagramExploration(snapshot, { action: 'open', workflow: 'project', featureWorkflow: true });
	const call = <Data>(action: ExplorationRequest['action'], arguments_: Partial<ExplorationRequest> = {}) => executeDiagramExploration(snapshot, { action, sessionId, ...arguments_ }) as Promise<ToolResult<Data>>;
	const tool = async <Data>(name: string, arguments_: object) => {
		const result = await call<Data>('tool', { tool: name, arguments: arguments_ });
		assert.deepEqual(result.diagnostics, [], name);
		return result.data;
	};
	const anchor = async (name: string, filePrefix: string) => {
		const { page } = await tool<{ page: { items: { name: string; evidence: { id: string } }[] } }>('ordito_source_search', { mode: 'symbol', query: name, filePrefix, role: 'runtime' });
		return page.items.find(item => item.name === name)!.evidence.id;
	};
	const server = await anchor('createMarketplaceServer', 'src/server.mjs');
	const orders = await anchor('createOrderStore', 'src/orders.mjs');
	const purchase = { id: 'checkout', name: 'Checkout', description: 'Confirms an approved order', evidenceIds: [await anchor('checkout', 'src/checkout.mjs')], dependsOn: [] };
	const returns = { id: 'returns', name: 'Returns', description: 'Records a return for an existing order', evidenceIds: [await anchor('returnOrder', 'src/returns.mjs')], dependsOn: [purchase.id] };
	await tool('ordito_feature_catalog', { features: [purchase, returns] });
	const overview = { id: 'system-overview', name: 'Marketplace · Overview', viewKind: 'structure', intent: 'Show the server and shared order store', rationale: 'Describe how the local system is composed', dependsOn: [] };
	await tool('ordito_diagram_plan', { items: [overview] });
	const show = (plan: Pick<typeof overview, 'name' | 'intent' | 'viewKind'>, elementIds: string[], relationIds: string[], featureId?: string) => ({ kind: 'view', ref: '@view', name: plan.name, viewKind: plan.viewKind, intent: plan.intent, elementIds, relationIds, ...(featureId ? { featureId } : {}) });
	const element = (ref: string, kind: string, name: string, evidence: string) => ({ kind: 'element', ref, element: { kind, name }, evidenceIds: [evidence] });
	const relation = (ref: string, kind: string, from: string, to: string, name: string, evidence: string) => ({ kind: 'relation', ref, relation: { kind, from, to, name }, evidenceIds: [evidence] });
	const overviewTask = {
		id: overview.id, intent: overview.intent, proposalId: 'mercato-overview', evidenceIds: [server, orders], readObjectIds: [],
		commands: [element('@server', 'component', 'HTTP Server', server), element('@orders', 'resource', 'Order Store', orders),
			relation('@storage', 'dependency', '@server', '@orders', 'Shares the order store', server), show(overview, ['@server', '@orders'], ['@storage'])],
	};
	const progress: CodeAiProgress[] = [];
	const run = async (requestId: string, task: FakeTask | { audit: true }, checkpointTimeoutMinutes?: number, onProgress?: (event: CodeAiProgress) => void, signal?: AbortSignal): Promise<CodeDiagramCheckpointResult> => JSON.parse(await engine.execute(JSON.stringify({
		operation: 'diagramChat', checkpoint: true, checkpointTimeoutMinutes, root, snapshot, sessionId, requestId,
		config: JSON.stringify({ version: 1, provider: 'codex', connection: 'cli', executable, model: 'fixture-local', timeoutMs: 300_000, maxContextBytes: 262144, maxCalls: 1 }),
		messages: [{ role: 'user', text: JSON.stringify(task) }],
	}), signal, event => { progress.push(event); onProgress?.(event); }));
	const observeTimers = async (action: () => Promise<CodeDiagramCheckpointResult>) => {
		const timers = t.mock.method(globalThis, 'setTimeout');
		try { return { result: await action(), delays: timers.mock.calls.map(call => call.arguments[1]) }; }
		finally { timers.mock.restore(); }
	};
	const previewed = Promise.withResolvers<void>();
	const abort = new AbortController();
	const safetyDeadline = AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]);
	const timers = t.mock.method(globalThis, 'setTimeout');
	const stalled = run('system-stalled', { ...overviewTask, stall: true }, undefined, event => {
		if (event.kind === 'tool' && event.tool === 'ordito_view_preview') { previewed.resolve(); }
	}, safetyDeadline);
	let interrupted: CodeDiagramCheckpointResult;
	try {
		await Promise.race([previewed.promise, stalled.then(() => assert.fail('Expected an overview preview before the provider deadline'))]);
		// Trigger the scheduled total deadline directly, without also expiring the shorter idle timer.
		const deadline = timers.mock.calls.find(call => call.arguments[1] === 20 * 60_000);
		assert.ok(deadline, 'Expected a 20-minute checkpoint deadline');
		deadline.arguments[0]();
		interrupted = await stalled;
	} finally {
		abort.abort();
		await stalled.catch(() => {});
		timers.mock.restore();
	}
	const saved = await readExplorationSession(root, sessionId);
	const orderId = saved.proposals[0]?.aliases['@orders'];
	assert.ok(orderId);
	assert.deepEqual([
		interrupted.timeout,
		progress.filter(event => event.requestId === 'system-stalled' && event.kind === 'tool').map(event => event.tool),
		saved.tasks.map(task => [task.id, task.status, task.proposalId, task.previewedProposalId]),
	], [
		'deadline',
		['ordito_project_inspect', 'ordito_task_update', 'ordito_model_propose', 'ordito_view_preview'],
		[[overview.id, 'running', overviewTask.proposalId, overviewTask.proposalId]],
	]);
	const { result: resumed, delays: resumedDelays } = await observeTimers(() => run('system-resumed', { id: overview.id, intent: overview.intent, proposalId: overviewTask.proposalId, resume: true }, 7));
	assert.ok(resumedDelays.includes(7 * 60_000), 'Expected the configured seven-minute deadline');
	const resumedState = await call<CodeDiagramExploration>('status');
	assert.deepEqual([
		resumed.text, resumedState.data.phase, resumedState.data.nextFeatureId,
		progress.filter(event => event.requestId === 'system-resumed' && event.kind === 'tool').map(event => event.tool),
	], ['Checkpoint completed.', 'planning', purchase.id, ['ordito_project_inspect', 'ordito_task_update']]);
	for (const [feature, kind, accessName] of [[purchase, 'write', 'Saves order'], [returns, 'read', 'Reads order']] as const) {
		const plan = { id: `${feature.id}-structure`, name: `${feature.name} Structure`, viewKind: 'structure', intent: feature.description, rationale: 'Shows access to the shared order store', dependsOn: [overview.id] };
		await tool('ordito_diagram_plan', { featureId: feature.id, items: [plan] });
		const [evidence] = feature.evidenceIds;
		const { candidates } = await tool<{ candidates: { id: string }[] }>('ordito_model_query', { collection: 'elements', match: { kind: 'resource', name: 'Order Store', evidenceIds: [orders] } });
		assert.deepEqual(candidates.map(candidate => candidate.id), [orderId]);
		const task = {
			id: plan.id, intent: plan.intent, proposalId: `${feature.id}-proposal`, evidenceIds: [evidence, orders], readObjectIds: [orderId], commands: [
				element('@feature', 'feature', feature.name, evidence), element('@action', 'action', feature.description, evidence),
				relation('@access', kind, '@action', orderId, accessName, evidence), show(plan, ['@action', orderId], ['@access'], '@feature'),
			],
		};
		if (feature === returns) {
			const maxDurationMs = 2 * 60_000;
			await call('budget', { budget: { ...resumedState.data.budget, maxDurationMs } });
			const { result, delays } = await observeTimers(() => run(`${feature.id}-ready`, task, 90));
			assert.ok(delays.some(delay => delay !== undefined && delay > maxDurationMs - 20_000 && delay < maxDurationMs), 'Expected the deadline to use the remaining project budget');
			assert.equal(result.text, 'Checkpoint completed.');
		} else {
			assert.equal((await run(`${feature.id}-ready`, task)).text, 'Checkpoint completed.');
		}
	}
	const viewNames = [overview.name, 'Checkout Structure', 'Returns Structure'];
	const audited = await run('independent-audit', { audit: true });
	assert.equal(audited.text, 'Audit completed.');
	const review = await call<{ auditReport: { findings: unknown[] }; proposal: { status: string; views: { name: string; nodes: { elementId: string }[] }[] } }>('review');
	assert.deepEqual([
		review.data.proposal.status,
		review.data.proposal.views.map(view => [view.name, view.nodes.filter(node => node.elementId === orderId).length]),
		(await readExplorationSession(root, sessionId)).proposals.map(proposal => proposal.id),
		review.data.auditReport.findings,
	], ['ready', viewNames.map(name => [name, 1]), [overviewTask.proposalId, 'checkout-proposal', 'returns-proposal'], []]);
});
