import assert from 'assert';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../../base/common/path.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { checkCliAccount, cliEnvironment } from '../../node/orditoCliAccount.js';

(isWindows ? suite.skip : suite)('Specsplice original CLI account state', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	let directory: string;
	let executable: string;
	setup(async () => { directory = await fs.mkdtemp(join(tmpdir(), 'ordito account ')); executable = join(directory, 'original codex'); });
	teardown(async () => { await fs.rm(directory, { recursive: true, force: true }); });
	const script = async (body: string) => fs.writeFile(executable, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });

	test('uses the official status command and selected home without returning provider account output', async () => {
		await script(`if (process.argv.slice(2).join(' ') !== 'login status' || process.env.CODEX_HOME !== 'selected-home') process.exit(2); process.stderr.write('Logged in using ChatGPT: private@example.test');`);
		assert.deepStrictEqual(await checkCliAccount({ provider: 'codex', executable, codexHome: 'selected-home' }), { status: 'signedIn', executable });
	});
	test('distinguishes logged-out, missing, unsupported and failed checks without treating them as connected', async () => {
		await script(`process.stderr.write('Not logged in'); process.exit(1);`);
		const signedOut = await checkCliAccount({ provider: 'codex', executable });
		await script(`process.stderr.write('unknown option status'); process.exit(2);`);
		const unsupported = await checkCliAccount({ provider: 'codex', executable });
		await script(`process.stderr.write('Provider output is not recognized');`);
		const failed = await checkCliAccount({ provider: 'codex', executable });
		const missing = await checkCliAccount({ provider: 'codex', executable: join(directory, 'missing') });
		assert.deepStrictEqual([signedOut, unsupported, failed, missing], [{ status: 'signedOut', executable }, { status: 'error', executable, reason: 'unsupported' }, { status: 'error', executable, reason: 'failed' }, { status: 'unavailable', reason: 'notFound' }]);
	});
	test('Claude uses structured authentication status', async () => {
		await script(`process.stdout.write(JSON.stringify({ loggedIn: true, email: 'private@example.test' }));`);
		assert.deepStrictEqual(await checkCliAccount({ provider: 'claude', executable }), { status: 'signedIn', executable });
	});
	test('an unresponsive status command has a bounded timeout', async function () {
		this.timeout(12000);
		await script('setInterval(() => {}, 1000);');
		assert.deepStrictEqual(await checkCliAccount({ provider: 'codex', executable }), { status: 'error', executable, reason: 'timeout' });
	});
	test('runtime selectors preserve inherited environment without mutating the worker', () => {
		const previous = process.env.CODEX_HOME;
		const environment = cliEnvironment({ path: '/selected/bin', codexHome: '/selected/home' });
		assert.deepStrictEqual({ path: environment.PATH, home: environment.CODEX_HOME, inherited: process.env.CODEX_HOME }, { path: '/selected/bin', home: '/selected/home', inherited: previous });
	});
});
