import assert from 'assert';
import sinon from 'sinon';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IInputOptions, IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { checkoutModel } from '../../common/checkoutModel.js';
import { editOrditoBehavior } from '../../browser/orditoBehaviorEditing.js';

class ContractInput extends mock<IQuickInputService>() {
	override pick = sinon.stub().resolves(undefined);
	override input = sinon.stub().resolves(undefined);
}

suite('Specsplice behavioral contract dialogs', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('cancelling at each field step never commits a partial contract', async () => {
		const before = structuredClone(checkoutModel);
		const element = checkoutModel.semantics.elements.find(element => element.id === 'payment-contract')!;
		for (let step = 0; step < 5; step++) {
			const quick = new ContractInput();
			if (step > 0) { quick.pick.onCall(0).resolves({ label: 'Inputs', key: 'inputs' }); }
			if (step > 1) { quick.pick.onCall(1).resolves({ label: 'Add Entry', index: -1 }); }
			if (step > 2) { quick.input.onCall(0).resolves('amount'); }
			if (step > 3) { quick.input.onCall(1).resolves('Money'); }
			assert.strictEqual(await editOrditoBehavior(quick, checkoutModel, element), undefined);
		}
		assert.deepStrictEqual(checkoutModel, before);
	});

	test('editing a field keeps untouched contract sections and does not alias the original', async () => {
		const element = checkoutModel.semantics.elements.find(element => element.id === 'checkout-controller')!;
		const before = structuredClone(element.behavior);
		const quick = new ContractInput();
		quick.pick.onCall(0).resolves({ label: 'Outputs', key: 'outputs' });
		quick.pick.onCall(1).resolves({ label: 'orderId', index: 0 });
		quick.pick.onCall(2).resolves({ label: 'Edit Entry', remove: false });
		quick.pick.onCall(3).resolves({ label: 'Optional', required: false });
		quick.input.onCall(0).resolves(' orderId ');
		quick.input.onCall(1).resolves(' OrderReference ');
		const result = await editOrditoBehavior(quick, checkoutModel, element);
		assert.deepStrictEqual({ original: element.behavior, result }, { original: before, result: { ...before, outputs: [{ name: 'orderId', type: 'OrderReference', required: false }] } });
	});

	test('referenced errors cannot be removed through the dialog', async () => {
		const quick = new ContractInput();
		quick.pick.onCall(0).resolves({ label: 'Errors', key: 'errors' });
		quick.pick.onCall(1).resolves({ label: 'payment-declined', index: 0 });
		quick.pick.onCall(2).resolves({ label: 'Remove Entry', remove: true });
		const before = structuredClone(checkoutModel);
		await assert.rejects(editOrditoBehavior(quick, checkoutModel, checkoutModel.semantics.elements.find(element => element.id === 'checkout-controller')!), /used by a relationship/);
		assert.deepStrictEqual(checkoutModel, before);
	});

	test('field validation rejects whitespace and duplicates before collecting the remaining inputs', async () => {
		const quick = new ContractInput();
		quick.pick.onCall(0).resolves({ label: 'Inputs', key: 'inputs' });
		quick.pick.onCall(1).resolves({ label: 'Add Entry', index: -1 });
		quick.input.callsFake(async (options: IInputOptions) => {
			assert.deepStrictEqual([!!await options.validateInput!(' '), !!await options.validateInput!('cartId'), await options.validateInput!('currency')], [true, true, undefined]);
			return undefined;
		});
		assert.strictEqual(await editOrditoBehavior(quick, checkoutModel, checkoutModel.semantics.elements.find(element => element.id === 'checkout-controller')!), undefined);
		assert.strictEqual(quick.input.callCount, 1);
	});
});
