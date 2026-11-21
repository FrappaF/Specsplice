import '../../scripts/source-loader.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
const { createCodeEngine } = await import('../../runtime/nativeHost.ts');
const { runDiagramChat } = await import('../diagramChat.ts');
const { runProcess } = await import('../process.ts');

/** Real CLI and real MCP transport; the model endpoint is a local deterministic SSE fixture. */
test('installed Codex calls the Specsplice server and streams its response before exiting', { skip: !process.env.ORDITO_CODEX_TEST_EXECUTABLE }, async t => {
	const directory = await mkdtemp(join(tmpdir(), 'ordito-codex-transport-'));
	const root = join(directory, 'project'), codexHome = join(directory, 'provider');
	await mkdir(root); await mkdir(codexHome); await writeFile(join(root, 'todo.py'), 'def list_todos():\n    return []\n');
	let requests = 0, toolAdvertised = false, finished = false, streamedBeforeExit = false, authenticationUsed = false;
	const server = createServer(async (request, response) => {
		let body = ''; for await (const chunk of request) { body += chunk; }
		if (request.method !== 'POST') { response.writeHead(404); response.end(); return; }
		authenticationUsed ||= !!request.headers.authorization;
		const data: { tools?: { name?: string; tools?: { name: string }[] }[] } = JSON.parse(body);
		const namespace = data.tools?.find(tool => tool.name === 'mcp__ordito');
		const tool = namespace?.tools?.find(tool => tool.name === 'ordito_project_inspect')?.name ?? data.tools?.find(tool => tool.name?.includes('ordito_project_inspect'))?.name;
		toolAdvertised ||= !!tool; requests++;
		const item = requests === 1 && tool ? { id: 'fc_1', type: 'function_call', call_id: 'call_fixture', name: tool, ...(namespace ? { namespace: 'mcp__ordito' } : {}), arguments: '{}' } : { id: 'msg_1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Local fixture response complete.' }] };
		response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
		const event = (type: string, fields: object) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
		event('response.created', { response: { id: 'resp_' + requests, object: 'response', status: 'in_progress', model: 'ordito-fixture', output: [] } });
		event('response.output_item.added', { output_index: 0, item }); event('response.output_item.done', { output_index: 0, item });
		event('response.completed', { response: { id: 'resp_' + requests, object: 'response', status: 'completed', model: 'ordito-fixture', output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } }); response.end();
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
	await writeFile(join(codexHome, 'config.toml'), `cli_auth_credentials_store = "file"\nmodel_provider = "ordito_fixture"\nmodel = "ordito-fixture"\n[model_providers.ordito_fixture]\nname = "Specsplice Local Fixture"\nbase_url = "http://127.0.0.1:${(server.address() as AddressInfo).port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
	const engine = createCodeEngine();
	const call = async (request: object) => JSON.parse(await engine.execute(JSON.stringify(request)));
	const context = await call({ operation: 'import', root, syntaxOnly: true });
	const opened = await call({ operation: 'exploration', snapshot: context.snapshot, request: JSON.stringify({ action: 'open', workflow: 'project' }) });
	const config = { version: 1, provider: 'codex', connection: 'cli', executable: process.env.ORDITO_CODEX_TEST_EXECUTABLE!, model: 'ordito-fixture', timeoutMs: 30000, maxContextBytes: 262144, maxCalls: 1 };
	const result = await runDiagramChat(root, config, [{ role: 'user', text: 'Inspect the project once using Specsplice, then report success.' }], opened.data.mcp, undefined, (executable, args, cwd, options) => {
		const env: NodeJS.ProcessEnv = { ...options?.env, CODEX_HOME: codexHome };
		for (const name of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL']) { delete env[name]; }
		return runProcess(executable, args, cwd, { ...options, env });
	}, undefined, event => { if (event.kind === 'message') { streamedBeforeExit = !finished; } });
	finished = true;
	const status = await call({ operation: 'exploration', snapshot: context.snapshot, request: JSON.stringify({ action: 'status', sessionId: opened.sessionId }) });
	assert.deepEqual([toolAdvertised, requests, status.data.usage.toolCalls, streamedBeforeExit, authenticationUsed, result.text], [true, 2, 1, true, false, 'Local fixture response complete.']);
});
