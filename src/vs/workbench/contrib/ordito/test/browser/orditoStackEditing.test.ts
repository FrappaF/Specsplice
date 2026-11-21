import assert from 'assert';
import { ScriptedDialogs } from './orditoBlueprintEditing.test.js';
import { editOrditoStack } from '../../browser/orditoStackEditing.js';
import { blueprintPlatformLabels } from '../../browser/orditoBlueprintContent.js';
import { createPureProject } from '../../common/modelProject.js';
import { applyVisualEdit } from '../../common/visualEditing.js';
import { modelProjectProfile } from '../../common/modelProfiles.js';
import { type SemanticModelV4 } from '../../common/modelTypes.js';

suite('Specsplice second runtime editing', () => {
	function fixture() { let id = 0; return createPureProject('Quantity', () => 'native.' + ++id).model; }
	async function edit(model: SemanticModelV4, answers: (string | undefined)[]) {
		const before = structuredClone(model), dialogs = new ScriptedDialogs(answers), edits = await editOrditoStack(dialogs, model, { confirm: async confirmation => {
			const detail = typeof confirmation.detail === 'string' ? confirmation.detail : confirmation.detail?.value;
			for (const section of ['Implementation', 'Dependencies', 'Storage and Data', 'Tests', 'Deployment', 'Recovery']) { assert.ok(detail?.includes(section), section); }
			assert.ok(detail?.includes('unchanged independent business criteria'));
			return { confirmed: !!await dialogs.pick([{ label: 'Change Runtime Bindings' }]) };
		} }); dialogs.assertComplete(); assert.deepStrictEqual(model, before);
		return edits?.reduce((current, edit) => applyVisualEdit(current, edit) as SemanticModelV4, model);
	}
	test('runtime plan changes only the existing PSM bindings and is reversible', async () => {
		const model = fixture(), bun = (await edit(model, ['Bun ESM 1.3.2', 'Change Runtime Bindings']))!; assert.strictEqual(modelProjectProfile(bun).profile.id, 'bun.esm');
		assert.deepStrictEqual(await edit(bun, ['Node ESM 24.22.1', 'Change Runtime Bindings']), model);
	});
	test('cancel at runtime selection or plan preserves the document', async () => {
		assert.strictEqual(await edit(fixture(), [undefined]), undefined); assert.strictEqual(await edit(fixture(), ['Bun ESM 1.3.2', undefined]), undefined);
	});
	test('same runtime is a no-op; draft gets an explicit first binding', async () => {
		const model = fixture(); assert.deepStrictEqual(await edit(model, ['Node ESM 24.22.1']), model); model.foundation.platform.bindings = [];
		const bun = (await edit(model, ['Bun ESM 1.3.2', 'Domain']))!; assert.strictEqual(modelProjectProfile(bun).profile.id, 'bun.esm');
	});
	test('L2 and accessible shared labels show resolved runtime and version', async () => {
		const bun = (await edit(fixture(), ['Bun ESM 1.3.2', 'Change Runtime Bindings']))!, binding = bun.foundation.platform.bindings[0]; assert.deepStrictEqual(blueprintPlatformLabels(bun, binding.elementId), ['Technology: Bun 1.3.2 · ECMAScript Modules · Framework: None']);
	});
});
