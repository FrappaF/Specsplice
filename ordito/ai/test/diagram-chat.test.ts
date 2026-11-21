import '../../scripts/source-loader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, stat } from 'node:fs/promises';
import { ProcessTimeoutError } from '../process.ts';
const { runDiagramChat } = await import('../diagramChat.ts');

const config = { version: 1, provider: 'codex', connection: 'cli', executable: 'codex', model: 'test-model', timeoutMs: 300000, maxContextBytes: 262144, maxCalls: 1 };

test('headless conversations are ephemeral, tool-scoped, cancellable and clean up their response artifact', async () => {
	const controller = new AbortController();
	let responsePath = '';
	const messages = [{ role: 'user' as const, text: 'Generate the diagrams' }];
	const result = await runDiagramChat('/project', config, messages, { command: 'node', args: ['/Specsplice/orditoDiagramMcp.js', '/project', 'session'] }, controller.signal, async (executable, args, cwd, options) => {
		responsePath = args[args.indexOf('--output-last-message') + 1];
		assert.deepEqual([executable, cwd, options?.signal, args.includes('--ephemeral'), args.includes('mcp_servers={}'), args.includes('shell_tool'), args.includes('read-only'), args.includes('mcp_servers.ordito.command="node"')], ['codex', '/project', controller.signal, true, true, true, true, true]);
		assert.match(options!.input!, /Generate the diagrams/);
		await writeFile(responsePath, 'Drafts prepared');
		return { code: 0, stdout: '{"type":"turn.completed"}\n', stderr: '' };
	});
	assert.deepEqual(result, { text: 'Drafts prepared' });
	await assert.rejects(stat(responsePath), { code: 'ENOENT' });
});

test('a failed or unfinished CLI turn never looks successful or exposes raw provider stderr', async () => {
	for (const result of [{ code: 1, stdout: '', stderr: 'private-provider-data' }, { code: 0, stdout: '{"type":"turn.failed"}', stderr: 'private-provider-data' }]) {
		await assert.rejects(runDiagramChat('/project', config, [{ role: 'user', text: 'Generate diagrams' }], undefined, undefined, async () => result), error => error instanceof Error && /assistant/i.test(error.message) && !error.message.includes('private-provider-data'));
	}
});

test('Claude conversations disable persistence and expose only the Specsplice server', async () => {
	const result = await runDiagramChat('/project', { ...config, provider: 'claude', executable: 'claude' }, [{ role: 'user', text: 'Explain the architecture' }], { command: 'node', args: ['adapter', '/project'] }, undefined, async (_executable, args) => {
		assert.deepEqual([args.includes('--no-session-persistence'), args.includes('--strict-mcp-config'), args.includes('mcp__ordito__*'), JSON.parse(args[args.indexOf('--mcp-config') + 1])], [true, true, true, { mcpServers: { ordito: { type: 'stdio', command: 'node', args: ['adapter', '/project'] } } }]);
		return { code: 0, stdout: '{"subtype":"success","result":"Ready"}', stderr: '' };
	});
	assert.deepEqual(result, { text: 'Ready' });
});

test('automatic Codex checkpoints use a scoped reasoning effort with an inheritance option', async () => {
	for (const [provider, checkpoint, effort, expected] of [
		['codex', 'discovery', undefined, 'medium'],
		['codex', 'diagrams', 'low', 'low'],
		['codex', 'audit', 'high', 'high'],
		['codex', 'repair', 'inherit', undefined],
		['codex', false, 'low', undefined],
		['claude', 'diagrams', 'low', undefined],
	] as const) {
		await runDiagramChat('/project', { ...config, provider, executable: provider }, [{ role: 'user', text: 'Prepare diagrams' }], { command: 'node', args: ['adapter'] }, undefined, async (_executable, args) => {
			assert.deepEqual(args.filter(arg => arg.startsWith('model_reasoning_effort=')), expected ? [`model_reasoning_effort="${expected}"`] : []);
			assert.equal(args.includes('--effort'), false);
			if (provider === 'claude') { return { code: 0, stdout: '{"subtype":"success","result":"Ready"}', stderr: '' }; }
			await writeFile(args[args.indexOf('--output-last-message') + 1], 'Ready');
			return { code: 0, stdout: '{"type":"turn.completed"}\n', stderr: '' };
		}, undefined, undefined, undefined, checkpoint, effort);
	}
});

