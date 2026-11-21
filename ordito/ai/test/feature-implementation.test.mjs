import '../../scripts/source-loader.mjs';
import assert from 'node:assert/strict';
import fs, { mkdir, mkdtemp, cp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
const { executeCollaboration } = await import('../engine.ts');
const { advanceFeatureImplementation, prepareFeatureImplementation, readFeatureImplementation } = await import('../featureImplementation.ts');
const { runProcess } = await import('../process.ts');
const { createCodeEngine } = await import('../../runtime/nativeHost.ts');

const sample = new URL('../../examples/user-guide/07-marketplace-workshop/modules/ai-generation/', import.meta.url);
const configuration = { version: 1, provider: 'codex', connection: 'cli', executable: 'codex', model: 'fixture-only', maxCalls: 2, maxContextBytes: 65536, timeoutMs: 2000 };
const purchase = `export function run(input) {
	if (!input || typeof input.orderId !== 'string' || !input.orderId.length || !Number.isSafeInteger(input.unitPriceCents) || input.unitPriceCents < 0 || !Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 10 || typeof input.approved !== 'boolean') {
		return {status: 'invalid-input'};
	}
	const totalCents = input.unitPriceCents * input.quantity;
	if (!Number.isSafeInteger(totalCents)) { return {status: 'invalid-input'}; }
	if (!input.approved) { return {status: 'declined'}; }
	return {status: 'confirmed', order: {id: input.orderId, totalCents}};
}`;
const returns = `export function run(input) {
	if (!input || !Number.isSafeInteger(input.daysSincePurchase) || input.daysSincePurchase < 0) { return {status: 'invalid-input'}; }
	if (input.order === null) { return {status: 'unknown-order'}; }
	if (!input.order || typeof input.order.id !== 'string' || !input.order.id.length || !Number.isSafeInteger(input.order.totalCents) || input.order.totalCents < 0) { return {status: 'invalid-input'}; }
	if (input.daysSincePurchase > 30) { return {status: 'outside-window'}; }
	return {status: 'accepted', orderId: input.order.id, refundCents: input.order.totalCents};
}`;

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), 'ordito-feature-implementation-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	await cp(sample, root, { recursive: true });
	const execute = async (operation, params = {}) => JSON.parse(await executeCollaboration(JSON.stringify({ operation: 'featureImplementation' + operation, root, ...params })));
	const prepare = (params = {}) => execute('Prepare', { profileId: 'node.esm', featureIds: ['returns', 'checkout'], config: configuration, ...params });
	return { root, execute, prepare };
}

function packet(prompt) { return JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)); }
function proposal(data, source) { return { kind: 'proposal', source, implementedIds: data.requiredIds, questions: [], gaps: [] }; }
function fakeProvider(choose) {
	return { complete: async (_configuration, prompt, schema) => {
		const data = packet(prompt);
		assert.equal(schema.additionalProperties, false);
		return { value: choose(data), usage: { inputTokens: null, outputTokens: null }, cost: null };
	} };
}
const grounded = fakeProvider(data => proposal(data, data.featureId === 'checkout' ? purchase : returns));

