/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { OPTIONS, parseArgs } from '../../node/argv.js';
import { getUserDataPath } from '../../node/userDataPath.js';
import product from '../../../product/common/product.js';

suite('User data path', () => {

	test('getUserDataPath - default', () => {
		const path = getUserDataPath(parseArgs(process.argv, OPTIONS), product.nameShort);
		assert.ok(path.length > 0);
	});

	test('getUserDataPath - portable mode', () => {
		const origPortable = process.env['VSCODE_PORTABLE'];
		try {
			const portableDir = 'portable-dir';
			process.env['VSCODE_PORTABLE'] = portableDir;

			const path = getUserDataPath(parseArgs(process.argv, OPTIONS), product.nameShort);
			assert.ok(path.includes(portableDir));
		} finally {
			if (typeof origPortable === 'string') {
				process.env['VSCODE_PORTABLE'] = origPortable;
			} else {
				delete process.env['VSCODE_PORTABLE'];
			}
		}
	});

	test('getUserDataPath - --user-data-dir', () => {
		const cliUserDataDir = 'cli-data-dir';
		const args = parseArgs(process.argv, OPTIONS);
		args['user-data-dir'] = cliUserDataDir;

		const path = getUserDataPath(args, product.nameShort);
		assert.ok(path.includes(cliUserDataDir));
	});

	test('getUserDataPath - VSCODE_APPDATA', () => {
		const origAppData = process.env['VSCODE_APPDATA'];
		try {
			const appDataDir = 'appdata-dir';
			process.env['VSCODE_APPDATA'] = appDataDir;

			const path = getUserDataPath(parseArgs(process.argv, OPTIONS), product.nameShort);
			assert.ok(path.includes(appDataDir));
		} finally {
			if (typeof origAppData === 'string') {
				process.env['VSCODE_APPDATA'] = origAppData;
			} else {
				delete process.env['VSCODE_APPDATA'];
			}
		}
	});

	test('getUserDataPath - prefers the current profile and then each previous name in order', () => {
		const environment = { appData: process.env['VSCODE_APPDATA'], dev: process.env['VSCODE_DEV'], portable: process.env['VSCODE_PORTABLE'] };
		const appData = mkdtempSync(join(tmpdir(), 'specsplice-user-data-'));
		try {
			process.env['VSCODE_APPDATA'] = appData;
			delete process.env['VSCODE_DEV'];
			delete process.env['VSCODE_PORTABLE'];
			const current = join(appData, 'Specsplice');
			const previous = join(appData, 'Ordito');
			const oldest = join(appData, 'A.D.E');
			const legacyNames = ['Ordito', 'A.D.E'];
			const args = parseArgs(process.argv, OPTIONS);
			assert.strictEqual(getUserDataPath(args, 'Specsplice', legacyNames), current);
			mkdirSync(oldest);
			assert.strictEqual(getUserDataPath(args, 'Specsplice', legacyNames), oldest);
			assert.strictEqual(getUserDataPath(args, 'Specsplice', 'A.D.E'), oldest);
			mkdirSync(previous);
			assert.strictEqual(getUserDataPath(args, 'Specsplice', legacyNames), previous);
			mkdirSync(current);
			assert.strictEqual(getUserDataPath(args, 'Specsplice', legacyNames), current);

			const explicit = join(appData, 'explicit-profile');
			args['user-data-dir'] = explicit;
			assert.strictEqual(getUserDataPath(args, 'Specsplice', legacyNames), current);
			process.env['VSCODE_PORTABLE'] = join(appData, 'portable');
			assert.strictEqual(getUserDataPath(args, 'Specsplice', legacyNames), join(appData, 'portable', 'user-data'));
			delete process.env['VSCODE_PORTABLE'];
			delete process.env['VSCODE_APPDATA'];
			assert.strictEqual(getUserDataPath(args, 'Specsplice', legacyNames), explicit);
		} finally {
			for (const [key, value] of Object.entries({ VSCODE_APPDATA: environment.appData, VSCODE_DEV: environment.dev, VSCODE_PORTABLE: environment.portable })) {
				if (value === undefined) {
					delete process.env[key];
				} else {
					process.env[key] = value;
				}
			}
			rmSync(appData, { recursive: true, force: true });
		}
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
