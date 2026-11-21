import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, posix } from 'node:path';
import ts from 'typescript';
import { runProcess } from './process.ts';

export interface FeatureCodeVerificationFile {
	file: string;
	contents: string;
	exports: readonly string[];
	imports?: Readonly<Record<string, readonly string[]>>;
}

export interface FeatureCodeVerificationCase {
	id: string;
	file: string;
	exportName: string;
	args: readonly unknown[];
	expected: unknown;
}

export interface FeatureCodeVerificationResult {
	passed: boolean;
	cases: { id: string; passed: boolean; problem?: string }[];
	problem?: string;
}

const nodeVersion = '24.22.1';
const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const candidatePathPattern = /^(?:[A-Za-z0-9][A-Za-z0-9_-]*\/)*[A-Za-z0-9][A-Za-z0-9_-]*\.mjs$/;
const moduleSpecifierPattern = /^\.\/(?:[A-Za-z0-9][A-Za-z0-9_-]*\/)*[A-Za-z0-9][A-Za-z0-9_-]*\.mjs$/;
const globals = new Set(['Array', 'Boolean', 'Error', 'Infinity', 'JSON', 'Math', 'NaN', 'Number', 'Object', 'String', 'TypeError', 'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'undefined']);
const constantGlobals = new Set(['undefined', 'Infinity', 'NaN']);
const blockedProperties = new Set(['__proto__', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__', 'constructor', 'prototype', 'caller', 'callee', 'arguments', 'toJSON']);
const methods = new Set([
	'abs', 'at', 'ceil', 'charAt', 'charCodeAt', 'concat', 'endsWith', 'entries', 'every', 'filter', 'find', 'findIndex', 'flat', 'flatMap', 'floor',
	'from', 'fromEntries', 'hasOwn', 'includes', 'indexOf', 'isArray', 'isFinite', 'isInteger', 'isNaN', 'isSafeInteger', 'join', 'keys', 'lastIndexOf', 'map',
	'max', 'min', 'padEnd', 'padStart', 'parse', 'pow', 'reduce', 'reduceRight', 'replace', 'replaceAll', 'round', 'sign', 'slice', 'some', 'split', 'sqrt',
	'startsWith', 'stringify', 'substring', 'toFixed', 'toLowerCase', 'toReversed', 'toSorted', 'toString', 'toUpperCase', 'trim', 'trimEnd', 'trimStart',
	'trunc', 'values',
]);
const syntax = new Set<ts.SyntaxKind>([
	ts.SyntaxKind.SourceFile, ts.SyntaxKind.EndOfFileToken, ts.SyntaxKind.Identifier, ts.SyntaxKind.ExportKeyword,
	ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.EqualsGreaterThanToken,
	ts.SyntaxKind.Parameter, ts.SyntaxKind.Block, ts.SyntaxKind.VariableStatement, ts.SyntaxKind.VariableDeclarationList, ts.SyntaxKind.VariableDeclaration,
	ts.SyntaxKind.ArrayBindingPattern, ts.SyntaxKind.ObjectBindingPattern, ts.SyntaxKind.BindingElement, ts.SyntaxKind.DotDotDotToken,
	ts.SyntaxKind.ImportDeclaration, ts.SyntaxKind.ImportClause, ts.SyntaxKind.NamedImports, ts.SyntaxKind.ImportSpecifier,
	ts.SyntaxKind.IfStatement, ts.SyntaxKind.SwitchStatement, ts.SyntaxKind.CaseBlock, ts.SyntaxKind.CaseClause, ts.SyntaxKind.DefaultClause,
	ts.SyntaxKind.ReturnStatement, ts.SyntaxKind.ExpressionStatement, ts.SyntaxKind.EmptyStatement, ts.SyntaxKind.ThrowStatement,
	ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForOfStatement, ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement, ts.SyntaxKind.BreakStatement, ts.SyntaxKind.ContinueStatement,
	ts.SyntaxKind.ParenthesizedExpression, ts.SyntaxKind.ConditionalExpression, ts.SyntaxKind.QuestionToken, ts.SyntaxKind.ColonToken,
	ts.SyntaxKind.BinaryExpression, ts.SyntaxKind.PrefixUnaryExpression, ts.SyntaxKind.PostfixUnaryExpression, ts.SyntaxKind.TypeOfExpression,
	ts.SyntaxKind.CallExpression, ts.SyntaxKind.NewExpression, ts.SyntaxKind.PropertyAccessExpression, ts.SyntaxKind.ElementAccessExpression, ts.SyntaxKind.QuestionDotToken,
	ts.SyntaxKind.ArrayLiteralExpression, ts.SyntaxKind.ObjectLiteralExpression, ts.SyntaxKind.PropertyAssignment, ts.SyntaxKind.ShorthandPropertyAssignment,
	ts.SyntaxKind.SpreadAssignment, ts.SyntaxKind.SpreadElement, ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NumericLiteral,
	ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
	ts.SyntaxKind.TemplateExpression, ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateSpan, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail,
	ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken,
	ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
	ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
	ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.AsteriskAsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken,
	ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken, ts.SyntaxKind.ExclamationToken, ts.SyntaxKind.TildeToken,
]);

/** Resolve lexical bindings against the candidate alone. The compiler cannot read any files. */
function candidateProgram(contents: string) {
	const name = '/candidate.mjs';
	const options: ts.CompilerOptions = {
		allowJs: true, noLib: true, noResolve: true, strict: true, target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.NodeNext,
	};
	const source = ts.createSourceFile(name, contents, { languageVersion: ts.ScriptTarget.ES2024, impliedNodeFormat: ts.ModuleKind.ESNext }, true, ts.ScriptKind.JS);
	const program = ts.createProgram([name], options, {
		getSourceFile: file => file === name ? source : undefined,
		getDefaultLibFileName: () => '', writeFile: () => {}, getCurrentDirectory: () => '/', getDirectories: () => [],
		fileExists: file => file === name, readFile: file => file === name ? contents : undefined,
		getCanonicalFileName: file => file, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n', getEnvironmentVariable: () => '',
	});
	return { program, source, checker: program.getTypeChecker() };
}

/** Property names are exempt from lexical resolution, and are checked separately. */
function isName(node: ts.Identifier): boolean {
	const parent = node.parent;
	return (ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) && parent.name === node ||
		ts.isBindingElement(parent) && parent.propertyName === node || ts.isImportSpecifier(parent) && parent.propertyName === node;
}

/** Read the declared static property of an access expression. */
function staticProperty(expression: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | undefined {
	if (ts.isPropertyAccessExpression(expression)) { return expression.name.text; }
	return ts.isStringLiteral(expression.argumentExpression) || ts.isNumericLiteral(expression.argumentExpression) ? expression.argumentExpression.text : undefined;
}

/** Allow direct use of known intrinsics. Their functions and objects are never reflective data. */
function allowedGlobalUse(node: ts.Identifier): boolean {
	if (!globals.has(node.text)) { return false; }
	if (constantGlobals.has(node.text)) { return true; }
	const parent = node.parent;
	if (ts.isNewExpression(parent) && parent.expression === node) { return node.text === 'Error' || node.text === 'TypeError'; }
	if (ts.isCallExpression(parent) && parent.expression === node) { return node.text !== 'Math' && node.text !== 'JSON'; }
	return (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node && methods.has(staticProperty(parent) ?? '');
}

/** Admit the data transformation subset supported by the isolated profile. */
export function validateFeatureCode(contents: string, exports: readonly string[], imports: Readonly<Record<string, readonly string[]>> = {}): void {
	if (!contents || Buffer.byteLength(contents) > 32 * 1024 || !exports.length || new Set(exports).size !== exports.length || exports.some(name => !identifierPattern.test(name))) {
		throw new Error('featureCodeModuleContract');
	}
	const { program, source, checker } = candidateProgram(contents);
	const fail = (reason: string, position: number): never => {
		const { line, character } = source.getLineAndCharacterOfPosition(position);
		throw new Error(`featureCode${reason}:${line + 1}:${character + 1}`);
	};
	const error = program.getSyntacticDiagnostics(source)[0];
	if (error) { fail('Syntax', error.start ?? 0); }
	const seenExports = new Set<string>();
	for (const statement of source.statements) {
		if (ts.isImportDeclaration(statement)) {
			const specifier = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '';
			const clause = statement.importClause;
			const namedBindings = clause?.namedBindings;
			const names = namedBindings && ts.isNamedImports(namedBindings) ? namedBindings.elements : [];
			if (!moduleSpecifierPattern.test(specifier) || !Object.hasOwn(imports, specifier) || !names.length || clause?.name || statement.attributes || names.some(name => !imports[specifier].includes((name.propertyName ?? name.name).text))) {
				fail('ImportOutsideScope', statement.getStart(source));
			}
			continue;
		}
		if (ts.isFunctionDeclaration(statement) && statement.name && statement.body && !statement.asteriskToken) {
			if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) { seenExports.add(statement.name.text); }
			continue;
		}
		if (ts.isVariableStatement(statement) && !statement.modifiers?.length && statement.declarationList.flags & ts.NodeFlags.Const) { continue; }
		fail('TopLevelDeclaration', statement.getStart(source));
	}
	if (seenExports.size !== exports.length || exports.some(name => !seenExports.has(name))) { fail('ExportContract', 0); }

	const checkAssignment = (target: ts.Node) => {
		const binding = ts.isIdentifier(target) ? checker.getSymbolAtLocation(target)?.valueDeclaration : undefined;
		if (!binding || !ts.isVariableDeclaration(binding) || !ts.isVariableDeclarationList(binding.parent) || !(binding.parent.flags & ts.NodeFlags.Let) ||
			ts.findAncestor(binding, ts.isFunctionLike) !== ts.findAncestor(target, ts.isFunctionLike)) {
			fail('AssignmentNeedsLocalBinding', target.getStart(source));
		}
	};
	function visit(node: ts.Node): void {
		if (!syntax.has(node.kind)) { fail(`UnsupportedSyntax:${ts.SyntaxKind[node.kind]}`, node.getStart(source)); }
		if (ts.isVariableDeclarationList(node) && ![ts.NodeFlags.Const, ts.NodeFlags.Let].includes(node.flags & ts.NodeFlags.BlockScoped)) {
			fail('UnsupportedDeclaration', node.getStart(source));
		}
		if (ts.isIdentifier(node) && !isName(node)) {
			const binding = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
			if (!binding?.declarations?.some(declaration => declaration.getSourceFile() === source) && !allowedGlobalUse(node)) {
				fail(`UnapprovedBinding:${node.text}`, node.getStart(source));
			}
		}
		if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
			const name = staticProperty(node);
			if (name === undefined || blockedProperties.has(name)) { fail('UnsupportedPropertyAccess', node.getStart(source)); }
		}
		if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isBindingElement(node) && node.propertyName) {
			const key = ts.isBindingElement(node) ? node.propertyName! : node.name;
			if ((ts.isIdentifier(key) || ts.isStringLiteral(key)) && blockedProperties.has(key.text)) { fail('UnsupportedPropertyName', key.getStart(source)); }
		}
		if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))) {
			const method = staticProperty(node.expression);
			if (!method || !methods.has(method)) { fail('UnsupportedMethod', node.getStart(source)); }
		}
		if (ts.isNewExpression(node) && (!ts.isIdentifier(node.expression) || !['Error', 'TypeError'].includes(node.expression.text) || checker.getSymbolAtLocation(node.expression))) {
			fail('UnsupportedConstruction', node.getStart(source));
		}
		if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
			checkAssignment(node.left);
		}
		if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
			checkAssignment(node.operand);
		}
		if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.asteriskToken || ts.isForOfStatement(node) && node.awaitModifier) {
			fail('UnsupportedExecution', node.getStart(source));
		}
		if (ts.isForOfStatement(node) && !ts.isVariableDeclarationList(node.initializer)) {
			checkAssignment(node.initializer);
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
}

