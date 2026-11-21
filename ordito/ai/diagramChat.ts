import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProcessTimeoutError, runProcess } from './process.ts';
import { readProviderConfig, type ProviderConfig } from './contracts.ts';
import { readBoundedText } from './io.ts';
import { diagramSessionInstruction } from '../../src/vs/workbench/contrib/ordito/common/diagramTools.ts';
import { type CodeAiProgress, type CodeUpdateResult, type DiagramCheckpointReasoningEffort } from '../../src/vs/workbench/contrib/ordito/common/codeBridge.ts';
import { defaultDiagramCheckpointReasoningEffort } from '../../src/vs/workbench/contrib/ordito/common/diagramExplorationSettings.ts';
import { diagramCheckpointInstruction, specializedDiagramCheckpointInstruction, type DiagramCheckpoint } from './diagramCheckpoint.ts';

type Progress = (event: Omit<CodeAiProgress, 'requestId'>) => void;

const codeUpdateResultSchema = {
	type: 'object', additionalProperties: false, required: ['outcome', 'text'],
	properties: { outcome: { type: 'string', enum: ['implemented', 'already-aligned', 'needs-input'] }, text: { type: 'string' } }
};
const codeUpdateInstruction = `Implement only the saved Specsplice model changes below in the current project's existing codebase. This is a single code update request. Before and after values describe the author's intent, not claims about the current source. View and source hints help locate the affected contracts; they are not independent change requests. Use them and inspect only the relevant implementation, callers and tests. The delta is the model context for this update. Do not load the full Specsplice model.

Implement the smallest changes needed to satisfy the delta, following the project's existing conventions. Preserve unrelated behavior, files and local edits. Removing an element from a view alone does not authorize deleting the shared definition or its implementation. Do not write to .ordito or other Specsplice model files. Leave any source edits local for review. Do not commit, push, deploy or perform destructive migrations.

Run targeted tests for the affected behavior when available. Report files changed, tests actually run and their results, and remaining limitations. Use outcome implemented for a complete implementation, already-aligned when the affected behavior already matches or the changes require no code, and needs-input if intent is ambiguous or work remains incomplete. Ask a concrete question with needs-input and identify any partial edits. For already-aligned, explain the no-op without editing the source. Summarize the result and verification in text.`;

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRecordChange(value: unknown): boolean {
	return isRecord(value) && Object.keys(value).length === 4 && typeof value.id === 'string' && typeof value.collection === 'string'
		&& (value.before === null || isRecord(value.before)) && (value.after === null || isRecord(value.after))
		&& (value.before !== null || value.after !== null);
}

function parseCodeUpdateContext(context: string): object {
	try {
		const value: unknown = JSON.parse(context);
		if (isRecord(value) && Object.keys(value).length === 7 && value.version === 2 && value.direction === 'model-to-code'
			&& isRecord(value.project) && Object.keys(value.project).length === 2 && typeof value.project.id === 'string' && typeof value.project.name === 'string'
			&& Array.isArray(value.changes) && value.changes.length && value.changes.every(isRecordChange)
			&& Array.isArray(value.affectedViews) && Array.isArray(value.referencedElements)
			&& isRecord(value.sourceHints) && Object.keys(value.sourceHints).length === 2 && Array.isArray(value.sourceHints.mappings) && Array.isArray(value.sourceHints.evidence)) { return value; }
	} catch { /* The error below does not echo project content. */ }
	throw new Error('Invalid code update context. Prepare the saved model changes again.');
}

function validateCodeUpdateResult(value: unknown): CodeUpdateResult {
	if (!isRecord(value) || Object.keys(value).length !== 2 || (value.outcome !== 'implemented' && value.outcome !== 'already-aligned' && value.outcome !== 'needs-input')
		|| typeof value.text !== 'string' || !value.text.trim() || value.text.length > 16_000) {
		throw new Error('The provider returned an invalid code update result. Review any local edits before retrying.');
	}
	return { outcome: value.outcome, text: value.text };
}

