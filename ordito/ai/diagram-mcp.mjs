import '../scripts/source-loader.mjs';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const { active } = await import('../runtime/projectStore.ts');
const { projectMetadataPath } = await import('../runtime/projectPaths.ts');
const { executeDiagramExploration } = await import('./diagramSession.ts');
const { checkpointToolAllowed, diagramCheckpointInstruction, specializedDiagramCheckpointInstruction } = await import('./diagramCheckpoint.ts');
const { diagramAuditToolDefinitions, diagramToolDefinitions, diagramSessionInstruction } = await import('../../src/vs/workbench/contrib/ordito/common/diagramTools.ts');

/** One stdio process is pinned to one project; no project switching, model token or global config. */
export async function createDiagramMcpServer(root, sessionId, options = {}) {
	root = await realpath(root);
	const pointer = await active(root);
	if (!pointer) { throw new Error('Import this project in Specsplice before starting its MCP server.'); }
	const snapshot = await projectMetadataPath(root, 'imports', pointer);
	const { checkpoint, turnId, ...openOptions } = options;
	const opened = await executeDiagramExploration(snapshot, { action: 'open', ...(sessionId ? { sessionId } : { workflow: 'project', featureWorkflow: true }), ...openOptions });
	sessionId = opened.sessionId;
	const instance = randomUUID();
	const instruction = specializedDiagramCheckpointInstruction(checkpoint?.phase) ?? (checkpoint ? `${diagramSessionInstruction}\n\n${diagramCheckpointInstruction}` : diagramSessionInstruction);
	const server = new Server({ name: 'ordito-diagrams', version: '2.0.0' }, { capabilities: { tools: {} }, instructions: instruction });
	const tools = checkpoint ? [...diagramToolDefinitions, ...diagramAuditToolDefinitions].filter(tool => checkpointToolAllowed(checkpoint, tool.name)) : diagramToolDefinitions;
	server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, idempotentHint: tool.readOnly, openWorldHint: false } })) }));
	server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
		const result = await executeDiagramExploration(snapshot, { action: 'tool', sessionId, tool: request.params.name, arguments: request.params.arguments ?? {}, callId: `${instance}:${extra.requestId}`, ...(checkpoint ? { checkpoint, turnId } : {}) }, extra.signal);
		return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result, isError: result.diagnostics.length > 0 };
	});
	return { server, sessionId };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
	const [root, sessionId, scope] = process.argv.slice(2);
	if (!root) { throw new Error('Usage: node ordito/ai/diagram-mcp.mjs PROJECT_ROOT [SESSION_ID]'); }
	const { server } = await createDiagramMcpServer(root, sessionId, scope ? JSON.parse(scope) : {});
	const shutdown = () => { void server.close(); };
	process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
	server.onclose = () => { process.removeListener('SIGTERM', shutdown); process.removeListener('SIGINT', shutdown); };
	await server.connect(new StdioServerTransport());
}