/** Bound data depth and reject values that would change meaning on serialization. */
function isJsonData(value: unknown, depth = 0): boolean {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') { return true; }
	if (typeof value === 'number') { return Number.isFinite(value) && !Object.is(value, -0); }
	if (depth >= 32 || !value || typeof value !== 'object') { return false; }
	if (Array.isArray(value)) { return value.length <= 1000 && Array.from(value).every(item => isJsonData(item, depth + 1)); }
	return (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
		Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor => Object.hasOwn(descriptor, 'value') && descriptor.enumerable && isJsonData(descriptor.value, depth + 1));
}

/** Verify case IDs and targets before using model-authored criteria in either harness. */
function checkCases(cases: readonly FeatureCodeVerificationCase[]): void {
	if (!cases.length || cases.length > 300 || new Set(cases.map(test => test.id)).size !== cases.length || cases.some(test =>
		!test.id || test.id.length > 160 || !candidatePathPattern.test(test.file) || !identifierPattern.test(test.exportName) ||
		!Array.isArray(test.args) || test.args.length > 32 || !isJsonData(test.args) || !isJsonData(test.expected))) {
		throw new Error('featureCodeInvalidCriteria');
	}
}

/** Render a readable, independently authored node:test file for the published project. */
export function renderFeatureCodeTests(cases: readonly FeatureCodeVerificationCase[], testDirectory = 'test'): string {
	checkCases(cases);
	const imports = new Map<string, string>();
	const tests = cases.map(({ id, file, exportName, args, expected }) => {
		const key = `${file}:${exportName}`;
		if (!imports.has(key)) { imports.set(key, `operation${imports.size + 1}`); }
		return `test(${JSON.stringify(id)}, () => {\n\tconst args = JSON.parse(${JSON.stringify(JSON.stringify(args))});\n\tconst expected = JSON.parse(${JSON.stringify(JSON.stringify(expected))});\n\tassert.deepStrictEqual(${imports.get(key)}(...args), expected);\n});`;
	});
	const declarations = [...imports].map(([key, binding]) => {
		const [file, exportName] = key.split(':');
		const relative = posix.relative(testDirectory, file);
		return `import { ${exportName} as ${binding} } from ${JSON.stringify(relative.startsWith('../') ? relative : './' + relative)};`;
	});
	return ["import assert from 'node:assert/strict';", "import { test } from 'node:test';", ...declarations, '', tests.join('\n\n'), ''].join('\n');
}

