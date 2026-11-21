import '../source-loader.mjs';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { openProperties, openDiagramNavigation } from './helpers.ts';

/** Owns the isolated desktop process, fixture directories and failure evidence. */
export async function createSmokeHarness(platform = process.platform) {
	const { validateSemanticModel } = await import('../../../src/vs/workbench/contrib/ordito/common/modelValidation.ts');
	const { checkoutModel } = await import('../../../src/vs/workbench/contrib/ordito/common/checkoutModel.ts');
	const root = fileURLToPath(new URL('../../..', import.meta.url));
	const aiLive = process.argv.includes('--ai-live');
	if (aiLive && !process.env.ORDITO_AI_MODEL) { throw new Error('--ai-live requires ORDITO_AI_MODEL from the authenticated Codex account'); }
	const packaged = process.argv.includes('--packaged');
	const electronOverride = process.env.ORDITO_ELECTRON_PATH;
	if (packaged && !electronOverride) { throw new Error('--packaged requires ORDITO_ELECTRON_PATH pointing to the packaged executable'); }
	const product = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'product.json'), 'utf8'));
	const executablePath = electronOverride ? path.resolve(root, electronOverride) : path.join(root, '.build/electron', platform === 'darwin'
		? `${product.nameLong}.app/Contents/MacOS/${product.nameShort}`
		: platform === 'win32' ? `${product.nameShort}.exe` : product.applicationName);
	// macOS's per-user TMPDIR can exceed the 103-byte Unix socket path limit
	// once Electron appends the portable profile and main IPC handle.
	const directory = await mkdtemp(path.join(platform === 'darwin' ? '/tmp' : tmpdir(), 'ordito-smoke-'));
	const portable = path.join(directory, 'portable');
	const userData = path.join(portable, 'user-data');
	const workspace = path.join(directory, 'project');
	const evidence = path.join(root, '.build/ordito-smoke');
	await mkdir(portable);
	const launchEnv: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, VSCODE_DEV: packaged ? undefined : '1', NODE_ENV: packaged ? undefined : 'development', VSCODE_PORTABLE: portable }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
	if (!aiLive) {
		launchEnv.CODEX_HOME = path.join(directory, 'codex-home');
		launchEnv.CLAUDE_CONFIG_DIR = path.join(directory, 'claude-home');
		await mkdir(launchEnv.CODEX_HOME);
		await mkdir(launchEnv.CLAUDE_CONFIG_DIR);
	}
	await mkdir(path.join(userData, 'User'), { recursive: true });
	await mkdir(workspace);
	await mkdir(evidence, { recursive: true });
	await writeFile(path.join(userData, 'User/settings.json'), JSON.stringify({
		'window.dialogStyle': 'custom',
		'window.menuStyle': 'custom',
		'files.simpleDialog.enable': true,
		'files.autoSave': 'off',
		'ordito.codeUpdates.suggestAfterSave': false,
		'workbench.startupEditor': 'orditoHome',
		'workbench.secondarySideBar.defaultVisibility': 'hidden',
		'window.restoreWindows': 'all',
		'window.openFoldersInNewWindow': 'off',
		'terminal.integrated.gpuAcceleration': 'off',
		'chat.agentHost.codexAgent.enabled': false,
		...(!aiLive ? { 'chat.agentHost.codexAgent.codexHome': launchEnv.CODEX_HOME } : {}),
		'chat.agentHost.claudeAgent.enabled': false,
		'telemetry.telemetryLevel': 'off',
		'update.mode': 'none'
	}));
	const navigationOnly = process.argv.includes('--navigation-only');
	const sequenceOnly = process.argv.includes('--sequence-only');
	const stateOnly = process.argv.includes('--state-only');
	const impactOnly = process.argv.includes('--impact-only');
	const connectionPreviewOnly = process.argv.includes('--connection-preview-only');
	const canvasOnly = process.argv.includes('--canvas-only') || connectionPreviewOnly;
	const notationsOnly = process.argv.includes('--notations-only');
	const semanticOnly = process.argv.includes('--semantic-import');
	const generatedOnly = process.argv.includes('--generated-diagrams');
	const workflowOnly = process.argv.includes('--diagram-workflow');
	const codeOnly = process.argv.includes('--code-only') || workflowOnly;
	const aiOnly = process.argv.includes('--ai-only') || aiLive;
	const extraCleanup: (() => Promise<void> | void)[] = [];
	const projectsOnly = process.argv.includes('--projects-only');
	const modelFile = path.join(navigationOnly || sequenceOnly || stateOnly || impactOnly ? directory : workspace, 'checkout.ordito.json');
	const emptyFile = path.join(workspace, 'empty.ordito.json');
	const invalidFile = path.join(workspace, 'invalid.ordito.json');
	const otherFile = path.join(workspace, 'other.ordito.json');
	if (!projectsOnly) {
		await writeFile(modelFile, JSON.stringify(checkoutModel));
		await writeFile(emptyFile, JSON.stringify({ ...checkoutModel, id: 'empty', name: 'Empty System', semantics: { elements: [], relations: [] }, views: [] }));
		await writeFile(invalidFile, '{"version":99}');
		await writeFile(otherFile, JSON.stringify({ ...checkoutModel, id: 'other', name: 'Other System' }));
	}
	const args = [root, workspace, `--user-data-dir=${userData}`, `--extensions-dir=${directory}/extensions`,
		`--shared-data-dir=${directory}/shared-data`,
		'--disable-workspace-trust', '--disable-telemetry', '--disable-updates', '--disable-experiments',
		'--disable-dev-shm-usage', '--no-sandbox', '--password-store=basic', '--use-inmemory-secretstorage',
		'--disable-extension=vscode.vscode-api-tests'];
	// The development Electron binary needs an app path argument. The release binary already contains the app.
	const getLaunchArgs = () => packaged ? args.slice(1) : args;
	const launchCwd = packaged ? directory : root;
	const uxOnly = process.argv.includes('--ux-only');
	const followupOnly = process.argv.includes('--followup-only');
	if (process.argv.includes('--native-only') || uxOnly || navigationOnly || sequenceOnly || stateOnly || impactOnly || projectsOnly || codeOnly || aiOnly || followupOnly || canvasOnly || semanticOnly || generatedOnly || notationsOnly) {
		// Prove the product shell works independently of built-in extension activation too.
		for (const entry of await readdir(path.join(root, 'extensions'), { withFileTypes: true })) {
			if (!entry.isDirectory()) { continue; }
			const manifest = await readFile(path.join(root, 'extensions', entry.name, 'package.json'), 'utf8').catch(error => {
				if (error.code === 'ENOENT') { return undefined; }
				throw error;
			});
			if (manifest) {
				const extension = JSON.parse(manifest);
				// Theme coverage enables only the declarative built-in themes, which have no executable entry point.
				if ((uxOnly || sequenceOnly || stateOnly || impactOnly) && extension.name === 'theme-defaults') { continue; }
				args.push(`--disable-extension=${extension.publisher ?? 'vscode'}.${extension.name}`);
			}
		}
	}
	let app: ElectronApplication | undefined;
	let electronOutput = '';

	async function launch() {
		app = await electron.launch({ executablePath, args: getLaunchArgs(), cwd: launchCwd, env: launchEnv, timeout: 90000 });
		electronOutput = '';
		app.process().stderr?.on('data', data => { electronOutput = (electronOutput + data.toString()).slice(-12000); });
		await app.firstWindow({ timeout: 90000 });
		const deadline = Date.now() + 90000;
		while (Date.now() < deadline) {
			for (const window of app.windows()) {
				if (await window.locator('.ordito-shell').isVisible().catch(() => false)) {
					window.setDefaultTimeout(30000);
					await window.waitForFunction(() => !document.querySelector('.ordito-content')?.textContent?.includes('Loading model…'));
					await window.waitForFunction(() => performance.getEntriesByName('code/didCreateWorkbenchContribution/3/workbench.contrib.orditoDiagramLayout').length > 0);
					if (!workflowOnly && !canvasOnly && !semanticOnly && !generatedOnly && !notationsOnly) {
						await openProperties(window);
						await openDiagramNavigation(window);
					}
					return window;
				}
			}
			await new Promise(resolve => setTimeout(resolve, 250));
		}
		throw new Error('No restored Specsplice workbench became visible');
	}

	async function reportFailure(error: unknown) {
		console.error(error);
		await cp(workspace, path.join(evidence, `failure-fixture-${path.basename(directory)}`), { recursive: true }).catch(copyError => { console.error('Could not preserve smoke fixture:', copyError.code); });
		if (electronOutput) { console.error(electronOutput); }
		const logRoot = path.join(userData, 'logs');
		for (const file of await readdir(logRoot, { recursive: true }).catch(() => [])) { if (file.endsWith('renderer.log')) { console.error((await readFile(path.join(logRoot, file), 'utf8')).split('\n').filter(line => /\[error\]|^\s+at /.test(line)).join('\n').slice(-12000)); } }
		if (app) {
			for (const [index, window] of app.windows().entries()) {
				console.error(`Workbench focus ${index}: ${JSON.stringify(await window.evaluate(() => ({ focused: document.hasFocus(), activeElement: document.activeElement?.outerHTML.slice(0, 1000), dialogCount: document.querySelectorAll('.monaco-dialog-box').length })).catch(() => undefined))}`);
				const state = await window.locator('.ordito-shell, .quick-input-widget:visible, .notifications-toasts:visible').allInnerTexts().catch(() => []);
				console.error(`Workbench state ${index}: ${state.join('\n').slice(-10000)}`);
				await window.screenshot({ path: path.join(evidence, `failure-${index}.png`) }).catch(() => { });
			}
		}
		throw error;
	}

	async function dispose() {
		try { await app?.close(); } finally {
			await cp(path.join(userData, 'logs'), path.join(evidence, `logs-${path.basename(directory)}`), { recursive: true }).catch(error => { if (error.code !== 'ENOENT') { console.error('Could not preserve smoke logs:', error.code); } });
			await rm(directory, { recursive: true, force: true });
			for (const callback of extraCleanup.reverse()) { await callback(); }
		}
	}

	return { validateSemanticModel, checkoutModel, root, aiLive, product, executablePath, directory, portable, userData, workspace, evidence, launchEnv, launchCwd, getLaunchArgs, navigationOnly, sequenceOnly, stateOnly, impactOnly, canvasOnly, connectionPreviewOnly, notationsOnly, semanticOnly, generatedOnly, workflowOnly, codeOnly, aiOnly, extraCleanup, projectsOnly, modelFile, emptyFile, invalidFile, otherFile, args, uxOnly, followupOnly, launch, reportFailure, dispose, get app(): ElectronApplication { if (!app) { throw new Error('No desktop process is active'); } return app; }, set app(value: ElectronApplication | undefined) { app = value; } };
}

export type SmokeHarness = Awaited<ReturnType<typeof createSmokeHarness>>;
