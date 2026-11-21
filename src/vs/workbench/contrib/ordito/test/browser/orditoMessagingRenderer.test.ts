import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { OrditoControls } from '../../browser/orditoControls.js';
import { renderOrditoMessaging } from '../../browser/orditoMessaging.js';
import { orditoMessagingRows } from '../../browser/orditoMessagingContent.js';
import { messagingFixture } from '../common/messagingFixture.js';

suite('Specsplice messaging renderer', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite(); let root: HTMLElement;
	setup(() => { root = dom.append(document.body, dom.$('section')); }); teardown(() => root.remove());
	test('broker aggregation retains channels/policies and keyboard access to consumers', () => { const model = structuredClone(messagingFixture), before = structuredClone(model), selected: string[] = []; renderOrditoMessaging(root, model, 'checkout.messaging', disposables.add(new OrditoControls()), id => selected.push(id)); assert.deepStrictEqual([...root.querySelectorAll<HTMLElement>('[data-messaging-id]')].map(row => row.dataset.messagingId), orditoMessagingRows(model, 'checkout.messaging').map(row => row.id)); const button = root.querySelector<HTMLButtonElement>('[data-messaging-id="billing"] button')!; button.focus(); assert.strictEqual(document.activeElement, button); button.click(); assert.deepStrictEqual(selected, ['billing']); assert.deepStrictEqual(model, before); });
	test('hostile channel labels remain text and explicit subscription policies remain accessible', () => { const model = structuredClone(messagingFixture); model.foundation.messaging![0].channels[0].name = '<img src=x onerror=alert(1)>'; renderOrditoMessaging(root, model, 'checkout.messaging', disposables.add(new OrditoControls()), () => {}); assert.strictEqual(root.querySelector('img'), null); for (const row of orditoMessagingRows(model, 'checkout.messaging')) { assert.ok(root.textContent?.includes(row.text)); } assert.strictEqual(root.querySelector('section')?.getAttribute('aria-label'), 'Messaging Details'); });
});
