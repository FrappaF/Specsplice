import assert from 'assert';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../../base/common/path.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { resolveCliExecutable } from '../../node/orditoCliExecutable.js';

suite('Specsplice CLI executable lookup', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	let directory: string;
	let executable: string;
	setup(async () => {
		directory = await fs.mkdtemp(join(tmpdir(), 'ordito cli '));
		executable = join(directory, isWindows ? 'codex.CMD' : 'codex');
		await fs.writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
	});
	teardown(async () => { await fs.rm(directory, { recursive: true, force: true }); });
	test('finds CLI names on the supplied shell PATH and accepts absolute paths containing spaces', async () => {
		assert.deepStrictEqual(await Promise.all([
			resolveCliExecutable({ executable: 'codex', path: directory, pathExt: '.CMD' }),
			resolveCliExecutable({ executable, path: '' })
		]), [executable, executable]);
	});
	test('missing commands and directories are not reported as available CLIs', async () => {
		assert.deepStrictEqual(await Promise.all([
			resolveCliExecutable({ executable: 'ordito-cli-does-not-exist', path: directory }),
			resolveCliExecutable({ executable: directory })
		]), [undefined, undefined]);
	});
	(isWindows ? test.skip : test)('a non-executable file is rejected', async () => {
		await fs.chmod(executable, 0o644);
		assert.strictEqual(await resolveCliExecutable({ executable }), undefined);
	});
	test('invalid executable lookups are rejected', async () => {
		await assert.rejects(resolveCliExecutable({ executable: '' }), /Invalid CLI/);
		await assert.rejects(resolveCliExecutable({ executable: 'codex\0invalid' }), /Invalid CLI/);
	});
});
