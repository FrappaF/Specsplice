import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from './process.ts';
import { readProviderConfig, planSchema, type StructuredProvider, type PlanProvider } from './contracts.ts';
import { planningInstruction } from './protocol.ts';
import { readImplementationPlan } from './plan.ts';
import { readBoundedText } from './io.ts';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Original CLIs own login, credential storage and provider communication. No token files are read. */
export function createCliProvider(runner = runProcess): StructuredProvider {
	return {
		async complete(configValue, prompt, schema, signal) {
			const config = readProviderConfig(configValue);
			signal?.throwIfAborted();
			if (Buffer.byteLength(prompt) + Buffer.byteLength(JSON.stringify(schema)) > config.maxContextBytes) { throw new Error('Complete provider input exceeds the configured byte budget; narrow the request'); }
			const directory = await mkdtemp(join(tmpdir(), 'ordito-inference-'));
			try {
				await writeFile(join(directory, 'schema.json'), JSON.stringify(schema), { mode: 0o600 });
				const args = config.provider === 'codex'
					? ['exec', '--model', config.model, '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', ...['shell_tool', 'unified_exec', 'apps', 'plugins', 'remote_plugin', 'multi_agent', 'hooks', 'skill_search', 'skill_mcp_dependency_install'].flatMap(feature => ['--disable', feature]), '-c', 'mcp_servers={}', '-c', 'web_search="disabled"', '--json', '--output-schema', join(directory, 'schema.json'), '--output-last-message', join(directory, 'response.json'), '-']
					: ['-p', '--model', config.model, '--permission-mode', 'plan', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '', '--no-session-persistence', '--output-format', 'json', '--json-schema', JSON.stringify(schema)];
				const result = await runner(config.executable, args, directory, { input: prompt, signal, timeoutMs: config.timeoutMs, maxBytes: 4 * 1024 * 1024 });
				if (result.code !== 0) {
					// Diagnose common failures without exposing raw provider output, credentials or source context.
					const output = result.stderr + '\n' + result.stdout;
					if (/rate.?limit|quota|usage.limit|\b429\b/i.test(output)) { throw new Error('Provider quota or rate limit reached. Check the account limits in the original CLI and retry later.'); }
					if (/unauthorized|unauthenticated|not logged in|authentication.*(required|failed)|\b401\b/i.test(output)) { throw new Error('Provider authentication failed. Refresh the CLI account, or sign in with the same executable and CODEX_HOME used by Specsplice'); }
					if (/model[_-](not[_-]found|not[_-]available|access[_-]denied)|model.{0,100}(not found|not available|does not exist|not supported|isn't supported|access)|unsupported.{0,30}model/i.test(output)) { throw new Error(`The selected model "${config.model}" is unavailable to this CLI account. Open the same CLI, check its model selector and choose an exact model ID supported by the account.`); }
					if (/unknown feature|unrecognized (option|argument)|unexpected argument|unknown (option|flag)/i.test(output)) { throw new Error('The provider CLI rejected a Specsplice command option. Check the version of the configured CLI executable and update it, then retry.'); }
					if (/invalid[_ -]json[_ -]schema|invalid schema|schema.{0,100}(not supported|unsupported|invalid|required)/i.test(output)) { throw new Error('The provider rejected the structured output schema supplied by Specsplice Check that the selected model supports structured output; if it does, report this as a Specsplice schema compatibility issue.'); }
					throw new Error(`Provider CLI failed with exit code ${result.code}. Open the original CLI to inspect its version, model access and connection, then retry.`);
				}
				try {
					let value: unknown;
					let usage: Record<string, unknown> = {};
					if (config.provider === 'codex') {
						const text = await readBoundedText(join(directory, 'response.json'), 2 * 1024 * 1024);
						value = JSON.parse(text);
						const events: unknown[] = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
						if (events.some(event => record(event) && ['turn.failed', 'error'].includes(String(event.type)))) { throw new Error(); }
						const completed = events.filter(event => record(event) && event.type === 'turn.completed');
						if (completed.length > 1) { throw new Error(); }
						usage = completed.length && record(completed[0]) && record(completed[0].usage) ? completed[0].usage : {};
					} else {
						const response: unknown = JSON.parse(result.stdout);
						if (!record(response) || response.type !== 'result' || response.is_error === true || response.subtype !== 'success') { throw new Error(); }
						value = response.structured_output;
						usage = record(response.usage) ? response.usage : {};
					// CLI total_cost_usd can be an API-equivalent estimate for a subscription;
					// it is not proof of money charged to the user's account.
					}
					return { value, usage: { inputTokens: count(usage.input_tokens), outputTokens: count(usage.output_tokens) }, cost: null };
				} catch { throw new Error('Provider CLI returned invalid or incomplete structured output'); }
			} finally { await rm(directory, { recursive: true, force: true }); }
		}
	};
}

export function createPlanProvider(provider = createCliProvider()): PlanProvider {
	return {
		async propose(config, context, signal) {
			const response = await provider.complete(config, planningInstruction + '\n' + JSON.stringify(context), planSchema, signal);
			return { plan: readImplementationPlan(response.value, context), usage: response.usage };
		}
	};
}