/** Each call is ephemeral; the modal supplies its in-memory transcript and Specsplice supplies project tools. */
export async function runDiagramChat(root: string, configValue: object, messages: { role: 'user' | 'assistant'; text: string }[], mcp?: { command: string; args: string[] }, signal?: AbortSignal, runner = runProcess, durationMs?: number, progress?: Progress, context?: object, checkpoint: boolean | DiagramCheckpoint['phase'] = false, reasoningEffort: DiagramCheckpointReasoningEffort = defaultDiagramCheckpointReasoningEffort): Promise<{ text: string }> {
	const config = readProviderConfig(configValue);
	if (!config.maxCalls) { throw new Error('AI requests are disabled. Enable requests in AI Settings.'); }
	if (!messages.length || messages.length > 60 || messages.some(message => !['user', 'assistant'].includes(message.role) || typeof message.text !== 'string')) { throw new Error('Invalid assistant conversation'); }
	if (checkpoint && (!mcp || messages.length !== 1 || messages[0].role !== 'user')) { throw new Error('A diagram checkpoint requires one task request and Specsplice tools.'); }
	const specialized = specializedDiagramCheckpointInstruction(typeof checkpoint === 'string' ? checkpoint : undefined);
	const prompt = specialized ? specialized + (context ? '\nOrdito checkpoint:\n' + JSON.stringify(context) : '')
		: (mcp ? diagramSessionInstruction : 'Help the user with this project and its Specsplice model. Read the current model before changing it. Preserve semantic IDs and valid model references. Only change files when the user asks for a change. For diagram-only requests, inspect relevant source and validate the Specsplice diagrams; do not run application test suites, linters or builds unless requested.') + (checkpoint ? '\n\n' + diagramCheckpointInstruction : '') + (context ? '\nSaved project state (resume this plan; repair its blockers):\n' + JSON.stringify(context) : '') + (checkpoint ? '\nTask request:\n' : '\nConversation:\n') + JSON.stringify(messages);
	if (Buffer.byteLength(prompt) > config.maxContextBytes) { throw new Error('This conversation exceeds the context budget. Close the assistant and open a new conversation; prepared diagrams are retained.'); }
	const text = await runCliTurn(root, config, prompt, { mcp, signal, runner, durationMs, progress, checkpoint: !!checkpoint, specialized: !!specialized, reasoningEffort });
	return { text: checkpoint ? text.slice(0, 4096) : text };
}

/** Run one saved-delta request with the existing CLI editing tools and return a bounded result. */
export async function runCodeUpdate(root: string, configValue: unknown, context: string, signal?: AbortSignal, progress?: Progress, runner = runProcess): Promise<CodeUpdateResult> {
	signal?.throwIfAborted();
	const config = readProviderConfig(configValue);
	if (!config.maxCalls) { throw new Error('AI requests are disabled. Enable requests in AI Settings.'); }
	const prompt = codeUpdateInstruction + '\n\nSaved model changes:\n' + JSON.stringify(parseCodeUpdateContext(context));
	if (Buffer.byteLength(prompt) + Buffer.byteLength(JSON.stringify(codeUpdateResultSchema)) > config.maxContextBytes) { throw new Error('The saved model changes exceed the code update context budget. Reduce the pending changes before retrying.'); }
	return validateCodeUpdateResult(await runCliTurn(root, config, prompt, { signal, runner, progress, codeUpdate: true }));
}

interface CliTurnOptions {
	mcp?: { command: string; args: string[] };
	signal?: AbortSignal;
	runner: typeof runProcess;
	durationMs?: number;
	progress?: Progress;
	checkpoint?: boolean;
	specialized?: boolean;
	reasoningEffort?: DiagramCheckpointReasoningEffort;
	codeUpdate?: boolean;
}

