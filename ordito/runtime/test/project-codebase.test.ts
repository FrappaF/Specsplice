import '../../scripts/source-loader.mjs';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, realpath, symlink, access } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { type CodeContext, type CodeRequest } from '../../../src/vs/workbench/contrib/ordito/common/codeBridge.ts';
import { type SemanticModel } from '../../../src/vs/workbench/contrib/ordito/common/modelTypes.ts';

const { createCodeEngine } = await import('../nativeHost.ts');
const { readSnapshot } = await import('../../code-import/snapshot.ts');
const { checkoutModel } = await import('../../../src/vs/workbench/contrib/ordito/common/checkoutModel.ts');
const { emptyFoundation } = await import('../../../src/vs/workbench/contrib/ordito/common/modelFoundation.ts');

async function fixture(t: TestContext, model: SemanticModel = checkoutModel) {
	const root = await realpath(await mkdtemp(join(tmpdir(), 'ordito-project-codebase-')));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, '.ordito'));
	await writeFile(join(root, 'app.rb'), 'class OrdersController\n  def index\n    Order.all\n  end\nend\n');
	const original = JSON.stringify(model, null, '\t') + '\n';
	await writeFile(join(root, '.ordito', 'model.json'), original);
	const engine = createCodeEngine();
	const call = async (request: CodeRequest) => JSON.parse(await engine.execute(JSON.stringify(request))) as CodeContext;
	return { root, original, call };
}

test('linking the open project inventories its code and preserves its complete editable model', async t => {
	const f = await fixture(t);
	const context = await f.call({ operation: 'import', root: f.root, modelFile: '.ordito/model.json', syntaxOnly: true });
	const snapshot = await readSnapshot(context.snapshot);
	assert.equal(context.files.find(file => file.path === 'app.rb')?.revision, snapshot.state.files.find(file => file.file === 'app.rb')?.revision);
	assert.deepEqual({ root: context.sourceRoot, projectId: snapshot.state.projectId, model: snapshot.model, commonModel: snapshot.commonModel, source: context.files.some(file => file.path === 'app.rb'), original: await readFile(join(f.root, '.ordito', 'model.json'), 'utf8') }, { root: f.root, projectId: checkoutModel.id, model: checkoutModel, commonModel: checkoutModel, source: true, original: f.original });
	const opened = JSON.parse(await createCodeEngine().execute(JSON.stringify({ operation: 'exploration', snapshot: context.snapshot, request: JSON.stringify({ action: 'open', workflow: 'project' }) })));
	assert.ok(opened.sessionId && opened.data.mcp, 'the linked project exposes the Specsplice diagram tools');
	const pointer = await readFile(join(f.root, '.ordito', 'code-project.json'), 'utf8');
	await assert.rejects(f.call({ operation: 'import', root: f.root, modelFile: '.ordito/model.json', syntaxOnly: true }), /already has an import/);
	assert.equal(await readFile(join(f.root, '.ordito', 'code-project.json'), 'utf8'), pointer);
});

test('linking rejects models outside the project and redirected model files', async t => {
	const f = await fixture(t), other = await fixture(t);
	for (const modelFile of ['../model.json', '/model.json', '.ordito/imports/model.json', 'nested/../model.json']) {
		await assert.rejects(f.call({ operation: 'import', root: f.root, modelFile }), /Invalid project model path/);
	}
	await rm(join(f.root, '.ordito', 'model.json'));
	await symlink(join(other.root, '.ordito', 'model.json'), join(f.root, '.ordito', 'model.json'));
	await assert.rejects(f.call({ operation: 'import', root: f.root, modelFile: '.ordito/model.json' }), /redirected/);
	await assert.rejects(access(join(f.root, '.ordito', 'code-project.json')), /ENOENT/);
	assert.equal(await readFile(join(other.root, '.ordito', 'model.json'), 'utf8'), other.original);
});

