import assert from 'assert';
import { mock } from '../../../../../base/test/common/mock.js';
import { renderMarkdown } from '../../../../../base/browser/markdownRenderer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IDialogService, type IPrompt, type IPromptResult } from '../../../../../platform/dialogs/common/dialogs.js';
import { confirmOrditoDeletion, deletionDetails, deletionSummary } from '../../browser/orditoDeletionDialog.js';
import { checkoutModel } from '../../common/checkoutModel.js';
import { getDeletionPreview } from '../../common/deletionPreview.js';

suite('Specsplice deletion confirmation', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const preview = () => getDeletionPreview(checkoutModel, 'customer');

	function dialogs(choices: (number | undefined)[], changed?: () => void) {
		const shown: string[] = [];
		const service = Object.assign(new (mock<IDialogService>())(), {
			prompt: async <T>(prompt: IPrompt<T>): Promise<IPromptResult<T>> => {
				shown.push(prompt.message);
				const choice = choices.shift();
				if (choice === 1) { changed?.(); }
				return { result: choice === undefined ? undefined : await prompt.buttons?.[choice]?.run({}) };
			},
			info: async (message: string) => { shown.push(message); }
		});
		return { service, shown };
	}

	test('opening details and returning requires a fresh explicit delete choice', async () => {
		const f = dialogs([0, undefined, 1]);
		const confirmed = await confirmOrditoDeletion(f.service, 'Customer', preview(), () => true);
		assert.deepStrictEqual({ confirmed, dialogs: f.shown }, { confirmed: true, dialogs: ['Delete Customer from the System?', 'Deletion Details · Customer', 'Delete Customer from the System?'] });
	});

	test('cancel after reading details never authorizes deletion', async () => {
		const f = dialogs([0, undefined, undefined]);
		assert.equal(await confirmOrditoDeletion(f.service, 'Customer', preview(), () => true), false);
	});

	test('a revision change invalidates even an explicit delete choice', async () => {
		let current = true;
		const f = dialogs([1], () => { current = false; });
		assert.deepStrictEqual({ confirmed: await confirmOrditoDeletion(f.service, 'Customer', preview(), () => current), notice: f.shown.at(-1)?.includes('Nothing was deleted') }, { confirmed: false, notice: true });
	});

	test('summary distinguishes updated diagrams and details include surviving permissions owners and stable references', () => {
		const data = preview();
		const summary = store.add(renderMarkdown(deletionSummary(data))).element.textContent!.replace(/\u00a0/g, ' ');
		const details = store.add(renderMarkdown(deletionDetails(data))).element.textContent!.replace(/\u00a0/g, ' ');
		assert.deepStrictEqual({ counts: summary.includes('Diagrams to delete: 0 · Diagrams to update: 2'), sourceFiles: summary.includes('Source files are kept'), updatedOwner: details.includes('Confirm Order') && details.includes('Updated · checkout-controller'), authorization: details.includes('purchase:own') && details.includes('Actor: Customer') }, { counts: true, sourceFiles: true, updatedOwner: true, authorization: true });
	});
});