test('code generation from the model stages and verifies two dependency-ordered features without Git', async t => {
	const f = await fixture(t);
	const setup = await f.execute('Inspect');
	assert.deepEqual([setup.mode, setup.defaultProfileId, setup.featureIds], ['create', 'node.esm', ['checkout', 'returns']]);
	const job = await f.prepare();
	const first = await advanceFeatureImplementation(f.root, job.id, undefined, undefined, fakeProvider(data => {
		assert.deepEqual([data.featureId, data.dependencies, data.model.views.map(view => view.id), data.model.elements.map(element => element.id)], ['checkout', [], ['checkout-structure'], ['checkout', 'checkout-service', 'order']]);
		assert.equal(JSON.stringify(data).includes('2500'), false);
		return proposal(data, purchase);
	}));
	assert.deepEqual([first.status, first.tasks.map(task => task.status)], ['prepared', ['ready', 'pending']]);
	assert.deepEqual((await f.execute('Session', { id: job.id })).tasks, first.tasks);
	const ready = await advanceFeatureImplementation(f.root, job.id, undefined, undefined, fakeProvider(data => {
		assert.equal(data.featureId, 'returns');
		assert.deepEqual(data.dependencies.map(entry => entry.id), ['checkout']);
		assert.match(data.dependencies[0].import, /^\.\/checkout-/);
		assert.equal(JSON.stringify(data).includes('2500'), false);
		return proposal(data, returns);
	}));
	assert.equal(ready.status, 'ready', JSON.stringify(ready.tasks));
	assert.deepEqual(ready.files.map(file => file.kind), Array(5).fill('create'));
	const sourceNames = ready.files.filter(file => file.file.startsWith('src/')).map(file => file.file.replace(/-[a-f0-9]{12}\.mjs$/, '.mjs'));
	assert.deepEqual(sourceNames, ['src/features/checkout.mjs', 'src/features/returns.mjs']);
	await assert.rejects(stat(join(f.root, '.git')), { code: 'ENOENT' });
	await assert.rejects(stat(join(f.root, 'src')), { code: 'ENOENT' });
	await assert.rejects(stat(join(f.root, 'package.json')), { code: 'ENOENT' });
	const diff = await f.execute('Diff', { id: ready.id, file: ready.files.find(file => file.featureId === 'checkout' && file.file.startsWith('src/')).file });
	assert.deepEqual(diff, { before: null, after: purchase + '\n' });
	await assert.rejects(f.execute('Apply', { id: ready.id, reviewId: ready.reviewId }), /verified/);
	const verified = await f.execute('Verify', { id: ready.id, reviewId: ready.reviewId });
	assert.deepEqual([verified.status, verified.verification.cases.length, verified.verification.cases.every(entry => entry.passed)], ['verified', 7, true]);
	const applied = await f.execute('Apply', { id: verified.id, reviewId: verified.reviewId });
	assert.equal(applied.status, 'applied');
	const terminal = await runProcess(process.execPath, ['--test'], f.root, { env: {}, timeoutMs: 10000 });
	assert.equal(terminal.code, 0, terminal.stdout + terminal.stderr);
	assert.match(terminal.stdout, /pass 7/);
	assert.equal((await f.execute('Undo', { id: applied.id, reviewId: applied.reviewId })).status, 'undone');
	await assert.rejects(stat(join(f.root, 'package.json')), { code: 'ENOENT' });
	assert.deepEqual(JSON.parse(await readFile(join(f.root, '.ordito', 'model.json'), 'utf8')).codeMappings, []);
});

test('independent verification blocks a wrong result and reopens only the failing feature and its dependants', async t => {
	const f = await fixture(t), job = await f.prepare();
	await advanceFeatureImplementation(f.root, job.id, undefined, undefined, fakeProvider(data => proposal(data, purchase.replace('unitPriceCents * input.quantity', 'unitPriceCents + input.quantity'))));
	const ready = await advanceFeatureImplementation(f.root, job.id, undefined, undefined, grounded);
	assert.equal(ready.status, 'ready', JSON.stringify(ready.tasks));
	const failed = await f.execute('Verify', { id: job.id, reviewId: ready.reviewId });
	assert.deepEqual([failed.status, failed.verification.cases.filter(entry => !entry.passed).map(entry => entry.featureId)], ['failed', ['checkout', 'checkout']]);
	await assert.rejects(f.execute('Apply', { id: job.id, reviewId: ready.reviewId }), /verified/);
	const repaired = await advanceFeatureImplementation(f.root, job.id, undefined, undefined, fakeProvider(data => {
		assert.equal(data.featureId, 'checkout');
		assert.match(data.previousProposal, /unitPriceCents \+ input.quantity/);
		assert.match(data.verificationFailures.join(' '), /confirmed-total/);
		assert.equal(JSON.stringify(data).includes('2500'), false);
		return proposal(data, purchase);
	}));
	assert.deepEqual([repaired.status, repaired.tasks.map(task => task.status)], ['prepared', ['ready', 'pending']]);
	const reviewed = await advanceFeatureImplementation(f.root, job.id, undefined, undefined, grounded);
	assert.notEqual(reviewed.reviewId, ready.reviewId);
	assert.equal((await f.execute('Verify', { id: job.id, reviewId: reviewed.reviewId })).status, 'verified');
});

