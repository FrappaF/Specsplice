import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getDiagramGroups, getElementPath } from '../common/visualNavigation.js';
import { OrditoInput } from './orditoInput.js';
import { elementLabels } from './orditoLabels.js';
import { IOrditoProjectService } from './orditoProjectService.js';
import { OrditoEditor } from './orditoEditor.js';

interface SearchItem extends IQuickPickItem { elementId?: string; viewId?: string }

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ordito.showImpact', title: localize2('ordito.showImpact', "Specsplice: Show Change Impact"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const project = accessor.get(IOrditoProjectService);
		const quickInput = accessor.get(IQuickInputService);
		const editors = accessor.get(IEditorService);
		if (project.loading || project.error) { return; }
		let id = project.selectedId;
		if (!id || project.section === 'map' || project.section === 'home') {
			const version = project.documentVersion;
			const picked = await quickInput.pick(project.model.semantics.elements.map(element => ({ label: element.name, description: elementLabels[element.kind], id: element.id })), { title: localize('ordito.impact.choose', "Change Impact of Element") });
			if (!picked || version !== project.documentVersion) { return; }
			id = picked.id;
		}
		project.showImpact(id);
		await editors.openEditor({ resource: OrditoInput.RESOURCE, options: { pinned: true, revealIfOpened: true } });
	}
});

registerAction2(class extends Action2 {
	constructor() { super({ id: 'ordito.search', title: localize2('ordito.search', "Specsplice: Search System"), f1: true }); }
	async run(accessor: ServicesAccessor): Promise<void> {
		const project = accessor.get(IOrditoProjectService);
		const quickInput = accessor.get(IQuickInputService);
		const editors = accessor.get(IEditorService);
		const notifications = accessor.get(INotificationService);
		if (project.loading || project.error) { return; }
		const resource = project.modelUri?.toString();
		const model = project.model;

		const items: SearchItem[] = [];
		{
			for (const element of model.semantics.elements) {
				const views = model.views.filter(view => view.nodes.some(node => node.elementId === element.id));
				items.push({ label: element.name, elementId: element.id, description: elementLabels[element.kind],
					detail: localize('ordito.search.context', "{0} · {1}", [model.name, ...getElementPath(model, element.id).slice(0, -1).map(parent => parent.name)].join(' / '),
						views.length ? views.map(view => view.name).join(', ') : localize('ordito.search.unplaced', "Element Details — Not in a Diagram")) });
			}
		}
		{
			for (const group of getDiagramGroups(model)) {
				for (const view of group.views) { items.push({ label: view.name, viewId: view.id, description: localize('ordito.search.diagramKind', "Diagram"), detail: group.name }); }
			}
		}
		const item = await quickInput.pick(items, { title: localize('ordito.search.title', "Search System"), placeHolder: localize('ordito.search.placeholder', "Search names, types, features and diagrams"), matchOnDescription: true, matchOnDetail: true });
		if (!item) { return; }
		if (resource !== project.modelUri?.toString() || model.id !== project.model.id) {
			notifications.info(localize('ordito.search.changed', "The project changed while search was open. Search the current project again."));
			return;
		}
		if (item.elementId) { project.revealElement(item.elementId); }
		else if (item.viewId) { project.showDiagram(item.viewId); }
		const pane = await editors.openEditor({ resource: OrditoInput.RESOURCE, options: { pinned: true, revealIfOpened: true } });
		if (pane instanceof OrditoEditor) { pane.focusSelection(); }
	}
});

for (const [id, title] of [
	['showSystemMap', localize2('ordito.showSystemMap', "Specsplice: Show System Map")],
	['goBack', localize2('ordito.goBack', "Specsplice: Go Back")],
	['goForward', localize2('ordito.goForward', "Specsplice: Go Forward")]
] as const) {
	registerAction2(class extends Action2 {
		constructor() { super({ id: `ordito.${id}`, title, f1: true }); }
		async run(accessor: ServicesAccessor): Promise<void> {
			const project = accessor.get(IOrditoProjectService);
			if (id === 'showSystemMap') { project.showSystemMap(); }
			else if (id === 'goBack') { project.goBack(); } else { project.goForward(); }
			const pane = await accessor.get(IEditorService).openEditor({ resource: OrditoInput.RESOURCE, options: { pinned: true, revealIfOpened: true } });
			if (pane instanceof OrditoEditor) { pane.showWorkspace(); }
		}
	});
}
