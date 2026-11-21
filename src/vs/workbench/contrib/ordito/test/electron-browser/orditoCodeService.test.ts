import assert from 'assert';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { IChannel, IPCClient } from '../../../../../base/parts/ipc/common/ipc.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ServiceIdentifier } from '../../../../../platform/instantiation/common/instantiation.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IProgressService } from '../../../../../platform/progress/common/progress.js';
import { IQuickInputService, type IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { IFilesConfigurationService } from '../../../../services/filesConfiguration/common/filesConfigurationService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IShellEnvironmentService } from '../../../../services/environment/electron-browser/shellEnvironmentService.js';
import { IUtilityProcessWorker, IUtilityProcessWorkerWorkbenchService } from '../../../../services/utilityProcess/electron-browser/utilityProcessWorkerWorkbenchService.js';
import { IOrditoOperationService, OrditoOperationService } from '../../browser/orditoOperationService.js';
import { IOrditoProjectService } from '../../browser/orditoProjectService.js';
import { IOrditoProjectWorkspaceService } from '../../browser/orditoProjectWorkspace.js';
import { orditoCodeProtocolVersion, CodeBridgeProtocol, CodeContext, type CodePreview, type CodeRequest } from '../../common/codeBridge.js';
import { checkoutModel } from '../../common/checkoutModel.js';
import { OrditoCodeService } from '../../electron-browser/orditoCodeService.js';

suite('Specsplice native code bridge compatibility', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const compatible: CodeBridgeProtocol = { version: orditoCodeProtocolVersion, operations: ['exploration', 'diagramPrepare', 'diagramStep', 'diagramApprovePlan', 'codeUpdate'] };
	function fixture(initial: CodeBridgeProtocol | undefined | Error) {
		const instantiation = store.add(new TestInstantiationService());
		const stub = <T extends object>(id: ServiceIdentifier<T>, values: object = {}) => { const service = Object.assign(new (mock<T>())(), values); instantiation.stub(id, service); return service; };
		let protocol = initial, created = 0, disposed = 0, failInspect = false;
		const projectChanged = store.add(new Emitter<void>());
		const calls: string[] = [];
		const commands: string[] = [], errors: string[] = [];
		const requests: CodeRequest[] = [], pickers: string[] = [], opened: string[] = [];
		const editorInputs: object[] = [];
		const reportWrites = new Map<string, string>(), readonlyReports: string[] = [];
		let previewResult: CodePreview | undefined;
		let importResponse: (() => Promise<CodeContext>) | undefined;
		let choose: ((items: readonly IQuickPickItem[]) => IQuickPickItem | undefined) | undefined;
		const context: CodeContext = { snapshot: '/project/.ordito/imports/index', model: '/project/.ordito/imports/index/model.ordito.json', sourceRoot: '/project', revision: 'fixture', scope: { include: ['**'], exclude: [], excludedDirectories: [], respectGitignore: true, languageOverrides: {} }, files: [], declarations: [], dependencies: [], providers: [], diagnostics: [], diagramState: 'index' };
		const channel: IChannel = { listen: () => Event.None, async call<T>(command: string, argument?: string): Promise<T> {
			calls.push(command);
			if (command === 'protocol') { if (protocol instanceof Error) { throw protocol; } return protocol as T; }
			if (command === 'execute') {
				const request = JSON.parse(argument!); requests.push(request);
				if (request.operation === 'inspect' && failInspect) { throw new Error('Unavailable snapshot'); }
				if (request.operation === 'import' && importResponse) { return JSON.stringify(await importResponse()) as T; }
				return JSON.stringify(request.operation === 'preview' ? previewResult ?? { token: 'inventory', context, parsed: [], reused: [], files: { added: [], changed: [], removed: [] }, declarations: { added: [], changed: [], removed: [] }, dependencies: { added: [], changed: [], removed: [] } } : request.operation === 'source' ? { path: '/project/app.rb', stale: false, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } : context) as T;
			}
			return '/cli/codex' as T;
		} };
		stub(IUtilityProcessWorkerWorkbenchService, { createWorker: async () => {
			created++;
			return Object.assign(new (mock<IUtilityProcessWorker>())(), { client: Object.assign(new (mock<IPCClient<string>>())(), { getChannel: () => channel }), onDidTerminate: new Promise<never>(() => {}), dispose: () => { disposed++; } });
		} });
		const model = structuredClone(checkoutModel);
		const project = stub(IOrditoProjectService, { onDidChange: projectChanged.event, model, save: async () => true, openModelResource: async (resource: URI) => { opened.push(resource.fsPath); Object.assign(project, { modelUri: resource }); return true; }, showHome: () => {} });
		const operations = store.add(new OrditoOperationService()); instantiation.stub(IOrditoOperationService, operations);
		stub(IShellEnvironmentService, { getShellEnv: async () => ({ PATH: '/cli' }) });
		const fileDialogs = stub(IFileDialogService, { showOpenDialog: async () => { pickers.push('folder'); return undefined; } });
		const quick = stub(IQuickInputService, { pick: async (items: readonly IQuickPickItem[]) => { pickers.push('mode'); return choose?.(items); } });
		stub(INotificationService, { info: () => {}, error: (message: string) => errors.push(message) });
		const progress = stub(IProgressService, { withProgress: async (_options: object, task: () => Promise<void>) => task() });
		stub(IFileService, { watch: () => toDisposable(() => {}), onDidFilesChange: Event.None, exists: async () => false, createFolder: async () => {}, writeFile: async (resource: URI, contents: { toString(): string }) => { reportWrites.set(resource.path, contents.toString()); } });
		stub(IFilesConfigurationService, { updateReadonly: async (resource: URI) => { readonlyReports.push(resource.path); } });
		const editors = stub(IEditorService, { openEditor: async (input: object) => { editorInputs.push(input); } });
		const aligned: (string | undefined)[] = [];
		stub(IOrditoProjectWorkspaceService, { align: async () => { aligned.push(project.modelUri?.toString()); } }); stub(IConfigurationService, { getValue: () => undefined });
		stub(ICommandService, { executeCommand: async (command: string) => { commands.push(command); } });
		const service = store.add(instantiation.createInstance(OrditoCodeService));
		return { service, errors, projectChanged, failInspect: (value: boolean) => { failInspect = value; }, calls, commands, model, context, project, requests, pickers, opened, editorInputs, reportWrites, readonlyReports, setPreview: (value: CodePreview) => { previewResult = value; }, setImportResponse: (value: typeof importResponse) => { importResponse = value; }, quick, fileDialogs, progress, operations, editors, aligned, setChoice: (value: typeof choose) => { choose = value; }, stats: () => ({ created, disposed }), setProtocol: (value: CodeBridgeProtocol) => { protocol = value; } };
	}
	function importFixture(root = '/project') {
		const f = fixture(compatible);
		Object.assign(f.fileDialogs, { showOpenDialog: async () => [URI.file(root)] });
		f.setChoice(items => items[0]);
		return f;
	}
	test('live exploration status reads use the local worker channel while opening uses the CLI runtime channel', async () => {
		const f = fixture(compatible);
		const status = { operation: 'exploration' as const, snapshot: f.context.snapshot, request: JSON.stringify({ action: 'status', sessionId: 'existing' }) };
		await f.service.executeReconciliation(status);
		await f.service.executeReconciliation({ ...status, request: JSON.stringify({ action: 'open' }) });
		assert.deepStrictEqual(f.calls, ['protocol', 'execute', 'reconcile']);
		assert.deepStrictEqual(f.requests, [status]);
	});
	test('a successful import aligns its canonical source even when the selected path is an alias', async () => {
		const f = importFixture('/tmp/project');
		Object.assign(f.context, { sourceRoot: '/private/tmp/project', snapshot: '/private/tmp/project/.ordito/imports/index', model: '/private/tmp/project/.ordito/imports/index/model.ordito.json' });
		await f.service.importCodebase();
		assert.deepStrictEqual({ requests: f.requests, opened: f.opened, aligned: f.aligned }, { requests: [{ operation: 'import', root: URI.file('/tmp/project').fsPath, syntaxOnly: false }], opened: [URI.file(f.context.model).fsPath], aligned: [URI.file(f.context.model).toString()] });
	});
	test('a failed import never aligns an older context at the same source root', async () => {
		const f = importFixture(); f.service.context = f.context;
		f.setImportResponse(async () => { throw Object.assign(new Error('EACCES: cannot read source folder'), { code: 'EACCES' }); });
		await f.service.importCodebase();
		assert.deepStrictEqual([f.opened, f.aligned, f.service.context], [[], [], f.context]);
		assert.deepStrictEqual({ alerts: f.errors.length, cause: /Cause:.*permissions/.test(f.errors[0]), resolution: /How to resolve:.*permissions/.test(f.errors[0]), originalProblem: /EACCES: cannot read source folder/.test(f.errors[0]) }, { alerts: 1, cause: true, resolution: true, originalProblem: true });
	});
	test('declining the imported model leaves the previous context and workspace untouched', async () => {
		const f = importFixture(); f.service.context = f.context;
		Object.assign(f.project, { openModelResource: async () => false });
		await f.service.importCodebase();
		assert.deepStrictEqual([f.aligned, f.service.context], [[], f.context]);
	});
	test('a busy operation does not import or align an older context at the selected root', async () => {
		const f = importFixture(); f.service.context = f.context;
		const held = f.operations.acquire('ai'); assert.ok(held); store.add(held);
		await f.service.importCodebase();
		assert.deepStrictEqual([f.requests, f.opened, f.aligned], [[], [], []]);
	});
	test('cancellation before the import result is opened prevents workspace alignment', async () => {
		const f = importFixture(); f.service.context = f.context;
		Object.assign(f.progress, { withProgress: async (_options: object, task: () => Promise<void>, cancel: () => void) => { cancel(); await task(); } });
		await f.service.importCodebase();
		assert.deepStrictEqual([f.opened, f.aligned, f.service.context], [[], [], f.context]);
	});
	test('cancellation after opening the import but before progress completes prevents workspace alignment', async () => {
		const f = importFixture();
		Object.assign(f.progress, { withProgress: async (_options: object, task: () => Promise<void>, cancel: () => void) => { await task(); cancel(); } });
		await f.service.importCodebase();
		assert.deepStrictEqual([f.opened, f.aligned], [[URI.file(f.context.model).fsPath], []]);
	});
	test('failure after opening the model never aligns the workspace', async () => {
		const f = importFixture();
		Object.assign(f.editors, { openEditor: async () => { throw new Error('Editor failed to open'); } });
		await f.service.importCodebase();
		assert.deepStrictEqual([f.opened, f.aligned], [[URI.file(f.context.model).fsPath], []]);
	});
	test('switching context while the imported editor opens prevents alignment to the replacement project', async () => {
		const f = importFixture();
		Object.assign(f.editors, { openEditor: async () => { f.service.context = { ...f.context, snapshot: '/other/snapshot' }; } });
		await f.service.importCodebase();
		assert.deepStrictEqual(f.aligned, []);
	});
	test('switching the current model while its imported editor opens prevents workspace alignment', async () => {
		const f = importFixture();
		Object.assign(f.editors, { openEditor: async () => { Object.assign(f.project, { modelUri: URI.file('/other/model.ordito.json') }); } });
		await f.service.importCodebase();
		assert.deepStrictEqual(f.aligned, []);
	});
	test('a repaired imported model restores source context without reimporting the project', async () => {
		const f = fixture(compatible);
		Object.assign(f.project, { modelUri: URI.file(f.context.model), loading: true }); f.projectChanged.fire();
		Object.assign(f.project, { loading: false, error: 'Invalid model' }); f.projectChanged.fire();
		assert.deepStrictEqual(f.requests, []);
		const ready = Event.toPromise(Event.filter(f.service.onDidChange, () => !f.service.busy));
		Object.assign(f.project, { error: undefined }); f.projectChanged.fire(); await ready;
		assert.deepStrictEqual(f.service.context, f.context);
		assert.deepStrictEqual(f.requests, [{ operation: 'inspect', snapshot: f.context.snapshot }]);
	});

	test('a failed snapshot read is retried on the next project refresh at the same path', async () => {
		const f = fixture(compatible); Object.assign(f.project, { modelUri: URI.file(f.context.model) }); f.failInspect(true);
		let ready = Event.toPromise(Event.filter(f.service.onDidChange, () => !f.service.busy));
		f.projectChanged.fire(); await ready; assert.strictEqual(f.service.context, undefined);
		assert.deepStrictEqual({ cause: /Cause:/.test(f.service.status), resolution: /How to resolve:/.test(f.service.status), originalProblem: /Unavailable snapshot/.test(f.service.status), alerts: f.errors }, { cause: true, resolution: true, originalProblem: true, alerts: [] });
		f.failInspect(false); ready = Event.toPromise(Event.filter(f.service.onDidChange, () => !f.service.busy));
		f.projectChanged.fire(); await ready;
		assert.deepStrictEqual(f.service.context, f.context);
		assert.deepStrictEqual(f.requests.map(request => request.operation), ['inspect', 'inspect']);
	});

	test('attaching an index to a source inventory prepares local evidence without starting AI', async () => {
		const f = fixture(compatible); f.service.context = f.context;
		Object.assign(f.fileDialogs, { showOpenDialog: async () => [URI.file('/indexes/python.json')] });
		f.setChoice(items => items.find(item => item.label === 'Apply Source Inventory'));
		await f.service.attachIndex();
		assert.deepStrictEqual(f.commands, []);
		assert.deepStrictEqual(f.requests, [{ operation: 'preview', snapshot: f.context.snapshot, scope: f.context.scope, inventoryOnly: true, bundles: ['/indexes/python.json'] }, { operation: 'apply', token: 'inventory' }]);
	});
	test('scope configuration previews and applies inventory without starting diagram generation', async () => {
		const f = fixture(compatible); f.service.context = f.context;
		const inputs = ['src/**', '**/generated/**'];
		Object.assign(f.quick, { input: async () => inputs.shift() });
		f.setChoice(items => items.find(item => item.label === 'Apply Source Inventory'));
		await f.service.configure();
		assert.deepStrictEqual(f.commands, []);
		assert.deepStrictEqual(f.requests, [{ operation: 'preview', snapshot: f.context.snapshot, scope: { ...f.context.scope, include: ['src/**'], exclude: ['**/generated/**'] }, inventoryOnly: true }, { operation: 'apply', token: 'inventory' }]);
	});
	test('project file coverage opens the indexed source at its start', async () => {
		const f = fixture(compatible); f.service.context = f.context;
		f.context.files.push({ path: 'app.rb', revision: 'source-hash', language: 'ruby', status: 'parsed', diagnostics: [] });
		f.setChoice(items => items.find(item => item.label === 'app.rb'));
		await f.service.inspect();
		assert.deepStrictEqual(f.requests, [{ operation: 'source', snapshot: f.context.snapshot, file: 'app.rb', revision: 'source-hash', start: 0, end: 0 }]);
		assert.deepStrictEqual(f.editorInputs, [{ resource: URI.file('/project/app.rb'), options: { pinned: true, selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 } } }]);
	});
	test('excluded source coverage never becomes a source navigation request', async () => {
		const f = fixture(compatible); f.service.context = f.context;
		f.context.files.push({ path: 'outside.rb', revision: 'untrusted', language: '', status: 'excluded', diagnostics: ['symlink (1)'] });
		f.setChoice(items => {
			const choice = items.find(item => item.label === 'outside.rb');
			assert.equal(choice?.description, 'excluded');
			assert.match(choice?.detail ?? '', /not read during analysis/);
			return undefined;
		});
		await f.service.inspect();
		assert.deepStrictEqual([f.requests, f.editorInputs], [[], []]);
	});
	test('semantic coverage labels explain index gaps and retain the diagnostic code', async () => {
		const f = fixture(compatible); f.service.context = f.context;
		f.context.diagnostics.push('app.rb: missingDocument');
		f.setChoice(items => {
			assert.deepStrictEqual(items.filter(item => item.label !== 'Open Full Analysis Details'), [{ label: 'app.rb: No Static Reference Index for This File', detail: 'app.rb: missingDocument' }]);
			return undefined;
		});
		await f.service.inspect();
	});

	test('updating an unlinked saved project uses its own codebase and preserves its model without asking for a folder or mode', async () => {
		const f = fixture(compatible);
		Object.assign(f.project, { projectRoot: URI.file('/project'), modelUri: URI.file('/project/.ordito/model.json') });
		assert.equal(await f.service.ensureProjectContext(), true);
		assert.equal(await f.service.ensureProjectContext(), true);
		assert.deepStrictEqual({ requests: f.requests, pickers: f.pickers, opened: f.opened, context: f.service.context }, { requests: [{ operation: 'import', root: '/project', modelFile: '.ordito/model.json' }], pickers: [], opened: [f.context.model], context: f.context });
	});
	test('an existing codebase context is reused without any import or picker', async () => {
		const f = fixture(compatible); f.service.context = f.context;
		assert.equal(await f.service.ensureProjectContext(), true);
		assert.deepStrictEqual([f.requests, f.pickers], [[], []]);
	});
	test('only the absence of an open project asks for a codebase and cancellation stops the update', async () => {
		const f = fixture(compatible);
		assert.equal(await f.service.ensureProjectContext(), false);
		assert.deepStrictEqual([f.pickers, f.requests, f.opened], [['folder'], [], []]);
	});
	test('a failed project save stops indexing without opening another codebase', async () => {
		const f = fixture(compatible);
		Object.assign(f.project, { projectRoot: URI.file('/project'), modelUri: URI.file('/project/.ordito/model.json'), save: async () => false });
		assert.equal(await f.service.ensureProjectContext(), false);
		assert.deepStrictEqual([f.pickers, f.requests, f.opened], [[], [], []]);
	});
	for (const direction of [undefined, 'code', 'model'] as const) {
		test(`Sync ${direction ?? 'both'} builds the first diagrams before checking alignment`, async () => {
			const f = fixture(compatible);
			const context: CodeContext = { snapshot: '/project/.ordito/imports/index', model: '/project/.ordito/imports/index/model.ordito.json', sourceRoot: '/project', revision: 'fixture', scope: { include: ['**'], exclude: [], excludedDirectories: [], respectGitignore: true, languageOverrides: {} }, files: [], declarations: [], dependencies: [], providers: [], diagnostics: [], diagramState: 'index' };
			f.service.context = context;
			await f.service.sync(direction);
			assert.deepStrictEqual({ commands: f.commands, calls: f.calls }, { commands: ['ordito.ai.buildDiagrams'], calls: [] });
		});
	}
	for (const [label, file, contents] of [
		['Inspect Code Changes', 'Sync Code Changes.md', 'return 10;'],
		['Questions and Validation', 'Sync Questions and Validation.md', 'Provide the regression test results.']
	]) {
		test(`${label} opens a named protected report without starting clarification or another AI request`, async () => {
			const f = fixture(compatible); f.context.diagramState = 'diagrams'; f.service.context = f.context;
			f.setPreview({ token: 'sync-review', context: f.context, files: { added: [], changed: [], removed: [], unchanged: [] }, declarations: { added: [], changed: [], removed: [] }, dependencies: { added: [], changed: [], removed: [] }, conflicts: [], impact: { elementIds: [], viewIds: [] }, parsed: [], reused: [], semanticAnalyzed: [], semanticReused: [], ai: { summary: 'Bound quantity', questions: ['Provide the regression test results.'], usage: { inputTokens: 10, outputTokens: 10 }, cost: null, modelEdits: [], bindings: [], sourceEdits: [{ file: 'quantity.js', search: 'return 0;', replacement: 'return 10;' }] }, reconciliation: { status: 'pending', origin: 'model', commonRevision: 'base', sourceEdits: [], diagnostics: [] } });
			let picked = false;
			f.setChoice(items => {
				assert.ok(items.some(item => item.label === 'Answer Sync Questions'));
				assert.ok(!items.some(item => item.label === 'Apply Sync'));
				if (picked) { return undefined; } picked = true; return items.find(item => item.label === label);
			});
			await f.service.sync();
			const resource = URI.file(`/project/.ordito/reports/sync-review/${file}`);
			assert.deepStrictEqual(f.commands, []);
			assert.deepStrictEqual(f.requests.map(request => request.operation), ['preview']);
			assert.deepStrictEqual(f.readonlyReports, [resource.path]);
			assert.ok(f.reportWrites.get(resource.path)?.includes(contents));
			assert.deepStrictEqual(f.editorInputs, [{ resource, options: { pinned: true, override: 'default' } }]);
		});
	}

	test('checks the bundled engine before requests and reuses a compatible worker', async () => {
		const f = fixture(compatible);
		assert.strictEqual(await f.service.resolveCli('codex'), '/cli/codex');
		assert.strictEqual(await f.service.resolveCli('codex'), '/cli/codex');
		assert.deepStrictEqual({ calls: f.calls, ...f.stats() }, { calls: ['protocol', 'resolveCli', 'resolveCli'], created: 1, disposed: 0 });
	});
	const cases: [string, CodeBridgeProtocol | undefined | Error][] = [
		['old engine without metadata', undefined],
		['old worker without handshake', new Error('Invalid analysis request')],
		['different protocol version', { ...compatible, version: orditoCodeProtocolVersion + 1 }],
		['missing diagram operation', { ...compatible, operations: ['diagramPrepare'] }]
	];
	for (const [name, protocol] of cases) {
		test(`explains ${name}, blocks execution and allows retry after repair`, async () => {
			const f = fixture(protocol);
			await assert.rejects(f.service.resolveCli('codex'), /analysis engine is out of date.*npm run build-fast.*fully quit/);
			assert.deepStrictEqual({ calls: f.calls, ...f.stats() }, { calls: ['protocol'], created: 1, disposed: 1 });
			f.setProtocol(compatible);
			assert.strictEqual(await f.service.resolveCli('codex'), '/cli/codex');
			assert.deepStrictEqual(f.calls, ['protocol', 'protocol', 'resolveCli']);
		});
	}
});
