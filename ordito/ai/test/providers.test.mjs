import '../../scripts/source-loader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const { createCliProvider } = await import('../providers.ts');
const { runProcess } = await import('../process.ts');
import { config } from './fixtures.mjs';

test('Codex uses the original CLI, stdin, read-only workspace and structured final output', async () => {
	let invocation;
	const provider = createCliProvider(async (executable, args, cwd, options) => {
		invocation = { executable, args, input: options.input };
		await writeFile(args[args.indexOf('--output-last-message') + 1], '{"answer":true}');
		return { code: 0, stdout: JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 7, output_tokens: 9 } }), stderr: 'never forwarded' };
	});
	const result = await provider.complete(config, 'explicit context', { type: 'object' });
	assert.deepEqual(result, { value: { answer: true }, usage: { inputTokens: 7, outputTokens: 9 }, cost: null });
	assert.equal(invocation.executable, 'codex');
	assert.equal(invocation.input, 'explicit context');
	assert.ok(invocation.args.includes('read-only') && invocation.args.includes('shell_tool'));
	assert.ok(['unified_exec', 'multi_agent', 'apps', 'plugins', 'hooks', 'mcp_servers={}'].every(value => invocation.args.includes(value)));
});

test('Claude uses its login, disables project tools, and does not misrepresent API-equivalent usage as an actual charge', async () => {
	const provider = createCliProvider(async (executable, args) => {
		assert.equal(executable, 'claude');
		assert.equal(args[args.indexOf('--tools') + 1], '');
		return { code: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: { answer: true }, usage: { input_tokens: 4 }, total_cost_usd: 0.002 }), stderr: '' };
	});
	assert.deepEqual(await provider.complete({ ...config, provider: 'claude', executable: 'claude' }, 'context', {}), { value: { answer: true }, usage: { inputTokens: 4, outputTokens: null }, cost: null });
});

test('failed, truncated, refused and malformed CLI responses never become successful output or leak stderr', async () => {
	for (const response of [{ code: 1, stdout: '', stderr: 'fixture-sensitive-error' }, { code: 0, stdout: '{"type":"result","subtype":"error_max_turns"}', stderr: '' }, { code: 0, stdout: 'malformed fixture-sensitive-error', stderr: '' }]) {
		const provider = createCliProvider(async () => response);
		await assert.rejects(provider.complete({ ...config, provider: 'claude', executable: 'claude' }, 'context', {}), error => !error.message.includes('fixture-sensitive-error'));
	}
});

test('subprocesses preserve literal arguments, bound output, and terminate on deadlines or cancellation', async () => {
	const result = await runProcess(process.execPath, ['-e', 'require("node:fs").writeSync(1,process.argv[1])', '$(echo injected); literal'], tmpdir());
	assert.equal(result.stdout, '$(echo injected); literal');
	await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], tmpdir(), { timeoutMs: 100 }), /timed out/);
	await assert.rejects(runProcess(process.execPath, ['-e', 'require("node:fs").writeSync(1,"x".repeat(10000))'], tmpdir(), { maxBytes: 100 }), /exceeds limit/);
	const controller = new AbortController();
	const pending = runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], tmpdir(), { signal: controller.signal });
	controller.abort();
	await assert.rejects(pending, /cancelled/);
});

test('provider errors distinguish quota, authentication and model access without leaking stderr', async () => {
	for (const [output, expected] of [['429 quota exceeded', /quota or rate limit/], ['401 authentication failed', /authentication failed/], ['model is not available', /selected model .* unavailable/], ['{"error":{"code":"model_not_found"}}', /selected model .* unavailable/], ["The model isn't supported with this account", /selected model .* unavailable/], ['error: unknown feature: hooks', /rejected a Specsplice command option/], ['error: unexpected argument --ephemeral', /rejected a Specsplice command option/], ['invalid_json_schema: schema rejected', /rejected the structured output schema/]]) {
		const provider = createCliProvider(async () => ({ code: 1, stdout: '', stderr: output + ' private-fixture-value' }));
		await assert.rejects(provider.complete(config, 'context', {}), error => expected.test(error.message) && !error.message.includes('private-fixture-value'));
	}
});