const executeCase = `(args => {
	const value = __orditoOperation(...args);
	const isData = (entry, depth = 0) => {
		if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') { return true; }
		if (typeof entry === 'number') { return Number.isFinite(entry) && !Object.is(entry, -0); }
		if (depth >= 32 || !entry || typeof entry !== 'object') { return false; }
		if (Array.isArray(entry)) {
			return entry.length <= 1000 && Reflect.ownKeys(entry).length === entry.length + 1 &&
				Array.from(entry, (item, index) => Object.hasOwn(entry, index) && isData(item, depth + 1)).every(Boolean);
		}
		if (Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null) { return false; }
		const descriptors = Object.getOwnPropertyDescriptors(entry);
		return Reflect.ownKeys(descriptors).every(key => typeof key === 'string' && descriptors[key].enumerable &&
			Object.hasOwn(descriptors[key], 'value') && isData(descriptors[key].value, depth + 1));
	};
	if (!isData(value)) { return undefined; }
	return JSON.stringify(value);
})(JSON.parse(`;

// Candidate modules and their inputs enter a fresh realm per case. Only data cloned by the realm's
// own JSON parser is passed to candidate functions. The process containing the realm has no project
// filesystem access, environment secrets, process privileges, or dynamic code generation enabled.
const verificationHarness = `
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createContext, runInContext, SourceTextModule } from 'node:vm';

const payload = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
const files = new Map(payload.files.map(file => [file.file, file]));
const invoke = ${JSON.stringify(executeCase)};
const cases = [];
for (const test of payload.cases) {
	const context = createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
	const modules = new Map();
	const load = file => {
		if (!modules.has(file)) {
			modules.set(file, new SourceTextModule(files.get(file).contents, { context, identifier: file }));
		}
		return modules.get(file);
	};
	let problem;
	try {
		const main = load(test.file);
		await main.link((specifier, referring, attributes) => {
			if (!Object.hasOwn(files.get(referring.identifier).imports ?? {}, specifier) || Object.keys(attributes.attributes).length) { throw new Error('moduleOutsideScope'); }
			return load(posix.join(posix.dirname(referring.identifier), specifier));
		});
		await main.evaluate({ timeout: 500 });
		// The installed value is a function from this same realm. Candidate code receives no
		// namespace, host callback, fixture objects, expected values, or test metadata.
		context.__orditoOperation = main.namespace[test.exportName];
		const encoded = runInContext(invoke + JSON.stringify(JSON.stringify(test.args)) + '))', context, { timeout: 500 });
		if (typeof encoded !== 'string' || encoded.length > 64 * 1024) { problem = 'featureCodeInvalidResult'; }
		else if (!isDeepStrictEqual(JSON.parse(encoded), test.expected)) { problem = 'featureCodeUnexpectedResult'; }
	} catch (error) {
		problem = error === undefined ? 'featureCodeInvalidResult' : error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? 'featureCodeCaseTimeout' : 'featureCodeCandidateFailed';
	}
	cases.push({ id: test.id, passed: !problem, ...(problem ? { problem } : {}) });
}
process.stdout.write(JSON.stringify({ passed: cases.every(test => test.passed), cases }));
`;

