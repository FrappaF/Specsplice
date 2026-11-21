import assert from 'assert';
import { blueprintFixture } from '../common/blueprintFixture.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { describeOrditoDiagram, describeOrditoHelp, OrditoReadingState } from '../../browser/orditoAccessibleContent.js';
import { diagnosticMessage, isOrditoDiagramBlockingDiagnostic } from '../../browser/orditoDiagnostics.js';
import { checkoutModel } from '../../common/checkoutModel.js';
import { validateSemanticModel } from '../../common/modelValidation.js';

suite('Specsplice accessible content', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	function state(overrides: Partial<OrditoReadingState> = {}): OrditoReadingState {
		return { model: checkoutModel, activeView: checkoutModel.views[1], selectedId: 'declined', section: 'diagram',
			loading: false, error: undefined, saveError: undefined, dirty: false, editable: false, diagnostics: [], ...overrides };
	}

	test('shared blueprint contracts and applicable decision reasons remain available to Read Element', async () => {
		const model = structuredClone(blueprintFixture);
		const content = describeOrditoDiagram(state({ model, section: 'element', activeView: undefined, selectedId: 'contract.checkout' }));
		assert.deepStrictEqual(['confirmOrder', 'Input · order: Order · Required · Non-null', 'OUT_OF_STOCK', 'Contract members are shared by identity', 'Use the declared protocol for stock requests'].map(value => content.includes(value)), [true, true, true, true, true]);
	});

	test('reads diagram identities, both payment outcomes and the current selection without inferring execution', () => {
		const content = describeOrditoDiagram(state());
		for (const expected of ['Diagram: Payment Outcome', 'Feature: Confirm Purchase', 'Elements in This Diagram: 4', 'Relationships in This Diagram: 2',
			'Condition: payment authorized', 'Condition: payment not authorized', 'Selected Element: Payment Declined', 'Read-only', 'not execution results']) {
			assert.ok(content.includes(expected), expected);
		}
		assert.ok(!content.includes('reads cart'));
	});

	test('a draft with a required interface awaiting its provider still reads its diagram and every diagnostic', () => {
		const model = structuredClone(blueprintFixture);
		model.foundation.blueprint!.connections = [];
		const diagnostics = validateSemanticModel(model);
		const messages = diagnostics.map(diagnostic => diagnosticMessage(diagnostic, model));
		const content = describeOrditoDiagram(state({ model, activeView: model.views.find(view => view.id === 'c4.l3'), selectedId: 'component.checkout', editable: true,
			hasStructuralErrors: diagnostics.some(diagnostic => diagnostic.severity === 'error'), hasDiagramErrors: diagnostics.some(isOrditoDiagramBlockingDiagnostic), diagnostics: messages }));
		assert.deepStrictEqual({ missingProvider: diagnostics.some(diagnostic => diagnostic.args[1] === 'requiredInterfaceUnsatisfied'), diagram: content.includes('Diagram: API Components'), selected: content.includes('Selected Element: Checkout'), repair: content.includes('Interface Connection'), diagnostics: messages.every(message => content.includes(message)), blocked: content.includes('before using its diagrams') },
			{ missingProvider: true, diagram: true, selected: true, repair: true, diagnostics: true, blocked: false });
	});

	test('diagram errors keep every diagnostic available without reading an unavailable diagram', () => {
		const diagnostics = ['Missing endpoint', 'Invalid parent'];
		const content = describeOrditoDiagram(state({ hasStructuralErrors: true, hasDiagramErrors: true, diagnostics }));
		assert.deepStrictEqual({ blocked: content.includes('before using its diagrams'), diagnostics: diagnostics.every(message => content.includes(message)), stale: content.includes('Diagram: Payment Outcome') },
			{ blocked: true, diagnostics: true, stale: false });
	});

	test('distinguishes additional relationships of a shared selection from relationships drawn in the view', () => {
		const content = describeOrditoDiagram(state({ selectedId: 'payment' }));
		assert.match(content, /Other Relationships of the Selected Element, Not Shown in This Diagram:/);
		assert.match(content, /Confirm Order to Request Payment/);
		assert.match(content, /Relationships in This Diagram: 2/);
	});

	test('loading, invalid documents and Home never expose the previous diagram as current', () => {
		const reading = [describeOrditoDiagram(state({ loading: true })), describeOrditoDiagram(state({ error: 'Invalid document' })), describeOrditoDiagram(state({ section: 'home' }))];
		assert.deepStrictEqual(reading.map(content => ({ stale: content.includes('Payment Outcome'), selected: content.includes('Selected Element:') })),
			[{ stale: false, selected: false }, { stale: false, selected: false }, { stale: false, selected: false }]);
		assert.ok(reading[1].includes('Invalid document'));
	});

	test('a source index reads as evidence awaiting AI interpretation, not as completed diagrams', () => {
		const model = structuredClone(checkoutModel);
		model.id = 'code:pending';
		model.semantics.elements = [{ id: 'bootstrap', kind: 'component', name: 'config/application.rb' }];
		model.semantics.relations = [];
		const content = describeOrditoDiagram(state({ model, section: 'map' }));
		assert.ok(content.includes('Build Diagrams with AI'));
		assert.ok(!content.includes('config/application.rb') && !content.includes('System Map.'));
	});

	test('empty feature diagrams keep their owner and reading never mutates the model', () => {
		const model = structuredClone(checkoutModel);
		model.version = 3;
		const view = { id: 'empty', featureId: 'purchase', name: 'Empty Flow', kind: 'activity' as const, nodes: [], relationIds: [] };
		model.views.push(view);
		const before = JSON.stringify(model);
		const content = describeOrditoDiagram(state({ model, activeView: view, editable: true, selectedId: 'declined' }));
		assert.deepStrictEqual({ owner: content.includes('Feature: Confirm Purchase'), empty: content.includes('This diagram has no elements.'), staleSelection: content.includes('Selected Element:'), unchanged: JSON.stringify(model) === before },
			{ owner: true, empty: true, staleSelection: false, unchanged: true });
	});

	test('selected behavior, source evidence and save errors reflect the supplied document', () => {
		const model = structuredClone(checkoutModel);
		model.codeMappings.push({ id: 'mapping', elementId: 'checkout-controller', file: 'src/checkout.ts', symbol: 'confirm', revision: 'test-revision' });
		model.verifications.push({ id: 'verification', elementId: 'checkout-controller', criterionId: model.semantics.elements.find(element => element.id === 'checkout-controller')!.behavior!.acceptanceCriteria[0].id, outcome: 'unknown', evidence: 'Declared test fixture', revision: 'test-revision' });
		const content = describeOrditoDiagram(state({ model, activeView: model.views[0], selectedId: 'checkout-controller', editable: true, dirty: true, saveError: 'Save conflict', diagnostics: ['Legacy classification warning'] }));
		for (const expected of ['Input: cartId (CartId), Required', 'Output: orderId (OrderId), Required', 'Authorization: Customer, purchase:own-cart', 'Code mappings: 1. Verification records: 1.', 'Unsaved Changes', 'Save conflict', 'Legacy classification warning']) {
			assert.ok(content.includes(expected), expected);
		}
	});

	test('element details read unplaced contracts without inventing a diagram', () => {
		const content = describeOrditoDiagram(state({ section: 'element', selectedId: 'payment-contract' }));
		assert.deepStrictEqual({ details: content.includes('Element Details: Payment'), unplaced: content.includes('not placed in a diagram'), related: content.includes('Related Relationships: 2'), staleDiagram: content.includes('Diagram: Payment Outcome') },
			{ details: true, unplaced: true, related: true, staleDiagram: false });
	});

	test('sequence reading preserves participant and message order and identifies unsupported relationships', () => {
		const model = structuredClone(checkoutModel);
		const view = { id: 'sequence', name: 'Purchase Sequence', kind: 'sequence' as const, nodes: [...model.views[0].nodes].reverse(), relationIds: ['show-declined', 'checkout-confirm', 'confirm-order'] };
		model.views.push(view);
		const content = describeOrditoDiagram(state({ model, activeView: view, selectedId: 'checkout-controller' }));
		assert.deepStrictEqual({ declared: content.includes('not observed execution'), firstParticipant: content.includes('1. Order (Resource)'), orderedMessages: content.indexOf('shows error') < content.indexOf('submits'), condition: content.includes('Condition: payment succeeds'), error: content.includes('Error: payment-declined'), contract: content.includes('Input: cartId (CartId), Required') },
			{ declared: true, firstParticipant: true, orderedMessages: true, condition: true, error: true, contract: true });
		view.relationIds.push('confirm-feature');
		view.nodes.push({ elementId: 'purchase', x: 0, y: 0 });
		assert.ok(describeOrditoDiagram(state({ model, activeView: view })).includes('Not Rendered as a Sequence Message:'));
	});

	test('state reading names resource ownership and events while preserving historical context', () => {
		const content = describeOrditoDiagram(state());
		assert.deepStrictEqual({ resource: content.includes('Resource: Order. Visible states: 3 of 3. Visible transitions: 2.'), ownership: content.includes('State Pending belongs to resource Order.'), context: content.includes('Additional context: 1 elements and 0 relationships'), event: content.includes('Transition Event: payment succeeds'), guard: content.includes('Condition: payment authorized'), intent: content.includes('no initial or final state is inferred') },
			{ resource: true, ownership: true, context: true, event: true, guard: true, intent: true });
	});

	test('impact reading explains reverse reasons and recorded revisions without stale diagrams or current verification claims', () => {
		const model = structuredClone(checkoutModel);
		model.codeMappings.push({ id: 'fixture-mapping', elementId: 'checkout-controller', file: 'fixture.ts', symbol: 'confirm', revision: 'fixture-rev-1' });
		model.verifications.push({ id: 'fixture-passed', elementId: 'checkout-controller', criterionId: 'purchase-success', outcome: 'passed', evidence: 'fixture-result', revision: 'fixture-rev-1' },
			{ id: 'fixture-failed', elementId: 'checkout-controller', criterionId: 'purchase-success', outcome: 'failed', evidence: 'fixture-other-result', revision: 'fixture-rev-2' });
		const content = describeOrditoDiagram(state({ model, section: 'impact', selectedId: 'payment-contract' }));
		assert.deepStrictEqual({ impact: content.includes('Change Impact: Payment'), reason: content.includes('Realization to Payment'), revision: content.includes('Revision: fixture-rev-2'), failed: content.includes('Recorded Failed'), passed: content.includes('Recorded Passed'), mixed: content.includes('Different Outcomes Recorded'), missing: content.includes('No Records for Criterion purchase-declined'), limits: content.includes('do not establish the current implementation'), stale: content.includes('Diagram: Payment Outcome') },
			{ impact: true, reason: true, revision: true, failed: true, passed: true, mixed: true, missing: true, limits: true, stale: false });
		assert.ok(!describeOrditoDiagram(state({ model, section: 'impact', selectedId: 'payment-contract', loading: true })).includes('Potential Dependents'));
	});

	test('help distinguishes read-only navigation from editing and uses resolvable command keybindings', () => {
		const readOnly = describeOrditoHelp(state());
		const editable = describeOrditoHelp(state({ editable: true }));
		assert.deepStrictEqual({ readOnly: readOnly.includes('Editing is unavailable'), movable: readOnly.includes('Arrow keys move the focused element'), editable: editable.includes('Arrow keys move the focused element'), nativeSave: editable.includes('<keybinding:workbench.action.files.save>'), nativeReading: editable.includes('<keybinding:editor.action.accessibleView>') },
			{ readOnly: true, movable: false, editable: true, nativeSave: true, nativeReading: true });
	});

	test('system map reads hierarchy, unplaced elements and all relationship conditions without a stale diagram', () => {
		const content = describeOrditoDiagram(state({ section: 'map' }));
		assert.deepStrictEqual({ map: content.includes('System Map.'), hierarchy: content.includes('parent: Confirm Purchase'), contract: content.includes('Payment (Contract)'), condition: content.includes('Condition: payment not authorized'), stale: content.includes('Selected Element:') || content.includes('Diagram: Payment Outcome') },
			{ map: true, hierarchy: true, contract: true, condition: true, stale: false });
		assert.ok(!describeOrditoDiagram(state({ section: 'map', loading: true })).includes('Group:'));
	});
});
