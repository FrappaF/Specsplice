import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IOrditoAiService } from '../../browser/orditoAiService.js';
import { IOrditoCodeService } from '../../browser/orditoCodeService.js';
import { OrditoControls } from '../../browser/orditoControls.js';
import { OrditoProjectService } from '../../browser/orditoProjectService.js';
import { OrditoWorkflowContent } from '../../browser/orditoWorkflowContent.js';
import { blueprintFixture } from '../common/blueprintFixture.js';

suite('Specsplice project action menus', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let root: HTMLElement;
	setup(() => { root = dom.append(document.body, dom.$('section.ordito-shell')); });
	teardown(() => root.remove());

	function fixture() {
		const controls = store.add(new OrditoControls());
		const project = Object.assign(new (mock<OrditoProjectService>())(), { model: structuredClone(blueprintFixture), editable: true });
		const commands: string[] = [];
		const commandService = Object.assign(new (mock<ICommandService>())(), { executeCommand: async (command: string) => { commands.push(command); } });
		const ai = Object.assign(new (mock<IOrditoAiService>())(), { editPureCriteria: async () => { commands.push('criteria'); }, structuralReverse: async () => { commands.push('reverse'); } });
		const host = new (mock<ConstructorParameters<typeof OrditoWorkflowContent>[0]>())();
		const workflow = new OrditoWorkflowContent(host, controls, project, ai, new (mock<IConfigurationService>())(), new (mock<INotificationService>())(), new (mock<IOrditoCodeService>())(), commandService);
		return { project, workflow, commands, controls };
	}

	test('project settings distinguish navigation, specification editing and advanced tools', async () => {
		const { workflow, commands } = fixture(); workflow.renderProjectActions(root);
		const buttons = [...root.querySelectorAll<HTMLButtonElement>('.ordito-menu-action')];
		const action = (label: string) => buttons.find(button => button.getAttribute('aria-label') === label)!;
		assert.deepStrictEqual({ sections: [...root.querySelectorAll(':scope > details > summary')].map(summary => summary.getAttribute('aria-label')), navigate: action('System Map').classList.contains('ordito-menu-action-navigation'), edit: action('Edit Blueprint').classList.contains('ordito-menu-action-navigation'), editGroup: action('Edit Blueprint').closest('section')?.querySelector('h3')?.textContent, nestedEditDisclosure: [...root.querySelectorAll('summary')].some(summary => summary.getAttribute('aria-label') === 'Edit Behavior') }, { sections: ['Open and Save', 'Model and Architecture', 'Executable Behavior', 'Developer Tools'], navigate: true, edit: false, editGroup: 'Edit Specification', nestedEditDisclosure: false });
		assert.ok(buttons.every(button => button.querySelector('.codicon[aria-hidden="true"]')));
		action('System Map').click(); action('Edit Blueprint').click(); action('Independent Business Expectations').click();
		await Promise.resolve(); assert.deepStrictEqual(commands, ['ordito.showSystemMap', 'ordito.blueprint', 'criteria']);
	});

	test('readonly projects retain exploration and tools while omitting specification mutations', () => {
		const { workflow, project } = fixture(); Object.assign(project, { editable: false }); workflow.renderProjectActions(root);
		const names = [...root.querySelectorAll<HTMLButtonElement>('.ordito-menu-action')].map(button => button.getAttribute('aria-label'));
		assert.deepStrictEqual({ explore: names.includes('System Map'), tools: names.includes('Files') && names.includes('Git'), edit: names.includes('Edit Blueprint'), behavior: root.textContent?.includes('Executable Behavior') }, { explore: true, tools: true, edit: false, behavior: false });
	});

	test('loading leaves file recovery available and does not expose stale model actions', () => {
		const { workflow, project } = fixture(); Object.assign(project, { loading: true }); workflow.renderProjectActions(root);
		assert.deepStrictEqual([...root.querySelectorAll<HTMLButtonElement>('.ordito-menu-action')].map(button => button.getAttribute('aria-label')), ['Save Project Copy', 'Reload Project', 'Import Codebase', 'Open Model']);
	});
});