/** Resolve and check the trusted Node installation before enabling candidate execution. */
async function verificationNode(directory: string, signal?: AbortSignal): Promise<string> {
	const configured = process.env.ORDITO_NODE_EXECUTABLE;
	if (configured && !isAbsolute(configured)) { throw new Error('ORDITO_NODE_EXECUTABLE must be an absolute Node 24.22.1 executable path'); }
	const executable = configured || (process.versions.electron ? 'node' : process.execPath);
	try {
		const probe = await runProcess(executable, ['--input-type=module', '--eval', 'process.stdout.write(JSON.stringify({path:process.execPath,node:process.versions.node,electron:!!process.versions.electron,bun:!!process.versions.bun}))'], directory, {
			signal, timeoutMs: 5000, maxBytes: 1024, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
		});
		const version = probe.code === 0 ? JSON.parse(probe.stdout) as { path?: string; node?: string; electron?: boolean; bun?: boolean } : {};
		if (version?.node === nodeVersion && !version.electron && !version.bun && typeof version.path === 'string' && isAbsolute(version.path)) {
			return await realpath(version.path);
		}
	} catch {
		signal?.throwIfAborted();
	}
	throw new Error(`Feature verification requires Node ${nodeVersion}. Set ORDITO_NODE_EXECUTABLE before starting Specsplice.`);
}

