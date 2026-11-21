import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const domain = 'src/vs/workbench/contrib/ordito/common/';

async function sources(directory) {
	const entries = await readdir(join(root, directory), { withFileTypes: true });
	const files = await Promise.all(entries.filter(entry => !['node_modules', 'test', 'out'].includes(entry.name)).map(entry => {
		const file = join(directory, entry.name);
		return entry.isDirectory() ? sources(file) : file.endsWith('.ts') ? [file] : [];
	}));
	return files.flat();
}

test('Specsplice production dependencies preserve domain and importer boundaries and have no runtime cycles', async () => {
	const roots = ['src/vs/workbench/contrib/ordito', 'ordito/ai', 'ordito/code-import', 'ordito/runtime', 'ordito/messaging'];
	const files = (await Promise.all(roots.map(sources))).flat();
	const graph = new Map(), violations = [];
	for (const file of files) {
		const source = ts.createSourceFile(file, await readFile(join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
		const edges = [];
		for (const statement of source.statements) {
			if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier) { continue; }
			const specifier = statement.moduleSpecifier.text;
			if (file.startsWith(domain) && !specifier.startsWith('./')) { violations.push(`${file}: domain imports ${specifier}`); }
			const target = relative(root, resolve(root, dirname(file), specifier.replace(/\.js$/, '.ts')));
			if (file.startsWith('ordito/code-import/') && (target.startsWith('ordito/ai/') || target === 'ordito/runtime/nativeHost.ts')) { violations.push(`${file}: importer imports application ${target}`); }
			if (file.startsWith(domain) && file !== domain + 'semanticModel.ts' && target === domain + 'semanticModel.ts') { violations.push(`${file}: implementation imports public facade`); }
			const clause = statement.importClause;
			const named = clause?.namedBindings;
			const typeOnly = statement.isTypeOnly || clause?.isTypeOnly || clause && !clause.name && named && ts.isNamedImports(named) && named.elements.every(element => element.isTypeOnly);
			if (!typeOnly && files.includes(target)) { edges.push(target); }
		}
		graph.set(file, edges);
	}
	const complete = new Set(), active = new Set(), stack = [];
	function visit(file) {
		if (active.has(file)) { violations.push('Cycle: ' + [...stack.slice(stack.indexOf(file)), file].join(' → ')); return; }
		if (complete.has(file)) { return; }
		active.add(file); stack.push(file);
		for (const dependency of graph.get(file) ?? []) { visit(dependency); }
		stack.pop(); active.delete(file); complete.add(file);
	}
	for (const file of files) { visit(file); }
	assert.deepEqual(violations, []);
});

test('desktop smoke modules resolve all shared scenario and harness names', async () => {
	const directory = join(root, 'ordito/scripts/smoke');
	const files = (await readdir(directory)).filter(file => file.endsWith('.ts')).map(file => join(directory, file));
	const program = ts.createProgram(files, { allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.NodeNext, types: ['node'], typeRoots: [join(root, 'ordito/runtime/node_modules/@types')] });
	const unresolved = ts.getPreEmitDiagnostics(program).filter(diagnostic => files.includes(diagnostic.file?.fileName) && [2304, 2552].includes(diagnostic.code));
	assert.deepEqual(unresolved.map(diagnostic => `${relative(root, diagnostic.file.fileName)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`), []);
});
