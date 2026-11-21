import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const [target, destination] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(target || '') || !destination || !path.isAbsolute(destination)) {
	throw new Error('Usage: node ordito/scripts/prepare-upstream.mjs <full-commit-sha> <absolute-new-worktree-path>');
}
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
if (git('status', '--porcelain').trim()) {
	throw new Error('Commit or stash changes before preparing an upstream update.');
}
const metadata = JSON.parse(readFileSync(path.join(root, 'ordito/upstream.json'), 'utf8'));
for (const revision of [metadata.commit, target]) {
	if (!/^[a-f0-9]{40}$/.test(revision)) { throw new Error('Invalid upstream revision.'); }
	git('fetch', '--depth=1', metadata.repository, revision);
}
const changes = git('diff', '--name-only', metadata.commit, target).trim().split('\n').filter(Boolean);
if (changes.some(file => file.startsWith('.github/workflows/'))) {
	throw new Error('Upstream workflows changed. Reconcile them into ordito/upstream-workflows/*.disabled before applying this update; do not activate Microsoft workflows.');
}
const branch = `ordito/upstream-${target.slice(0, 12)}`;
git('worktree', 'add', '-b', branch, '--', destination, 'HEAD');
const patch = git('diff', '--binary', metadata.commit, target);
const result = spawnSync('git', ['apply', '--3way', '--index', '-'], {
	cwd: destination, input: patch, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024
});
const report = { base: metadata.commit, target, branch, worktree: destination, changes,
	status: result.status === 0 ? 'applied-awaiting-build-and-smoke' : 'conflicts',
	diagnostics: `${result.stdout || ''}${result.stderr || ''}` };
writeFileSync(path.join(destination, 'ordito/upstream-trial.json'), JSON.stringify(report, null, '\t') + '\n');
if (result.status === 0) {
	writeFileSync(path.join(destination, 'ordito/upstream.json'), JSON.stringify({ ...metadata,
		commit: target, importedOn: new Date().toISOString().slice(0, 10), method: 'upstream delta applied to Specsplice snapshot'
	}, null, '  ') + '\n');
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = result.status === 0 ? 0 : 1;
