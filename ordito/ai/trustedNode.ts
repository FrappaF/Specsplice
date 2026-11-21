import { isAbsolute } from 'node:path';
import { runProcess } from './process.ts';

/** Electron owns the UI runtime; isolated verification uses the separately installed Node runtime. */
export function needsExternalStructuralNode(input: string, electronVersion?: string): boolean {
	if (!electronVersion) { return false; }
	const request: { operation?: string } = JSON.parse(input);
	return request?.operation === 'structuralVerify' || request?.operation === 'featureImplementationVerify';
}

/** Import only the tool-owned engine bundle, passing the reviewed request over stdin, never shell text. */
export async function verifyWithExternalNode(input: string, engineModule: string, signal?: AbortSignal): Promise<string> {
	if (Buffer.byteLength(input) > 1024 * 1024) { throw new Error('Request exceeds 1 MiB'); }
	const configured = process.env.ORDITO_NODE_EXECUTABLE;
	if (configured && !isAbsolute(configured)) { throw new Error('ORDITO_NODE_EXECUTABLE must be an absolute Node 24.22.1 executable path'); }
	const executable = configured || 'node';
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_PATH;
	env.ORDITO_TRUSTED_NODE_CHILD = '1';
	const probe = await runProcess(executable, ['--input-type=module', '--eval', 'process.stdout.write(JSON.stringify({node:process.versions.node,electron:process.versions.electron??null,bun:process.versions.bun??null}))'], process.cwd(), { signal, env, timeoutMs: 5000, maxBytes: 1024 }).catch(error => {
		signal?.throwIfAborted();
		throw new Error(`External Node could not start: ${error.message}. Set ORDITO_NODE_EXECUTABLE to an absolute Node 24.22.1 path before starting Specsplice`);
	});
	let version: { node?: string; electron?: string | null; bun?: string | null } = {};
	try { version = JSON.parse(probe.stdout); } catch { /* Invalid probe is rejected below. */ }
	if (probe.code !== 0 || !version || version.node !== '24.22.1' || version.electron || version.bun) { throw new Error(`Trusted runner requires external Node 24.22.1; received ${version?.node ?? 'unavailable'}. Set ORDITO_NODE_EXECUTABLE before starting Specsplice`); }
	const script = `import {readFileSync} from 'node:fs';const controller=new AbortController();process.on('SIGTERM',()=>controller.abort());try{const {engine}=await import(process.argv[1]);process.stdout.write(await engine.execute(readFileSync(0,'utf8'),controller.signal));}catch(error){process.stderr.write(error.message);process.exitCode=1;}`;
	const result = await runProcess(executable, ['--input-type=module', '--eval', script, '--', engineModule], process.cwd(), { input: JSON.stringify({ operation: 'collaboration', request: input }), signal, env, timeoutMs: 120000, maxBytes: 16 * 1024 * 1024, gracefulShutdownMs: 2000 });
	if (result.code !== 0) { throw new Error(result.stderr || 'External structural verification failed'); }
	JSON.parse(result.stdout);
	return result.stdout;
}
