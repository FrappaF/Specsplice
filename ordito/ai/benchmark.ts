import { mkdtemp, mkdir, writeFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importCode } from '../code-import/importCode.ts';
import { writeSnapshot } from '../code-import/snapshot.ts';
import { prepareImplementation, hash } from './context.ts';
import { proposeImplementation } from './collaboration.ts';
import { stageImplementation, verifyImplementation, planReviewId } from './implementation.ts';
import { createCliProvider, createPlanProvider } from './providers.ts';
import { readProviderConfig, type ProviderConfig, type StructuredProvider } from './contracts.ts';
import { nodeTestEnvironment, runProcess } from './process.ts';

const cases = [
	{
		id: 'checkout',
		source: `export async function purchase(cart, gateway) { const payment = await gateway.charge(cart.total); return { status: 'confirmed', paymentId: payment.id }; }\n`,
		intent: `Implement payment refusal: gateway.charge returns {approved:false,code:'card_declined'} or {approved:true,id:'p1'}. Refusal must return exactly {status:'declined',reason:payment.code}; approval retains {status:'confirmed',paymentId:payment.id}. Call the gateway exactly once. Do not throw for a refusal.`,
		oracle: `import {purchase} from './checkout.mjs'; let calls=0; assert.deepEqual(await purchase({total:20},{charge:async()=>{calls++;return {approved:false,code:'card_declined'};}}),{status:'declined',reason:'card_declined'}); assert.equal(calls,1); assert.deepEqual(await purchase({total:20},{charge:async()=>({approved:true,id:'p1'})}),{status:'confirmed',paymentId:'p1'});`
	},
	{
		id: 'inventory',
		source: `export function reserve(stock, quantity) { stock.available -= quantity; return { ok: true, remaining: stock.available }; }\n`,
		intent: `Reject a quantity unless it is a positive integer, returning exactly {ok:false,reason:'invalid_quantity'}. Reject insufficient stock with exactly {ok:false,reason:'out_of_stock'}. Neither rejection may mutate stock.available. A valid reservation subtracts quantity and returns {ok:true,remaining:stock.available}.`,
		oracle: `import {reserve} from './inventory.mjs'; const s={available:2}; assert.deepEqual(reserve(s,3),{ok:false,reason:'out_of_stock'}); assert.equal(s.available,2); for(const q of [0,-1,1.5,NaN]){assert.deepEqual(reserve(s,q),{ok:false,reason:'invalid_quantity'});assert.equal(s.available,2);} assert.deepEqual(reserve(s,2),{ok:true,remaining:0});`
	},
	{
		id: 'authorization',
		source: `export function authorize(role, operation) { return role === 'admin' || role === 'user'; }\n`,
		intent: `Authorize only the known operations 'read' and 'delete'. Admin may perform either; user may only read; every other role and every unknown operation returns false. Preserve a boolean return value.`,
		oracle: `import {authorize} from './authorization.mjs'; assert.deepEqual(['admin','user','guest',null].flatMap(role=>['read','delete','unknown'].map(op=>authorize(role,op))),[true,true,false,true,false,false,false,false,false,false,false,false]);`
	}
];

export const benchmarkThresholds = { repositories: 3, acceptancePassRate: 1, traceability: 1, featureAttribution: 1, criterionCoverage: 1, maxCaseDurationMs: 360000 } as const;
export interface BenchmarkCandidate {
	config: ProviderConfig;
	/** Optional quoted rates. These are estimates in the stated unit, never actual charges. */
	rates?: { input: number; output: number; unit: string; source: string; asOf: string };
}
interface CaseResult {
	repository: string; sourceDigest: string; passed: boolean; traceability: number; featureAttribution: number; criterionCoverage: number;
	durationMs: number; inputTokens: number | null; outputTokens: number | null; actualCost: null; failure?: string;
	cliInvocations: number;
	usage: { phase: 'plan' | 'implementation'; inputTokens: number | null; outputTokens: number | null }[];
}
export interface BenchmarkResult {
	version: 1; kind: 'live-provider-benchmark' | 'simulated-benchmark'; recordedAt: string; thresholds: typeof benchmarkThresholds;
	models: { candidate: BenchmarkCandidate; cases: CaseResult[]; eligible: boolean; estimatedConsumption: number | null }[];
	defaultModel: string | null;
}

/** No recommendation without measured quality, current account availability and comparable quoted units. */
export function selectBenchmarkDefault(report: BenchmarkResult, available: string[]): string | null {
	if (report.kind !== 'live-provider-benchmark') { return null; }
	const candidates = report.models.filter(model => model.eligible && new Set(model.cases.map(result => result.repository)).size >= 3 && model.cases.every(result => result.passed && result.traceability === 1 && result.featureAttribution === 1 && result.criterionCoverage === 1 && result.durationMs <= benchmarkThresholds.maxCaseDurationMs) && model.estimatedConsumption !== null && Number.isFinite(model.estimatedConsumption) && model.estimatedConsumption >= 0 && available.includes(model.candidate.config.model));
	if (!candidates.length || new Set(candidates.map(model => model.candidate.rates?.unit)).size !== 1 || new Set(candidates.map(model => model.candidate.config.provider)).size !== 1) { return null; }
	return candidates.sort((left, right) => left.estimatedConsumption! - right.estimatedConsumption!)[0].candidate.config.model;
}