test('legacy project folders and snapshot filenames remain usable without splitting the store', async t => {
	const f = await fixture(t);
	await rename(join(f.root, '.ordito'), join(f.root, '.ade'));
	await writeFile(join(f.root, '.adeignore'), 'omitted.rb\n');
	await writeFile(join(f.root, 'omitted.rb'), 'def omitted; end\n');
	const initial = await f.call({ operation: 'import', root: f.root, modelFile: '.ade/model.json', syntaxOnly: true });
	assert.equal(basename(dirname(dirname(initial.snapshot))), '.ade');
	assert.equal(initial.files.find(file => file.path === 'omitted.rb')?.status, 'excluded');
	const original = await readSnapshot(initial.snapshot);
	const legacyModel = join(initial.snapshot, 'model.ade.json');
	await rename(initial.model, legacyModel);
	const reopened = await f.call({ operation: 'inspect', snapshot: initial.snapshot });
	assert.equal(reopened.model, legacyModel);
	assert.equal((await readSnapshot(initial.snapshot)).inputHash, original.inputHash);
	await assert.rejects(access(join(f.root, '.ordito')), /ENOENT/);
});

test('a newly created Specsplice project keeps its identity and foundation when its first source inventory is attached', async t => {
	const model: SemanticModel = { version: 4, id: 'rails-project', name: 'Rails Shop', foundation: emptyFoundation(), semantics: { elements: [], relations: [] }, views: [], codeMappings: [], verifications: [] };
	const f = await fixture(t, model);
	const context = await f.call({ operation: 'import', root: f.root, modelFile: '.ordito/model.json' });
	assert.deepEqual((await readSnapshot(context.snapshot)).model, model);
});


test('source inventory scope is previewed locally and preserves the authored model and source files', async t => {
	const f = await fixture(t, { version: 4, id: 'scoped-project', name: 'Scoped Project', foundation: emptyFoundation(), semantics: { elements: [], relations: [] }, views: [], codeMappings: [], verifications: [] });
	await writeFile(join(f.root, 'other.py'), 'def outside_scope():\n    return 1\n');
	const engine = createCodeEngine();
	const call = async (request: CodeRequest) => JSON.parse(await engine.execute(JSON.stringify(request)));
	const initial: CodeContext = await call({ operation: 'import', root: f.root, modelFile: '.ordito/model.json', syntaxOnly: true });
	const pointer = await readFile(join(f.root, '.ordito/code-project.json'), 'utf8');
	const preview = await call({ operation: 'preview', snapshot: initial.snapshot, inventoryOnly: true, scope: { ...initial.scope, include: ['*.rb'] } });
	assert.equal(preview.context.files.find((file: { path: string }) => file.path === 'other.py').status, 'excluded');
	assert.equal(preview.context.declarations.some((item: { name: string }) => item.name === 'outside_scope'), false);
	assert.equal(await readFile(join(f.root, '.ordito/code-project.json'), 'utf8'), pointer, 'a preview never changes the active snapshot');
	const applied: CodeContext = await call({ operation: 'apply', token: preview.token });
	assert.notEqual(applied.snapshot, initial.snapshot);
	const history = await call({ operation: 'history', snapshot: applied.snapshot });
	assert.equal(history.snapshots[0].directory, applied.snapshot);
	assert.ok(Number.isFinite(Date.parse(history.snapshots[0].created)));
	assert.equal(history.snapshots[0].files, applied.files.length);
	assert.equal(history.snapshots[0].declarations, applied.declarations.length);
	assert.deepEqual((await readSnapshot(applied.snapshot)).model, (await readSnapshot(initial.snapshot)).model);
	assert.deepEqual(applied.scope.include, ['*.rb']);
	assert.equal(await readFile(join(f.root, 'other.py'), 'utf8'), 'def outside_scope():\n    return 1\n');
	assert.equal(await readFile(join(f.root, '.ordito/model.json'), 'utf8'), f.original);
});

test('source inventory application rejects source or model edits after preview', async t => {
	const f = await fixture(t), engine = createCodeEngine();
	const call = async (request: CodeRequest) => JSON.parse(await engine.execute(JSON.stringify(request)));
	const initial: CodeContext = await call({ operation: 'import', root: f.root, syntaxOnly: true });
	const request: CodeRequest = { operation: 'preview', snapshot: initial.snapshot, inventoryOnly: true, scope: initial.scope };
	const preview = await call(request);
	await writeFile(join(f.root, 'app.rb'), 'class Changed; end\n');
	await assert.rejects(call({ operation: 'apply', token: preview.token }), /Source changed/);
	const next = await call(request);
	const model = JSON.parse(await readFile(initial.model, 'utf8')); model.name = 'Edited after preview';
	await writeFile(initial.model, JSON.stringify(model));
	await assert.rejects(call({ operation: 'apply', token: next.token }), /preview is stale/);
});
