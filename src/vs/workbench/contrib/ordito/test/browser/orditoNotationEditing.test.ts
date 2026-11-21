import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { editOrditoElementNotation, editOrditoRelationNotation } from '../../browser/orditoNotationEditing.js';
import { type SemanticElement, type SemanticRelation } from '../../common/modelTypes.js';

suite('Specsplice notation forms', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	let parent: HTMLElement;
	let element: SemanticElement;
	setup(() => {
		parent = document.body.appendChild(document.createElement('div'));
		element = { id: 'entity.customer', kind: 'entity', name: 'Customer', details: { technology: 'TypeScript', environment: 'Server', members: [
			{ id: 'field.customerId', typeId: 'type.string', name: 'customerId', type: 'string', kind: 'attribute', key: 'primary', required: true, nullable: { state: 'known', value: false } }
		] } };
	});
	teardown(() => parent.remove());
	const button = (label: string) => {
		const button = [...parent.querySelectorAll('button')].find(button => button.textContent === label); assert.ok(button); button.click();
	};
	const field = (label: string, root: Element = parent) => {
		const field = [...root.querySelectorAll('label')].find(field => field.querySelector('span')?.textContent === label)?.querySelector<HTMLInputElement>('input, select, textarea');
		assert.ok(field, `Missing field: ${label}`); return field;
	};
	const submit = () => parent.querySelector('form')!.requestSubmit();

	test('edits technology and multiple members atomically while preserving field identity', async () => {
		const before = structuredClone(element);
		const result = editOrditoElementNotation(parent, element, 4);
		field('Technology').value = 'PostgreSQL';
		button('Add Attribute');
		const card = parent.querySelectorAll('fieldset')[1];
		field('Member Name', card).value = 'email'; field('Type or Method Signature', card).value = 'string';
		field('Required Field', card).checked = false; field('Nullability (Independent of Presence)', card).value = 'false';
		assert.deepStrictEqual(element, before);
		submit(); const details = await result;
		assert.deepStrictEqual(details, { technology: 'PostgreSQL', environment: 'Server', members: [
			before.details!.members[0], { name: 'email', type: 'string', kind: 'attribute', key: 'none', required: false, nullable: { state: 'known', value: false } }
		] });
		assert.deepStrictEqual(element, before);
	});

	test('duplicate names validate after trimming, and removing a row clears its validation', async () => {
		const result = editOrditoElementNotation(parent, element, 4);
		button('Add Attribute');
		const card = parent.querySelectorAll('fieldset')[1];
		field('Member Name', card).value = ' customerId ';
		submit();
		assert.ok(parent.querySelector('[aria-invalid="true"]'));
		card.querySelector('button')!.click();
		submit(); assert.deepStrictEqual((await result)?.members, element.details!.members);
	});

	test('changing the display type removes its old type binding but retains its stable identity', async () => {
		const result = editOrditoElementNotation(parent, element, 4);
		field('Type or Method Signature').value = 'number';
		field('Required Field').checked = false;
		field('Nullability (Independent of Presence)').value = 'true';
		submit();
		assert.deepStrictEqual((await result)?.members[0], { id: 'field.customerId', name: 'customerId', type: 'number', kind: 'attribute', key: 'primary', required: false, nullable: { state: 'known', value: true } });
	});

	test('tables offer columns only and cancel leaves additions and removals unapplied', async () => {
		element.kind = 'table'; const before = structuredClone(element);
		const result = editOrditoElementNotation(parent, element, 3);
		assert.ok(![...parent.querySelectorAll('button')].some(button => button.textContent === 'Add Method'));
		button('Remove Member'); button('Add Attribute'); button('Cancel');
		assert.deepStrictEqual([await result, element], [undefined, before]);
	});

	test('relationship annotations remain together and reject invalid multiplicities', async () => {
		const relation: SemanticRelation = { id: 'relation.customer', kind: 'association', from: 'a', to: 'b', name: 'Orders' };
		const result = editOrditoRelationNotation(parent, relation);
		field('Source Multiplicity').value = 'many'; field('Target Multiplicity').value = '0..*'; field('Protocol / Transport').value = 'HTTPS';
		submit(); assert.strictEqual(field('Source Multiplicity').getAttribute('aria-invalid'), 'true');
		field('Source Multiplicity').value = '1'; submit();
		assert.deepStrictEqual(await result, { sourceMultiplicity: '1', targetMultiplicity: '0..*', sourceMember: '', targetMember: '', protocol: 'HTTPS' });
		assert.strictEqual(relation.details, undefined);
	});
});
