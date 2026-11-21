import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OrditoControls } from '../../browser/orditoControls.js';
import { renderModelTaskPreview } from '../../browser/orditoTaskPreview.js';
import { renderBlueprintDetails } from '../../browser/orditoBlueprintDetails.js';
import { describeBlueprint } from '../../browser/orditoBlueprintContent.js';
import { compileModelTaskContext } from '../../common/modelTaskContext.js';
import { nodeOrdersFixture } from '../common/nodeOrdersFixture.js';

suite('Specsplice structural context renderer', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	setup(() => { root = dom.append(document.body, dom.$('section')); });
	teardown(() => root.remove());
	test('exact packet is a focusable native disclosure with explicit unavailable cost and zero inference', async () => {
		const packet = await compileModelTaskContext(nodeOrdersFixture, { version: 1, target: { kind: 'operation', id: 'operation.submit' }, mode: 'analysis', profileId: 'node.esm', intent: { revision: '1', text: 'Inspect predicate', clarifications: [] }, provider: { id: 'preview', model: 'none', configurationRevision: '1' }, baselineRevision: '1', delta: [], writeScope: { objects: [], files: [], createOperationsUnder: [] }, retrievalScope: { objects: [], files: [] }, sources: [], budget: { maxInputBytes: 196608, maxContextBytes: 262144, outputReserveBytes: 65536, overheadReserveBytes: 0 } });
		renderModelTaskPreview(root, packet, disposables.add(new OrditoControls()));
		const disclosures = root.querySelectorAll('details'); for (const disclosure of disclosures) { disclosure.open = true; }
		const pre = root.querySelector('pre')!; pre.focus();
		assert.deepStrictEqual([document.activeElement === pre, JSON.parse(pre.textContent!).writeScope.files, root.textContent?.includes('Price unavailable'), root.textContent?.includes('No inference started')], [true, [], true, true]);
	});
	test('predicate rendering and accessible reading derive the same authored expression without mutation', () => {
		const before = structuredClone(nodeOrdersFixture);
		renderBlueprintDetails(root, nodeOrdersFixture, 'component.checkout', disposables.add(new OrditoControls()), () => { }, () => { });
		assert.deepStrictEqual([root.textContent?.includes('(quantity > 0)'), describeBlueprint(nodeOrdersFixture, 'component.checkout').some(line => line.includes('(quantity > 0)')), nodeOrdersFixture], [true, true, before]);
		renderBlueprintDetails(root, nodeOrdersFixture, 'container.domain', disposables.add(new OrditoControls()), () => { }, () => { });
		assert.ok(root.textContent?.includes('Node 24.22.1'));
		assert.ok(describeBlueprint(nodeOrdersFixture, 'container.domain').some(line => line.includes('Framework: None')));
	});
	test('source descriptions are text and cannot introduce markup or actions', () => {
		const model = structuredClone(nodeOrdersFixture); model.semantics.elements.find(element => element.id === 'component.checkout')!.description = '<img src=x onerror="window.injected=true">';
		renderBlueprintDetails(root, model, 'component.checkout', disposables.add(new OrditoControls()), () => { }, () => { });
		assert.strictEqual(root.querySelector('img'), null);
	});
});