function runCliTurn(root: string, config: ProviderConfig, prompt: string, options: CliTurnOptions & { codeUpdate?: false }): Promise<string>;
function runCliTurn(root: string, config: ProviderConfig, prompt: string, options: CliTurnOptions & { codeUpdate: true }): Promise<unknown>;
async function runCliTurn(root: string, config: ProviderConfig, prompt: string, { mcp, signal, runner, durationMs, progress, checkpoint, specialized, reasoningEffort, codeUpdate }: CliTurnOptions): Promise<unknown> {
	const directory = await mkdtemp(join(tmpdir(), codeUpdate ? 'ordito-code-update-' : 'ordito-chat-'));
	try {
		progress?.({ kind: 'connecting' });
		let pending = '';
		const onOutput = (text: string, stream: 'stdout' | 'stderr') => {
			if (stream !== 'stdout' || !progress) { return; }
			pending += text;
			let end: number;
			while ((end = pending.indexOf('\n')) >= 0) {
				const line = pending.slice(0, end); pending = pending.slice(end + 1);
			let event: { type?: string; subtype?: string; item?: { id?: string; type?: string; text?: string; tool?: string; name?: string }; message?: { id?: string; content?: { type: string; name?: string; text?: string }[] } };
				try { event = JSON.parse(line); } catch { continue; }
				if (event?.type === 'error') { progress({ kind: 'waiting' }); }
				if (['thread.started', 'turn.started'].includes(event?.type ?? '')) { progress({ kind: 'thinking' }); }
			if (codeUpdate) {
				if (event?.type === 'system' && event.subtype === 'init') { progress({ kind: 'thinking' }); }
				const tool = event?.type === 'item.started' ? event.item?.type : undefined;
				if (tool === 'command_execution' || tool === 'file_change') { progress({ kind: 'tool', tool }); }
				for (const item of event?.type === 'assistant' ? event.message?.content ?? [] : []) {
					if (item.type !== 'tool_use') { continue; }
					if (item.name === 'Edit' || item.name === 'Write') { progress({ kind: 'tool', tool: 'file_change' }); }
					if (item.name === 'Bash') { progress({ kind: 'tool', tool: 'command_execution' }); }
					if (item.name === 'Read' || item.name === 'Glob' || item.name === 'Grep') { progress({ kind: 'tool', tool: 'source_inspection' }); }
				}
				continue;
			}
				if (event?.item?.type === 'mcp_tool_call') { progress({ kind: 'tool', tool: event.item.tool ?? event.item.name }); }
				if (event?.item?.type === 'agent_message' && typeof event.item.text === 'string') { progress({ kind: 'message', itemId: event.item.id ?? 'response', text: event.item.text.slice(0, checkpoint ? 4096 : 65536) }); }
				if (event?.type === 'assistant' && event.message?.content) {
					const content = event.message.content.filter(item => item.type === 'text').map(item => item.text ?? '').join('\n');
					if (content) { progress({ kind: 'message', itemId: event.message.id ?? 'response', text: content.slice(0, checkpoint ? 4096 : 65536) }); }
				}
			}
		};
		const env = { ...process.env };
		delete env.NODE_OPTIONS; delete env.VSCODE_INSPECTOR_OPTIONS; delete env.ELECTRON_RUN_AS_NODE;
		const output = join(directory, 'response.txt');
		const schemaPath = join(directory, 'response-schema.json');
		if (codeUpdate && config.provider === 'codex') { await writeFile(schemaPath, JSON.stringify(codeUpdateResultSchema), { mode: 0o600 }); }
		const effortOverride = checkpoint && reasoningEffort !== 'inherit' ? ['-c', `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`] : [];
		const args = config.provider === 'codex' ? ['exec', '--model', config.model, ...effortOverride, '--sandbox', mcp ? 'read-only' : 'workspace-write', '--skip-git-repo-check', '--ephemeral', ...[...(mcp ? ['shell_tool', 'unified_exec'] : []), 'apps', 'plugins', 'remote_plugin', 'multi_agent', 'hooks', 'skill_search', 'skill_mcp_dependency_install'].flatMap(feature => ['--disable', feature]), '-c', 'web_search="disabled"', '-c', 'approval_policy="never"', '-c', 'mcp_servers={}', ...(mcp ? ['-c', `mcp_servers.ordito.command=${JSON.stringify(mcp.command)}`, '-c', `mcp_servers.ordito.args=${JSON.stringify(mcp.args)}`, '-c', 'mcp_servers.ordito.required=true', '-c', 'mcp_servers.ordito.startup_timeout_sec=60'] : []), '--json', ...(codeUpdate ? ['--output-schema', schemaPath] : []), '--output-last-message', output, '-']
			: ['-p', '--model', config.model, '--permission-mode', 'dontAsk', '--tools', mcp ? '' : 'Read,Edit,Write,Bash,Glob,Grep', '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: mcp ? { ordito: { type: 'stdio', ...mcp } } : {} }), '--allowedTools', mcp ? 'mcp__ordito__*' : 'Read,Edit,Write,Bash,Glob,Grep', '--setting-sources', '', '--no-session-persistence', ...(codeUpdate ? ['--verbose', '--output-format', 'stream-json', '--json-schema', JSON.stringify(codeUpdateResultSchema)] : ['--output-format', 'json'])];
		// The configured provider timeout bounds silence, not the entire active turn.
		let result: Awaited<ReturnType<typeof runProcess>>;
		try {
			// The specialized roles get project data through MCP, without loading project-level agent instructions.
			result = await runner(config.executable, args, specialized ? directory : root, { input: prompt, signal, env, onOutput, startupTimeoutMs: 45000, idleTimeoutMs: config.timeoutMs, timeoutMs: Math.min(durationMs ?? 1800000, 5400000), maxBytes: 32 * 1024 * 1024, gracefulShutdownMs: 2000 });
		} catch (error) {
			if (codeUpdate && error instanceof ProcessTimeoutError) {
				if (error.reason === 'startup') { throw error; }
				throw new Error(error.reason === 'idle' ? 'The provider stopped responding during the code update. Review any local edits before retrying.' : 'The code update reached its time limit. Review any local edits before retrying.');
			}
			if (!checkpoint && error instanceof ProcessTimeoutError && error.reason === 'deadline') { throw new Error('The assistant reached the time limit for this request. Completed drafts are retained. Send a follow-up to continue.'); }
			throw error;
		}
		if (result.code !== 0) {
			const failure = result.stderr + '\n' + result.stdout;
			if (codeUpdate) {
				if (/unauthorized|unauthenticated|not logged in|authentication.*(required|failed)|\b401\b/i.test(failure)) { throw new Error('The provider did not authorize the code update. Refresh the CLI account in AI Settings and retry.'); }
				if (/rate.?limit|quota|\b429\b/i.test(failure)) { throw new Error('The provider reached its quota or rate limit. Check the account limits, then review any local edits before retrying the code update.'); }
				throw new Error(`The code update stopped (exit ${result.code}). Check the account and selected model in AI Settings, then review any local edits before retrying.`);
			}
			if (/unauthorized|unauthenticated|not logged in|authentication.*(required|failed)|\b401\b/i.test(failure)) { throw new Error('The provider did not authorize this request. Refresh the CLI account in AI Settings and resume from the saved checkpoint.'); }
			if (/mcp.{0,100}(fail|error|timed out)|(fail|error).{0,100}mcp|registerHooks|ERR_MODULE_NOT_FOUND/is.test(failure)) { throw new Error('The Specsplice project tools could not start. Rebuild Specsplice and start it with Node 24.22.1, then retry. Prepared drafts are retained.'); }
			if (/rate.?limit|quota|\b429\b/i.test(failure)) { throw new Error('The assistant reached the provider quota or rate limit. Check the account limits and retry later. Prepared drafts are retained.'); }
			throw new Error(`The assistant stopped (exit ${result.code}). Check the account and selected model in AI Settings. Prepared drafts are retained.`);
		}
		try {
			if (config.provider === 'codex') {
				const events: { type?: string }[] = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
				if (events.some(event => event.type === 'turn.failed') || !events.some(event => event.type === 'turn.completed')) { throw new Error('The assistant did not complete its response. Prepared drafts are retained.'); }
				const text = await readBoundedText(output, 2 * 1024 * 1024);
				return codeUpdate ? JSON.parse(text) : text;
			}
			if (codeUpdate) {
				const events: unknown[] = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
				const final = events.filter(event => isRecord(event) && event.type === 'result');
				if (final.length !== 1 || !isRecord(final[0]) || final[0].is_error === true || final[0].subtype !== 'success') { throw new Error(); }
				return final[0].structured_output;
			}
			const response: { result?: string; is_error?: boolean; subtype?: string } = JSON.parse(result.stdout);
			if (response.is_error || response.subtype !== 'success' || typeof response.result !== 'string') { throw new Error('The assistant did not complete its response. Prepared drafts are retained.'); }
			return response.result;
		} catch (error) {
			if (codeUpdate) { throw new Error('The provider did not return a complete code update result. Review any local edits before retrying.'); }
			throw error;
		}
	} finally { await rm(directory, { recursive: true, force: true }); }
}
