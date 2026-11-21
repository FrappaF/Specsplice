import '../../scripts/source-loader.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { engine: productionEngine, createCodeEngine, codeBridgeProtocol } = await import('../../runtime/nativeHost.ts');
const { orditoCodeProtocolVersion } = await import('../../../src/vs/workbench/contrib/ordito/common/codeBridge.ts');
const { importCode } = await import('../../code-import/importCode.ts');
const { createTypeScriptBundle } = await import('../../code-import/typescriptSemantic.ts');
const { applyScipBundles } = await import('../../code-import/scip.ts');
const { defaultScope } = await import('../../code-import/sourceScope.ts');
// Existing code-evidence scenarios now include an explicit structured AI proposal.
// The provider is simulated; tests still traverse the production validation/publication boundary.
const engine = createCodeEngine({ async complete(_config, prompt) {
	const context = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
	return { value: { summary: 'Reconcile observed code changes', questions: [], sourceEdits: [], bindings: [], modelEdits: [
		...context.changes.elements.map(item => ({ collection: 'elements', id: item.id, value: item.code ? { ...item.model, ...item.code } : null })),
		...context.changes.relations.map(item => ({ collection: 'relations', id: item.id, value: item.code ? { ...item.model, ...item.code } : null }))
	] }, usage: { inputTokens: 100, outputTokens: 50 }, cost: null };
} });
const config = { version: 1, provider: 'codex', connection: 'cli', model: 'test-model', executable: 'codex', maxCalls: 1, timeoutMs: 10000, maxContextBytes: 262144 };
const call = async request => {
	const result = JSON.parse(await engine.execute(JSON.stringify(request)));
	if (request.operation !== 'preview') { return result; }
	const prepared = JSON.parse(await engine.execute(JSON.stringify({ operation: 'reconciliationPrepare', token: result.token, config: JSON.stringify(config), sourceFiles: [] })));
	return JSON.parse(await engine.execute(JSON.stringify({ operation: 'reconciliationPropose', token: result.token, reviewId: prepared.reviewId })));
};
async function workspace(t, files) {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'ordito-native-code-')));
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const [file, text] of Object.entries(files)) { await mkdir(join(root, file, '..'), { recursive: true }); await writeFile(join(root, file), text); }
	return root;
}
test('native boundary advertises the semantic diagram and code update protocol', () => {
	assert.deepEqual(codeBridgeProtocol, { version: orditoCodeProtocolVersion, operations: ['collaboration', 'diagramChat', 'exploration', 'codeUpdate', 'import', 'inspect', 'preview', 'history', 'undoSync', 'recoverSync', 'apply', 'reconciliationPrepare', 'reconciliationPropose', 'diagramPrepare', 'diagramStep', 'diagramApprovePlan', 'restore', 'source'] });
});
test('code update dispatches only the saved delta in one writable provider turn', { skip: process.platform === 'win32' }, async t => {
	const root = await workspace(t, { 'orders.mjs': 'export const currency = "EUR";\n' });
	const context = {
		version: 2, direction: 'model-to-code', project: { id: 'mercato', name: 'Mercato' },
		changes: [{ collection: 'elements', id: 'order', before: { name: 'Order' }, after: { name: 'Order', currency: 'EUR' } }],
		affectedViews: [], referencedElements: [], sourceHints: { mappings: [], evidence: [] }
	};
	const executable = join(root, 'fixture-cli');
	await writeFile(executable, `#!${process.execPath}
const assert = require('node:assert/strict');
const fs = require('node:fs');
const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
const prompt = fs.readFileSync(0, 'utf8');
assert.equal(process.cwd(), ${JSON.stringify(root)});
assert.match(prompt, /^Implement only the saved Specsplice model changes/);
assert.doesNotMatch(prompt, /Conversation:|model[.]ordito[.]json|Read the current model before changing it/);
assert.deepEqual(JSON.parse(prompt.split('Saved model changes:\\n')[1]), ${JSON.stringify(context)});
const result = { outcome: 'already-aligned', text: 'The source already uses EUR.' };
if (args[0] === 'exec') {
	assert.ok(args.includes('--ephemeral') && args.includes('mcp_servers={}') && !args.some(arg => arg.startsWith('mcp_servers.ordito.')));
	assert.equal(value('--sandbox'), 'workspace-write');
	assert.deepEqual(JSON.parse(fs.readFileSync(value('--output-schema'), 'utf8')).required, ['outcome', 'text']);
	console.log(JSON.stringify({ type: 'turn.started' }));
	console.log(JSON.stringify({ type: 'item.started', item: { type: 'command_execution' } }));
	fs.writeFileSync(value('--output-last-message'), JSON.stringify(result));
	console.log(JSON.stringify({ type: 'turn.completed' }));
} else {
	assert.ok(args.includes('--no-session-persistence') && args.includes('--strict-mcp-config'));
	assert.equal(value('--output-format'), 'stream-json');
	assert.deepEqual(JSON.parse(value('--mcp-config')), { mcpServers: {} });
	assert.deepEqual(JSON.parse(value('--json-schema')).required, ['outcome', 'text']);
	console.log(JSON.stringify({ type: 'system', subtype: 'init' }));
	console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }));
	console.log(JSON.stringify({ type: 'result', subtype: 'success', structured_output: value('--model') === 'invalid-result' ? { text: 'Missing outcome' } : result }));
}
`, { mode: 0o700 });
	const request = { operation: 'codeUpdate', requestId: 'mercato-delta', root, config: '', context: JSON.stringify(context) };
	for (const provider of ['codex', 'claude']) {
		request.config = JSON.stringify({ ...config, provider, executable });
		const events = [];
		assert.deepEqual(JSON.parse(await engine.execute(JSON.stringify(request), undefined, event => events.push(event))), { outcome: 'already-aligned', text: 'The source already uses EUR.' });
		assert.deepEqual(events, [
			{ requestId: 'mercato-delta', kind: 'connecting' },
			{ requestId: 'mercato-delta', kind: 'thinking' },
			{ requestId: 'mercato-delta', kind: 'tool', tool: 'command_execution' }
		]);
	}
	assert.equal(await readFile(join(root, 'orders.mjs'), 'utf8'), 'export const currency = "EUR";\n');
	assert.deepEqual((await readdir(root)).sort(), ['fixture-cli', 'orders.mjs']);
	await assert.rejects(call({ ...request, messages: [{ role: 'user', text: 'Do more' }] }), /codeUpdate.*additional properties/);
	await assert.rejects(call({ ...request, context: JSON.stringify({ ...context, model: {} }) }), /Invalid code update context/);
	await assert.rejects(call({ ...request, context: JSON.stringify({ ...context, changes: [] }) }), /Invalid code update context/);
	await assert.rejects(call({ ...request, config: JSON.stringify({ ...config, executable, maxCalls: 0 }) }), /AI requests are disabled/);
	await assert.rejects(call({ ...request, config: JSON.stringify({ ...config, executable, maxContextBytes: 1024 }) }), /code update context budget/);
	await assert.rejects(call({ ...request, config: JSON.stringify({ ...config, provider: 'claude', executable, model: 'invalid-result' }) }), /invalid code update result/);
});
test('the modal request runs the CLI headlessly with the verified project MCP binding', async t => {
	const root = await workspace(t, { 'app.py': 'def start():\n    return 1\n' });
	const context = await call({ operation: 'import', root, syntaxOnly: true });
	const opened = await call({ operation: 'exploration', snapshot: context.snapshot, request: JSON.stringify({ action: 'open', workflow: 'project' }) });
	const executable = join(root, '.ordito', 'fixture codex');
	await writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const config = args.filter((arg, index) => args[index - 1] === '-c');
const command = config.find(arg => arg.startsWith('mcp_servers.ordito.command='));
const mcpArgs = JSON.parse(config.find(arg => arg.startsWith('mcp_servers.ordito.args=')).slice('mcp_servers.ordito.args='.length));
fs.accessSync(mcpArgs[0]);
fs.writeFileSync(${JSON.stringify(join(root, '.ordito', 'chat-receipt.json'))}, JSON.stringify({ command, mcpArgs, cwd: process.cwd(), ephemeral: args.includes('--ephemeral') }));
fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], 'Prepared project diagrams');
console.log(JSON.stringify({ type: 'turn.completed' }));
`, { mode: 0o700 });
	const request = { operation: 'diagramChat', requestId: 'chat-fixture', root, snapshot: context.snapshot, sessionId: opened.sessionId, config: JSON.stringify({ ...config, executable }), messages: [{ role: 'user', text: 'Generate all project diagrams' }] };
	const updates = [];
	assert.deepEqual(JSON.parse(await engine.execute(JSON.stringify(request), undefined, event => updates.push(event))), { text: 'Prepared project diagrams' });
	assert.deepEqual(updates.map(event => [event.requestId, event.kind]), [['chat-fixture', 'connecting']]);
	const receipt = JSON.parse(await readFile(join(root, '.ordito', 'chat-receipt.json'), 'utf8'));
	assert.deepEqual([receipt.mcpArgs.slice(1), receipt.cwd, receipt.ephemeral], [[root, opened.sessionId], root, true]);
	assert.match(receipt.command, /^mcp_servers\.ordito\.command=/);
	const feature = await call({ operation: 'exploration', snapshot: context.snapshot, request: JSON.stringify({ action: 'open', workflow: 'project', featureWorkflow: true }) });
	await call({ ...request, checkpoint: true, sessionId: feature.sessionId });
	const scoped = JSON.parse(await readFile(join(root, '.ordito', 'chat-receipt.json'), 'utf8'));
	assert.deepEqual([scoped.mcpArgs[2], JSON.parse(scoped.mcpArgs[3])], [feature.sessionId, { checkpoint: { phase: 'discovery', toolCalls: 0, readBytes: 0 }, turnId: 'chat-fixture' }]);
	await assert.rejects(call({ ...request, root: await workspace(t, {}) }), /project changed/);
	const missingSession = { ...request }; delete missingSession.sessionId;
	await assert.rejects(call(missingSession), /diagramChat.*sessionId/);
});
test('independent engines cannot consume each other\'s reconciliation previews', async t => {
	const root = await workspace(t, { 'task.py': 'def task():\n    return 1\n' });
	const owner = createCodeEngine(), other = createCodeEngine();
	const initial = JSON.parse(await owner.execute(JSON.stringify({ operation: 'import', root, syntaxOnly: true })));
	const preview = JSON.parse(await owner.execute(JSON.stringify({ operation: 'preview', snapshot: initial.snapshot })));
	const request = JSON.stringify({ operation: 'reconciliationPrepare', token: preview.token, config: JSON.stringify(config), sourceFiles: [] });
	await assert.rejects(other.execute(request), /preview expired/);
	const prepared = JSON.parse(await owner.execute(request));
	assert.ok(prepared.reviewId);
});
test('native boundary identifies malformed AI requests without disclosing configuration values', async () => {
	for (const [request, expected] of [
		[{ operation: 'diagramPrepare', config: 'private-config' }, /\(diagramPrepare\).*required property 'snapshot'/],
		[{ operation: 'diagramStep', snapshot: '/unused', id: 'job' }, /\(diagramStep\).*required property 'reviewId'/],
		[{ operation: 'diagramStep', snapshot: '/unused', id: '', reviewId: 'review' }, /\(diagramStep\).*request\/id.*fewer than 1 characters/],
		[{ operation: 'reconciliationPrepare', token: 'token', config: 'private-config', sourceFiles: [], extra: 'private-extra' }, /\(reconciliationPrepare\).*additional properties/],
		[{ operation: 'unknown-private-operation', config: 'private-config' }, /missing or unsupported operation/]
	]) {
		await assert.rejects(productionEngine.execute(JSON.stringify(request)), error => {
			assert.match(error.message, expected);
			assert.doesNotMatch(error.message, /private-/);
			return true;
		});
	}
});
test('reconciliation accepts more than 20 source files while enforcing the context budget', async t => {
	const files = Object.fromEntries(Array.from({ length: 26 }, (_, index) => [`task${index}.py`, `def task${index}():\n    return ${index}\n`]));
	const root = await workspace(t, files);
	const initial = await call({ operation: 'import', root, syntaxOnly: true });
	await writeFile(join(root, 'task0.py'), 'def task0():\n    return 99\n');
	const preview = JSON.parse(await productionEngine.execute(JSON.stringify({ operation: 'preview', snapshot: initial.snapshot })));
	const request = { operation: 'reconciliationPrepare', token: preview.token, config: JSON.stringify(config), sourceFiles: Object.keys(files) };
	const prepared = JSON.parse(await productionEngine.execute(JSON.stringify(request)));
	const context = JSON.parse(JSON.parse(prepared.contents).prompt.split('\n').slice(1).join('\n'));
	assert.deepEqual(context.sources.map(source => source.file).sort(), Object.keys(files).sort());
	await assert.rejects(productionEngine.execute(JSON.stringify({ ...request, config: JSON.stringify({ ...config, maxContextBytes: 1024 }) })), /exceeds the saved byte budget/);
	await assert.rejects(productionEngine.execute(JSON.stringify({ ...request, sourceFiles: [...request.sourceFiles, request.sourceFiles[0]] })), /duplicate/);
});
test('native boundary imports, previews contract/rename/delete, preserves annotation, publishes and recovers', async t => {
	const root = await workspace(t, { 'gateway.ts': 'export function charge(amount: number): boolean { return amount > 0; }', 'checkout.ts': 'import {charge as pay} from "./gateway"; export function checkout(value: number): boolean { return pay(value); }', 'unused.ts': 'export function unused() {}', 'steady.py': 'def steady():\n    return 1\n' });
	const initial = await call({ operation: 'import', root });
	assert.ok(initial.dependencies.length >= 1);
	const old = initial.declarations.find(item => item.name === 'checkout');
	const model = JSON.parse(await readFile(initial.model, 'utf8'));
	model.semantics.elements.find(item => item.id === old.id).description = 'Manual note';
	await writeFile(initial.model, JSON.stringify(model));
	await writeFile(join(root, 'checkout.ts'), 'import {charge as pay} from "./gateway"; export function purchase(value: number, tag: string): boolean { return pay(value); }');
	await rm(join(root, 'unused.ts'));
	let preview = await call({ operation: 'preview', snapshot: initial.snapshot });
	const renamed = preview.context.declarations.find(item => item.name === 'purchase');
	preview = await call({ operation: 'preview', snapshot: initial.snapshot, renames: [{ fromId: old.id, toSourceId: renamed.sourceId }] });
	assert.deepEqual(preview.conflicts, []);
	assert.deepEqual(preview.parsed, ['checkout.ts']);
	assert.ok(preview.reused.includes('gateway.ts') && preview.reused.includes('steady.py'));
	assert.ok(preview.context.declarations.some(item => item.id === old.id && item.name === 'purchase'));
	assert.ok(preview.files.removed.includes('unused.ts'));
	const updated = await call({ operation: 'apply', token: preview.token });
	assert.notEqual(updated.snapshot, initial.snapshot);
	const current = JSON.parse(await readFile(updated.model, 'utf8'));
	assert.equal(current.semantics.elements.find(item => item.id === old.id).description, 'Manual note');
	const mapping = updated.declarations.find(item => item.id === old.id).evidence;
	const source = await call({ operation: 'source', snapshot: updated.snapshot, file: mapping.file, revision: mapping.revision, start: mapping.start, end: mapping.end });
	assert.equal(source.stale, false);
	assert.ok(source.startColumn > 1);
	await writeFile(join(root, 'checkout.ts'), '\n' + await readFile(join(root, 'checkout.ts'), 'utf8'));
	assert.equal((await call({ operation: 'source', snapshot: updated.snapshot, file: mapping.file, revision: mapping.revision, start: mapping.start, end: mapping.end })).stale, true);
	assert.equal((await call({ operation: 'history', snapshot: updated.snapshot })).snapshots.length, 2);
	await call({ operation: 'restore', snapshot: updated.snapshot, target: initial.snapshot });
	assert.equal(JSON.parse(await readFile(join(root, '.ordito/code-project.json'), 'utf8')).active, initial.snapshot.split('/').pop());
	assert.ok((await readFile(join(root, 'checkout.ts'), 'utf8')).startsWith('\n'));
});
test('built-in compiler resolves aliases and reuses unaffected references, including shifted target positions', async t => {
	const root = await workspace(t, { 'a.ts': 'export function target(): number { return 1; }', 'b.ts': 'import {target as alias} from "./a"; export function caller(): number { return alias(); }', 'c.ts': 'export function isolated(): string { return "ok"; }' });
	let state = await importCode(root, 'compiler');
	let result = await createTypeScriptBundle(state);
	assert.deepEqual(result.diagnostics, []);
	state = await applyScipBundles(state, [result.bundle]);
	assert.equal(state.semantic.dependencies.filter(edge => state.files.flatMap(file => file.declarations).find(item => item.id === edge.from)?.name === 'caller').length, 1);
	result = await createTypeScriptBundle(state);
	assert.deepEqual(result.analyzed, []); assert.equal(result.reused.length, 3);
	await writeFile(join(root, 'a.ts'), '\n\nexport function target(): number { return 2; }');
	let next = await importCode(root, 'compiler', { previous: state });
	result = await createTypeScriptBundle(next);
	assert.ok(result.reused.includes('c.ts'));
	next = await applyScipBundles(next, [result.bundle]);
	assert.ok(next.semantic.dependencies.some(edge => edge.references.some(ref => ref.target.file === 'a.ts' && ref.target.line === 3)));
	await writeFile(join(root, 'a.ts'), 'export function target(): string { return "changed"; }');
	next = await importCode(root, 'compiler', { previous: next });
	result = await createTypeScriptBundle(next);
	assert.ok(result.analyzed.includes('b.ts'));
	assert.ok(result.diagnostics.some(item => item.file === 'b.ts' && item.severity === 'error'));
	assert.ok((await createTypeScriptBundle(next)).diagnostics.some(item => item.file === 'b.ts'));
});

test('refreshing a legacy compiler index preserves its provider and SCIP symbol identities', async t => {
	const root = await workspace(t, { 'a.ts': 'export function target(): number { return 1; }' });
	const state = await importCode(root, 'legacy-compiler');
	const canonical = await createTypeScriptBundle(state);
	const legacyBundle = structuredClone(canonical.bundle);
	legacyBundle.index.metadata.tool_info.name = 'ade-typescript-compiler';
	for (const document of legacyBundle.index.documents) {
		for (const occurrence of document.occurrences) {
			occurrence.symbol = occurrence.symbol.replace(/^ordito-typescript /, 'ade-typescript ');
		}
	}
	const previous = await applyScipBundles(state, [legacyBundle], undefined, true);
	await writeFile(join(root, 'a.ts'), 'export function target(): number { return 2; }');
	const next = await importCode(root, 'legacy-compiler', { previous });
	const updated = await createTypeScriptBundle(next, undefined, previous);
	assert.equal(updated.bundle.index.metadata.tool_info.name, 'ade-typescript-compiler');
	const symbols = bundle => bundle.index.documents.flatMap(document => document.occurrences.map(occurrence => occurrence.symbol));
	assert.deepEqual(symbols(updated.bundle), symbols(legacyBundle));
});

test('scope uses nested Git ignore rules, explicit globs, dialect overrides and ignores managed metadata', async t => {
	const root = await workspace(t, { '.gitignore': 'ignored/\n*.tmp\n', '.orditoignore': 'manual.ts\n', 'src/.gitignore': 'skip.ts\n!keep.ts\n', 'src/keep.ts': 'export function keep() {}', 'src/skip.ts': 'export function skip() {}', 'ignored/hidden.ts': 'export function hidden() {}', 'manual.ts': 'export function manual() {}', 'lib/header.h': 'class Header {};', 'src/no.py': 'def nope(): pass\n' });
	const scope = { ...structuredClone(defaultScope), include: ['src/**/*.ts', 'lib/**'], languageOverrides: { '.h': 'cpp' } };
	const state = await importCode(root, 'scope', { scope });
	assert.deepEqual(state.analysis.parsed, ['lib/header.h', 'src/keep.ts']);
	assert.equal(state.files.find(file => file.file === 'lib/header.h').language, 'cpp');
	await mkdir(join(root, '.ordito')); await writeFile(join(root, '.ordito/noise'), 'ignored');
	const next = await importCode(root, 'scope', { previous: state });
	assert.equal(next.revision, state.revision);
	assert.deepEqual(next.analysis.parsed, []);
});
test('native publication rejects stale source, bad requests and redirected owned directories', async t => {
	const root = await workspace(t, { 'a.py': 'def a(): pass\n' });
	const initial = await call({ operation: 'import', root });
	const preview = await call({ operation: 'preview', snapshot: initial.snapshot });
	await writeFile(join(root, 'a.py'), 'def a(x): pass\n');
	await assert.rejects(call({ operation: 'apply', token: preview.token }), /Source changed/);
	await assert.rejects(call({ operation: 'source', snapshot: initial.snapshot, file: '../secret', revision: 'x', start: 0, end: 1 }), /Invalid/);
	await assert.rejects(productionEngine.execute('{"operation":"shell","command":"echo"}'), /Invalid/);
	const second = await workspace(t, { 'a.py': 'def a(): pass\n' });
	await symlink(join(root, '.ordito'), join(second, '.ordito'));
	await assert.rejects(call({ operation: 'import', root: second }), /symlink/);
});

test('native compiler can import statements without definitions and Sync a complete deletion', async t => {
	const root = await workspace(t, { 'a.ts': 'console.log("no declaration");' });
	const initial = await call({ operation: 'import', root });
	assert.equal(initial.declarations.length, 0);
	assert.equal(initial.dependencies.length, 0);
	await writeFile(join(root, 'a.ts'), 'export function added() { return 1; }');
	let preview = await call({ operation: 'preview', snapshot: initial.snapshot });
	let current = await call({ operation: 'apply', token: preview.token });
	assert.equal(current.declarations.length, 1);
	await rm(join(root, 'a.ts'));
	preview = await call({ operation: 'preview', snapshot: current.snapshot });
	assert.deepEqual(preview.conflicts, []);
	current = await call({ operation: 'apply', token: preview.token });
	assert.equal(current.declarations.length, 0);
	assert.equal(current.dependencies.length, 0);
});
test('syntax-only mode persists and concurrent imports cannot publish over each other', async t => {
	const root = await workspace(t, { 'a.ts': 'export function first() { return 1; }' });
	const results = await Promise.allSettled([call({ operation: 'import', root, syntaxOnly: true }), call({ operation: 'import', root, syntaxOnly: true })]);
	assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
	const initial = results.find(result => result.status === 'fulfilled').value;
	assert.deepEqual(initial.providers, []);
	await writeFile(join(root, 'a.ts'), 'export function first() { return 2; }');
	const preview = await call({ operation: 'preview', snapshot: initial.snapshot });
	assert.deepEqual(preview.context.providers, []);
	const current = await call({ operation: 'apply', token: preview.token });
	await assert.rejects(call({ operation: 'preview', snapshot: initial.snapshot }), /active snapshot/);
	await call({ operation: 'restore', snapshot: current.snapshot, target: initial.snapshot });
});