test('disabled requests or oversized conversations do not start a provider process', async () => {
	const runner = async () => { assert.fail('provider must not start'); };
	await assert.rejects(runDiagramChat('/project', { ...config, maxCalls: 0 }, [{ role: 'user', text: 'Generate' }], undefined, undefined, runner), /disabled/);
	await assert.rejects(runDiagramChat('/project', config, [{ role: 'user', text: 'x'.repeat(262144) }], undefined, undefined, runner), /context budget/);
});

test('CLI progress handles split JSON frames and strips inherited debugger injection', async () => {
	const progress: { kind: string; text?: string; tool?: string }[] = [];
	await runDiagramChat('/project', config, [{ role: 'user', text: 'Repair the saved plan' }], { command: 'node', args: ['adapter', '/project'] }, undefined, async (_executable, args, _cwd, options) => {
		assert.deepEqual([options?.env?.NODE_OPTIONS, options?.env?.VSCODE_INSPECTOR_OPTIONS, options?.env?.ELECTRON_RUN_AS_NODE, args.includes('mcp_servers.ordito.required=true')], [undefined, undefined, undefined, true]);
		options!.onOutput!('{"type":"turn.star', 'stdout'); options!.onOutput!('ted"}\n', 'stdout');
		options!.onOutput!('{"type":"item.started","item":{"type":"mcp_tool_call","tool":"ordito_proposal_discard"}}\n', 'stdout');
		options!.onOutput!('{"type":"item.completed","item":{"id":"response","type":"agent_message","text":"Repaired"}}\n', 'stdout');
		await writeFile(args[args.indexOf('--output-last-message') + 1], 'Repaired');
		return { code: 0, stdout: '{"type":"turn.completed"}\n', stderr: '' };
	}, undefined, event => progress.push(event), { plan: { items: [{ id: 'overview' }] }, blockers: ['invalidDraft:old'] });
	assert.deepEqual(progress.map(event => [event.kind, event.text ?? event.tool ?? null]), [['connecting', null], ['thinking', null], ['tool', 'ordito_proposal_discard'], ['message', 'Repaired']]);
});


test('a CLI that produces no startup response has a bounded actionable failure', async () => {
	const { runProcess } = await import('../process.ts');
	await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], process.cwd(), { startupTimeoutMs: 50, timeoutMs: 2000, gracefulShutdownMs: 20 }), /provider CLI did not start responding/);
});

test('active chat is not cut off at the five-minute silence limit and session deadlines remain bounded', async () => {
	for (const [budget, expected] of [[undefined, 1800000], [900000, 900000], [5400000, 5400000], [7200000, 5400000]] as const) {
		await runDiagramChat('/project', config, [{ role: 'user', text: 'Update the diagrams' }], undefined, undefined, async (_executable, args, _cwd, options) => {
			assert.deepEqual([options?.timeoutMs, options?.idleTimeoutMs, options?.startupTimeoutMs], [expected, 300000, 45000]);
			assert.match(options!.input!, /For diagram-only requests/);
			await writeFile(args[args.indexOf('--output-last-message') + 1], 'Prepared');
			return { code: 0, stdout: '{"type":"turn.completed"}\n', stderr: '' };
		}, budget);
	}
});

test('a total deadline explains how to continue while cancellation remains distinct', async () => {
	await assert.rejects(runDiagramChat('/project', config, [{ role: 'user', text: 'Update' }], undefined, undefined, async () => { throw new ProcessTimeoutError('deadline'); }), /time limit.*drafts are retained.*follow-up/i);
	const cancelled = new Error('Operation cancelled');
	await assert.rejects(runDiagramChat('/project', config, [{ role: 'user', text: 'Update' }], undefined, undefined, async () => { throw cancelled; }), error => error === cancelled);
});

test('checkpoint chat preserves structured provider timeout reasons for native recovery', async () => {
	for (const reason of ['startup', 'idle', 'deadline'] as const) {
		const failure = new ProcessTimeoutError(reason);
		await assert.rejects(runDiagramChat('/project', config, [{ role: 'user', text: 'Continue the saved diagram' }], { command: 'node', args: [] }, undefined, async () => { throw failure; }, 300000, undefined, undefined, true), error => error === failure);
	}
});
