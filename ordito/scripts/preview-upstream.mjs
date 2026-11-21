import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const [repository, target, destination] = process.argv.slice(2);
const base = JSON.parse(await readFile(new URL('../upstream.json', import.meta.url), 'utf8')).commit;
if (!repository || !/^[a-f0-9]{40}$/.test(target ?? '') || !destination) {
	console.error('Usage: node ordito/scripts/preview-upstream.mjs UPSTREAM_REPOSITORY TARGET_SHA PATCH_OUTPUT');
	process.exitCode = 1;
} else {
	try {
		const git = async args => (await run('git', ['-C', repository, ...args], { maxBuffer: 64 * 1024 * 1024 })).stdout;
		await git(['cat-file', '-e', `${base}^{commit}`]);
		await git(['cat-file', '-e', `${target}^{commit}`]);
		console.log(`Specsplice upstream: ${base} -> ${target}`);
		console.log(await git(['diff', '--stat', base, target]));
		const patch = await git(['diff', '--binary', '--full-index', base, target]);
		await writeFile(destination, patch, { flag: 'wx' });
		if (patch) {
			// Check only. Applying and committing belong to an isolated update branch.
			await run('git', ['-C', root, 'apply', '--check', destination]);
		}
		console.log('Patch check passed. No tracked files or upstream metadata were changed.');
	} catch (error) {
		console.error(error.stderr || error.message);
		process.exitCode = 1;
	}
}