test('questions, unsafe output, outside dependencies and stale inputs are bounded at the task boundary', async t => {
	const f = await fixture(t);
	await assert.rejects(f.prepare({ featureIds: ['returns'] }), /prerequisite feature Checkout/);
	await assert.rejects(f.prepare({ cases: [{ id: 'only-one', featureId: 'checkout', input: false, expected: false }] }), /independent case/);
	const job = await f.prepare({ featureIds: ['checkout'] });
	const waiting = await advanceFeatureImplementation(f.root, job.id, undefined, undefined, fakeProvider(() => ({ kind: 'needsClarification', source: '', implementedIds: [], questions: ['What is the scope?'], gaps: [] })));
	assert.deepEqual([waiting.status, waiting.questions, waiting.files], ['waitingUser', ['What is the scope?'], []]);
	assert.equal((await advanceFeatureImplementation(f.root, job.id, undefined, undefined, fakeProvider(() => assert.fail('Unanswered question spent a provider call')))).status, 'waitingUser');
	const unsafe = await advanceFeatureImplementation(f.root, job.id, 'On this scope.', undefined, fakeProvider(data => {
		assert.deepEqual(data.clarifications, ['On this scope.']);
		return proposal(data, 'export function run(input) { return process.env; }');
	}));
	assert.equal(unsafe.status, 'failed');
	assert.equal(unsafe.files.length, 0);
	await assert.rejects(advanceFeatureImplementation(f.root, job.id, undefined, undefined, grounded), /budget/);

	const fresh = await f.prepare({ featureIds: ['checkout'] });
	const modelPath = join(f.root, '.ordito', 'model.json');
	const model = JSON.parse(await readFile(modelPath, 'utf8'));
	model.semantics.elements[0].description += ' A changed business rule.';
	await writeFile(modelPath, JSON.stringify(model));
	await assert.rejects(advanceFeatureImplementation(f.root, fresh.id, undefined, undefined, fakeProvider(() => assert.fail('Stale model spent a provider call'))), /model or independent cases changed/);
	assert.equal((await readFeatureImplementation(f.root, fresh.id)).status, 'prepared');
});

test('updating an ESM feature preserves unrelated modules, tests and manual edits after review', async t => {
	const f = await fixture(t);
	const first = await prepareFeatureImplementation(f.root, { profileId: 'node.esm', featureIds: ['checkout', 'returns'], config: configuration });
	await advanceFeatureImplementation(f.root, first.id, undefined, undefined, grounded);
	const ready = await advanceFeatureImplementation(f.root, first.id, undefined, undefined, grounded);
	await f.execute('Verify', { id: first.id, reviewId: ready.reviewId });
	await f.execute('Apply', { id: first.id, reviewId: ready.reviewId });
	const unrelated = ready.files.filter(file => file.featureId === 'returns');
	const images = await Promise.all(unrelated.map(file => readFile(join(f.root, file.file), 'utf8')));
	const second = await f.prepare({ featureIds: ['checkout'] });
	assert.equal(second.mode, 'update');
	const changes = await advanceFeatureImplementation(f.root, second.id, undefined, undefined, fakeProvider(data => {
		assert.equal(data.currentSource.content, purchase + '\n');
		return proposal(data, '// Reviewed clarification.\n' + purchase);
	}));
	assert.deepEqual(changes.files.map(file => [file.featureId, file.kind]), [['checkout', 'update']]);
	const verified = await f.execute('Verify', { id: second.id, reviewId: changes.reviewId });
	assert.equal(verified.status, 'verified');
	const target = join(f.root, changes.files[0].file);
	await writeFile(target, '// Manual edit after review.\n' + purchase + '\n');
	await assert.rejects(f.execute('Apply', { id: second.id, reviewId: verified.reviewId }), /Source changed/);
	assert.match(await readFile(target, 'utf8'), /Manual edit/);
	await writeFile(target, purchase + '\n');
	await f.execute('Apply', { id: second.id, reviewId: verified.reviewId });
	assert.deepEqual(await Promise.all(unrelated.map(file => readFile(join(f.root, file.file), 'utf8'))), images);
});