/** Three independent Git repositories with hidden deterministic acceptance oracles. Up to two calls per case. */
export async function benchmarkModels(candidates: BenchmarkCandidate[], signal?: AbortSignal, suppliedProvider?: StructuredProvider): Promise<BenchmarkResult> {
	const provider = suppliedProvider ?? createCliProvider();
	if (candidates.length < 2 || candidates.length > 3 || new Set(candidates.map(candidate => candidate.config.model)).size !== candidates.length) { throw new Error('Compare two or three explicit models'); }
	for (const candidate of candidates) {
		readProviderConfig(candidate.config);
		if (candidate.rates && (![candidate.rates.input, candidate.rates.output].every(value => Number.isFinite(value) && value >= 0) || !candidate.rates.unit || !candidate.rates.source || !Number.isFinite(Date.parse(candidate.rates.asOf)))) { throw new Error('Benchmark rates require nonnegative values, unit, source and date'); }
	}
	const report: BenchmarkResult = { version: 1, kind: suppliedProvider ? 'simulated-benchmark' : 'live-provider-benchmark', recordedAt: new Date().toISOString(), thresholds: benchmarkThresholds, models: [], defaultModel: null };
	for (const candidate of candidates) {
		const results: CaseResult[] = [];
		for (const item of cases) {
			signal?.throwIfAborted();
			const directory = await mkdtemp(join(tmpdir(), 'ordito-benchmark-'));
			const started = performance.now();
			const result: CaseResult = { repository: item.id, sourceDigest: hash(item.source), passed: false, traceability: 0, featureAttribution: 0, criterionCoverage: 0, durationMs: 0, inputTokens: null, outputTokens: null, actualCost: null, cliInvocations: 0, usage: [] };
			// Record returned usage before plan/reference validation can reject the response.
			const measuredProvider: StructuredProvider = { async complete(config, prompt, schema, signal) {
				const usage: CaseResult['usage'][number] = { phase: result.cliInvocations++ === 0 ? 'plan' : 'implementation', inputTokens: null, outputTokens: null };
				result.usage.push(usage);
				const response = await provider.complete(config, prompt, schema, signal);
				Object.assign(usage, response.usage);
				return response;
			} };
			try {
				const root = join(directory, item.id); await mkdir(root);
				await writeFile(join(root, '.gitignore'), '.ordito/\n');
				await writeFile(join(root, item.id + '.mjs'), item.source);
				for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Specsplice Benchmark', '-c', 'user.email=benchmark@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Benchmark baseline']]) {
					if ((await runProcess('git', ['-c', 'core.hooksPath=', ...args], root, { signal })).code) { throw new Error('Benchmark Git setup failed'); }
				}
				const state = await importCode(root, 'benchmark-' + item.id, { signal });
				const model = structuredClone(state.model);
				const featureId = 'benchmark-feature';
				model.semantics.elements.push({ id: featureId, kind: 'feature', name: item.id, behavior: { inputs: [], outputs: [], preconditions: [], postconditions: [], errors: [], permissions: [], acceptanceCriteria: [{ id: 'acceptance', given: 'The declared inputs', when: 'The feature is invoked', then: item.intent }] } });
				model.semantics.relations.push({ id: 'realizes-feature', kind: 'realization', from: state.files.flatMap(file => file.declarations)[0].id, to: featureId, name: 'Implements' });
				const snapshot = join(directory, 'snapshot'); await writeSnapshot(snapshot, state, model, undefined, undefined, signal);
				const prepared = await prepareImplementation({ version: 1, snapshot, featureId, intent: item.intent, constraints: ['Use only Node.js built-in test modules. Preserve the exported function and its module filename.'], sourceFiles: [item.id + '.mjs'] }, candidate.config, signal);
				const proposal = await proposeImplementation(prepared, prepared.reviewId, signal, createPlanProvider(measuredProvider));
				result.traceability = 1; result.featureAttribution = 1;
				const session = await stageImplementation(prepared, proposal.plan, planReviewId(prepared, proposal.plan), signal, measuredProvider);
				result.criterionCoverage = 1;
				const verified = await verifyImplementation(root, session.id, session.reviewId, signal);
				const oraclePath = join(session.worktree, 'ordito-benchmark-oracle.test.mjs');
				await writeFile(oraclePath, `import assert from 'node:assert/strict';\n` + item.oracle);
				try { result.passed = verified.status === 'passed' && (await runProcess(process.execPath, ['--test', './ordito-benchmark-oracle.test.mjs'], session.worktree, { signal, timeoutMs: 30000, env: nodeTestEnvironment() })).code === 0; }
				finally { await unlink(oraclePath); }
			} catch (error) {
				signal?.throwIfAborted();
				result.failure = error instanceof Error ? error.message : 'Benchmark failed';
			} finally {
				result.inputTokens = result.usage.length && result.usage.every(usage => usage.inputTokens !== null) ? result.usage.reduce((sum, usage) => sum + usage.inputTokens!, 0) : null;
				result.outputTokens = result.usage.length && result.usage.every(usage => usage.outputTokens !== null) ? result.usage.reduce((sum, usage) => sum + usage.outputTokens!, 0) : null;
				result.durationMs = Math.round(performance.now() - started);
				await rm(directory, { recursive: true, force: true });
			}
			results.push(result);
		}
		const rates = candidate.rates;
		const estimatedConsumption = rates && results.every(result => result.inputTokens !== null && result.outputTokens !== null) ? results.reduce((sum, result) => sum + (result.inputTokens! * rates.input + result.outputTokens! * rates.output) / 1000000, 0) : null;
		report.models.push({ candidate, cases: results, eligible: results.every(result => result.passed && result.durationMs <= benchmarkThresholds.maxCaseDurationMs), estimatedConsumption });
	}
	report.defaultModel = selectBenchmarkDefault(report, candidates.map(candidate => candidate.config.model));
	return report;
}