/** Verify only admitted candidate files, with independent expected values and a bounded Node child. */
export async function verifyFeatureCode(files: readonly FeatureCodeVerificationFile[], cases: readonly FeatureCodeVerificationCase[], signal?: AbortSignal): Promise<FeatureCodeVerificationResult> {
	signal?.throwIfAborted();
	checkCases(cases);
	const byPath = new Map(files.map(file => [file.file, file]));
	const tested = new Set(cases.map(test => `${test.file}:${test.exportName}`));
	if (!files.length || files.length > 40 || byPath.size !== files.length || files.some(file => !candidatePathPattern.test(file.file) || file.exports.some(name => !tested.has(`${file.file}:${name}`))) ||
		cases.some(test => !byPath.get(test.file)?.exports.includes(test.exportName))) { throw new Error('featureCodeInvalidCandidateManifest'); }
	const preceding = new Map<string, FeatureCodeVerificationFile>();
	for (const file of files) {
		for (const [specifier, exports] of Object.entries(file.imports ?? {})) {
			const target = preceding.get(posix.join(posix.dirname(file.file), specifier));
			if (!moduleSpecifierPattern.test(specifier) || !target || exports.some(name => !target.exports.includes(name))) {
				throw new Error('featureCodeImportOutsideCandidate:' + file.file);
			}
		}
		validateFeatureCode(file.contents, file.exports, file.imports);
		preceding.set(file.file, file);
	}
	const payload = JSON.stringify({ files, cases });
	if (Buffer.byteLength(payload) > 2 * 1024 * 1024) { throw new Error('featureCodeVerificationBudget'); }
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'ordito-feature-verify-')));
	try {
		const executable = await verificationNode(directory, signal);
		await Promise.all([
			writeFile(join(directory, 'verification.mjs'), verificationHarness, { flag: 'wx', mode: 0o600 }),
			writeFile(join(directory, 'cases.json'), payload, { flag: 'wx', mode: 0o600 }),
		]);
		const result = await runProcess(executable, [
			'--permission', `--allow-fs-read=${directory}`, '--disable-proto=throw', '--disallow-code-generation-from-strings',
			'--experimental-vm-modules', '--max-old-space-size=96', './verification.mjs',
		], directory, { signal, timeoutMs: 30000, maxBytes: 256 * 1024, env: { SystemRoot: process.env.SystemRoot } });
		if (result.code !== 0) { return { passed: false, cases: [], problem: 'featureCodeRunnerFailed' }; }
		const report = JSON.parse(result.stdout) as FeatureCodeVerificationResult;
		if (!Array.isArray(report.cases) || report.cases.length !== cases.length || report.cases.some((entry, index) => entry.id !== cases[index].id || typeof entry.passed !== 'boolean')) {
			return { passed: false, cases: [], problem: 'featureCodeInvalidReceipt' };
		}
		return { ...report, passed: report.cases.every(entry => entry.passed) };
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