test('the active imported snapshot can drive updates and hidden or stale models remain protected', async t => {
	const f = await fixture(t);
	await writeFile(join(f.root, 'package.json'), '{"type":"module"}');
	await mkdir(join(f.root, 'src'));
	const source = 'src/checkout.mjs';
	await writeFile(join(f.root, source), purchase);
	const document = join(f.root, '.ordito/model.json');
	const model = JSON.parse(await readFile(document, 'utf8'));
	model.codeMappings.push({ id: 'existing-checkout', elementId: 'checkout', file: source, symbol: 'run', revision: 'initial' });
	await writeFile(document, JSON.stringify(model));
	const context = JSON.parse(await createCodeEngine().execute(JSON.stringify({ operation: 'import', root: f.root, modelFile: '.ordito/model.json', syntaxOnly: true })));
	const modelFile = relative(f.root, context.model).replaceAll('\\', '/');
	const setup = await f.execute('Inspect', { modelFile });
	assert.deepEqual([setup.mode, setup.featureIds], ['update', ['checkout', 'returns']]);
	const job = await f.prepare({ modelFile, featureIds: ['checkout'] });
	const updated = '// Requested model clarification.\n' + purchase;
	const ready = await advanceFeatureImplementation(f.root, job.id, undefined, undefined, fakeProvider(data => {
		assert.deepEqual([data.file, data.currentSource.content], [source, purchase]);
		return proposal(data, updated);
	}));
	assert.equal(ready.status, 'ready', JSON.stringify(ready.tasks));
	await f.execute('Verify', { id: job.id, reviewId: ready.reviewId });
	await f.execute('Apply', { id: job.id, reviewId: ready.reviewId });
	assert.equal(await readFile(join(f.root, source), 'utf8'), updated + '\n');
	await assert.rejects(f.execute('Inspect', { modelFile: '.ordito/imports/11111111-1111-1111-1111-111111111111/model.ordito.json' }), /active imported/);
	await assert.rejects(f.execute('Inspect', { modelFile: '.ordito/feature-code-cases.json' }), /saved Specsplice model/);
});

test('recovery completes committed publication after archive-link cleanup was interrupted', async t => {
	const f = await fixture(t), job = await f.prepare({ featureIds: ['checkout'] });
	const ready = await advanceFeatureImplementation(f.root, job.id, undefined, undefined, grounded);
	const verified = await f.execute('Verify', { id: ready.id, reviewId: ready.reviewId });
	const original = fs.rm;
	const mock = t.mock.method(fs, 'rm', async (...args) => {
		if (String(args[0]).endsWith('apply-0.next')) { throw new Error('Simulated interruption after commit'); }
		return original(...args);
	});
	syncBuiltinESMExports();
	try { await assert.rejects(f.execute('Apply', { id: ready.id, reviewId: verified.reviewId }), /after commit/); }
	finally { mock.mock.restore(); syncBuiltinESMExports(); }
	assert.deepEqual([(await f.execute('Session', { id: ready.id })).status, (await stat(join(f.root, 'package.json'))).nlink], ['interrupted', 2]);
	assert.deepEqual([(await f.execute('Recover', { id: ready.id })).status, (await stat(join(f.root, 'package.json'))).nlink], ['applied', 1]);
	assert.equal((await f.prepare({ featureIds: ['checkout'] })).mode, 'update');
});
