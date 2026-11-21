import { localize } from '../../../../nls.js';
import { orditoErrorNotification } from './orditoErrors.js';
import * as dom from '../../../../base/browser/dom.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { acceptsNotationRelation, notationRelationLabel, notationRules } from '../common/modelNotation.js';
import { isCompatibleRelation } from '../common/modelValidation.js';
import { ModelView, RelationKind, SemanticElement, SemanticModel } from '../common/modelTypes.js';
import { OrditoProjectService } from './orditoProjectService.js';
import { OrditoControls } from './orditoControls.js';
import { elementLabels, relationLabels, viewLabels } from './orditoLabels.js';
import { OrditoActionMenu } from './orditoActionMenu.js';
import { diagramIcon, elementIcon, prependOrditoIcon } from './orditoIcons.js';
import { deploymentBoundaryHeader, DiagramBox, DiagramObstacle, placeConnectionLabel, routeDiagramConnections } from '../common/diagramRouting.js';
import { getSequenceDiagram } from '../common/sequenceDiagram.js';
import { renderOrditoDescriptiveActivity } from './orditoDescriptiveActivity.js';
import { renderOrditoSequence } from './orditoSequence.js';
import { renderOrditoMessaging } from './orditoMessaging.js';
import { renderOrditoState, stateTransitionLabel } from './orditoState.js';
import { notationBoundaries, notationLines, notationNodeSize } from '../common/diagramLayout.js';
import { IAction, toAction } from '../../../../base/common/actions.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { OrditoCanvasController } from './orditoCanvasController.js';
import { getEditableScenario, getProjectedInteraction, getViewSelectionIds } from '../common/visualNavigation.js';
import { type BlueprintEditMode } from './orditoBlueprintEditing.js';
import { editOrditoConnectionDetails } from './orditoRelationForm.js';


interface OrditoCanvasSurfaceHost {
	button<T>(parent: HTMLElement, label: string, action: () => T, id?: string): HTMLButtonElement;
	chooseDiagram(): Promise<void>;
	focusSelection(): void;
	renderBreadcrumbs(parent: HTMLElement): void;
	renderNavigation(parent: HTMLElement, canvas?: boolean): void;
	renderPrimaryActions(parent: HTMLElement): void;
	documentStatus(): string;
	render(): void;
	iconButton<T>(parent: HTMLElement, label: string, icon: ThemeIcon, action: () => T, id?: string): HTMLButtonElement;
	paragraph(parent: HTMLElement, content: string): void;
	readonly root: HTMLElement;
	revealElement(id: string, viewId?: string): void;
}

/** State diagrams only accept transitions owned by a resource. */
function canConnectNodes(view: ModelView, elements: ReadonlyMap<string, SemanticElement>, kind: RelationKind, source: SemanticElement, target: SemanticElement): boolean {
	return isCompatibleRelation(kind, source.kind, target.kind) && (kind !== 'transition' || source.parentId === target.parentId
		&& (view.kind !== 'state' || elements.get(source.parentId ?? '')?.kind === 'resource'));
}

/** Draws the diagram surface and coordinates node/connection actions for the Specsplice editor. */
export class OrditoCanvasSurface {
	showRelationshipLabels: boolean | undefined;

	inspectorOpen = false;

	relationSelection: string | undefined;

	pendingConnection: { from: string; kind: RelationKind; viewId: string; version: string } | undefined;

	renderCanvasMenus(parent: HTMLElement, view: ModelView): void {
		const menu = this.canvas.floatingMenu = dom.append(parent, dom.$('nav.ordito-floating-menu'));
		menu.setAttribute('aria-label', localize('ordito.canvasActions', "Canvas Actions"));
		const interaction = getProjectedInteraction(this.project.model, view);
		const scenario = getEditableScenario(this.project.model, view);
		if (this.project.editable && (!interaction || scenario)) {
			this.host.button(menu, view.kind === 'state' ? localize('ordito.state.addState', "Add State") : localize('ordito.addElement', "Add Element"), () => this.commandService.executeCommand('ordito.addElement')).classList.add('ordito-primary-action');
			this.host.button(menu, localize('ordito.addExisting', "Add Existing Element"), () => this.commandService.executeCommand('ordito.addExisting'), 'canvas-add-existing');
			if (scenario) {
				this.host.button(menu, view.kind === 'activity' ? localize('ordito.scenario.addStep', "Add Step") : localize('ordito.scenario.addMessage', "Add Message"), () => this.commandService.executeCommand('ordito.connect'), 'canvas-add-scenario-step');
			} else if (view.nodes.some(node => node.elementId === this.project.selectedId)) {
				this.host.button(menu, localize('ordito.canvas.connect', "Connect"), () => this.beginConnection(this.project.selectedId));
			}
		}
		const actions = this.controls.details(menu, localize('ordito.canvas.diagramMenu', "Diagram"), 'canvas-actions', { popup: true });
		this.renderDiagramOptions(actions, view, { popupId: 'canvas-actions', canvas: true, editable: this.project.editable });
		const zoom = dom.append(parent, dom.$('nav.ordito-floating-zoom'));
		zoom.setAttribute('aria-label', localize('ordito.canvasZoom', "Canvas Zoom"));
		this.host.iconButton(zoom, localize('ordito.zoomOut', "Zoom Out"), Codicon.remove, () => { this.canvas.zoom /= 1.2; this.canvas.applyCamera(); }, 'canvas-zoom-out');
		this.canvas.zoomReadout = dom.append(zoom, dom.$('span.ordito-zoom-readout'));
		this.host.iconButton(zoom, localize('ordito.zoomIn', "Zoom In"), Codicon.add, () => { this.canvas.zoom *= 1.2; this.canvas.applyCamera(); }, 'canvas-zoom-in');
		this.host.button(zoom, localize('ordito.fitDiagram', "Fit Diagram"), () => this.canvas.fitDiagram(), 'canvas-fit');
		const history = dom.append(zoom, dom.$('div.ordito-canvas-history'));
		history.setAttribute('role', 'group'); history.setAttribute('aria-label', localize('ordito.editing.history', "Save and History"));
		this.host.iconButton(history, localize('ordito.undo', "Undo"), Codicon.discard, () => this.project.undo()).disabled = !this.project.canUndo;
		this.host.iconButton(history, localize('ordito.redo', "Redo"), Codicon.redo, () => this.project.redo()).disabled = !this.project.canRedo;
	}

	/** Every notation uses the same tab structure, including the alternate editing toolbar. */
	private renderDiagramOptions(parent: HTMLElement, view: ModelView, options: { popupId: string; canvas: boolean; editable: boolean; includeFeature?: boolean }): void {
		parent.classList.add('ordito-diagram-menu');
		const palette = new OrditoActionMenu(this.controls);
		const header = palette.header(parent, view.name, viewLabels[view.kind], diagramIcon(view.kind));
		const canArrange = view.kind !== 'sequence' && !(view.kind === 'activity' && view.interactionId);
		if (options.editable) {
			palette.headerAction(header, localize('ordito.menu.rename', "Rename"), () => this.commandService.executeCommand('ordito.renameDiagram'), Codicon.edit, `rename-diagram-header:${options.popupId}:${view.id}`);
			if (canArrange) {
				palette.headerAction(header, localize('ordito.menu.arrange', "Arrange"), () => this.commandService.executeCommand('ordito.layout'), Codicon.layout, `arrange-diagram-header:${options.popupId}:${view.id}`);
			}
		}
		const area = dom.append(parent, dom.$('div.ordito-diagram-tabs'));
		const tabs = this.controls.tabs(area, `diagram-menu:${view.id}`, [
			{ id: 'contents', label: localize('ordito.canvas.contents', "Contents") },
			{ id: 'display', label: localize('ordito.canvas.display', "Layout and Display") },
			{ id: 'information', label: localize('ordito.canvas.informationTab', "Information") }
		]);
		const contents = tabs.panels.get('contents')!;
		const display = tabs.panels.get('display')!;
		const information = tabs.panels.get('information')!;
		const model = this.project.model;
		const interaction = getProjectedInteraction(model, view);
		const scenario = getEditableScenario(model, view);
		const canEditContents = !interaction || !!scenario;
		const canAddExistingMessage = (view.kind === 'sequence' && canEditContents) || (view.kind === 'activity' && !!scenario);
		const canRefreshFromCode = !!scenario && this.project.projectRoot?.scheme === 'file';
		if (options.editable) {
			if (interaction?.execution) {
				palette.action(contents, localize('ordito.interaction.edit', "Edit Executable Interaction"), () => this.commandService.executeCommand('ordito.interaction', interaction.id), { icon: Codicon.arrowSwap });
			} else {
				if (scenario) { palette.action(contents, localize('ordito.scenario.edit', "Edit Scenario"), () => this.commandService.executeCommand('ordito.editScenario'), { icon: Codicon.gitMerge, emphasis: 'primary' }); }
				if (canRefreshFromCode) { palette.action(contents, localize('ordito.shortcuts.update', "Update Diagrams from Codebase"), () => this.commandService.executeCommand('ordito.ai.updateDiagrams'), { icon: Codicon.refresh }); }
			}
			this.renderBlueprintActions(contents, view);
			for (const [label, command, icon] of [
				...(canEditContents ? [[localize('ordito.addExisting', "Add Existing Element"), 'ordito.addExisting', Codicon.add] as const] : []),
				...(scenario || !interaction && view.kind !== 'state' && view.kind !== 'sequence' ? [[localize('ordito.addExistingRelation', "Add Existing Relationship"), 'ordito.addExistingRelation', Codicon.link] as const] : []),
				...(view.kind === 'state' ? [[localize('ordito.state.addExisting', "Add Existing State"), 'ordito.addExistingState', Codicon.circleLarge] as const, [localize('ordito.state.addTransition', "Add Existing Transition"), 'ordito.addTransition', Codicon.arrowRight] as const, [localize('ordito.state.includeLifecycle', "Include Resource Lifecycle"), 'ordito.includeLifecycle', Codicon.symbolEvent] as const] : []),
				...(canAddExistingMessage ? [[view.kind === 'activity' ? localize('ordito.scenario.addExistingStep', "Add Existing Step") : localize('ordito.sequence.addMessage', "Add Existing Message"), 'ordito.addSequenceMessage', Codicon.arrowSwap] as const] : []),
				...(options.includeFeature ? [[localize('ordito.addFeature', "Add Feature"), 'ordito.addFeature', Codicon.symbolEvent] as const] : [])
			]) { palette.action(contents, label, () => this.commandService.executeCommand(command), { icon }); }
		}
		if (scenario && options.editable) {
			this.host.paragraph(contents, localize('ordito.canvas.scenarioContents', "Edit participants, steps and branches in the scenario. Changes appear in every diagram linked to it."));
		} else if (interaction) {
			this.host.paragraph(contents, interaction.execution
				? localize('ordito.canvas.derivedContents', "This diagram is populated by its linked behavior. Edit that behavior to change its participants and steps.")
				: localize('ordito.canvas.descriptiveContents', "This diagram describes a recorded interaction. Its participants, branches and steps are shown for inspection."));
		} else if (!options.editable) {
			this.host.paragraph(contents, localize('ordito.canvas.readonlyContents', "This diagram is read-only. Its visible elements are listed in Information."));
		}
		if (canArrange) {
			palette.action(display, localize('ordito.layout', "Arrange Diagram"), () => this.commandService.executeCommand('ordito.layout'), { icon: Codicon.layout }).disabled = !options.editable;
			const visible = this.showRelationshipLabels ?? !!notationRules[view.kind];
			const labels = palette.action(display, localize('ordito.showRelationshipLabels', "Show Relationship Labels"), () => { this.showRelationshipLabels = !(this.showRelationshipLabels ?? !!notationRules[view.kind]); this.host.render(); }, { icon: Codicon.eye, detail: visible ? localize('ordito.canvas.labelsVisible', "Visible") : localize('ordito.canvas.labelsHidden', "Hidden") });
			labels.setAttribute('aria-pressed', String(visible));
		}
		if (!options.canvas) {
			palette.action(display, localize('ordito.zoomOut', "Zoom Out"), () => { this.canvas.zoom = Math.max(0.4, this.canvas.zoom - 0.2); this.host.render(); }, { icon: Codicon.remove });
		}
		palette.action(display, localize('ordito.zoomReset', "Reset Zoom"), () => { this.canvas.zoom = 1; if (options.canvas) { this.canvas.applyCamera(); } else { this.host.render(); } }, { icon: Codicon.screenNormal });
		if (!options.canvas) {
			palette.action(display, localize('ordito.zoomIn', "Zoom In"), () => { this.canvas.zoom = Math.min(2, this.canvas.zoom + 0.2); this.host.render(); }, { icon: Codicon.add });
		}
		const navigation = palette.section(information, localize('ordito.canvas.inspect', "Read and Inspect"), { compact: true });
		const properties = palette.action(navigation, localize('ordito.properties', "Properties"), () => { this.controls.setExpanded(options.popupId, false); this.inspectorOpen = !this.inspectorOpen; this.host.render(); }, { icon: Codicon.settingsGear, kind: 'navigation' });
		properties.setAttribute('aria-pressed', String(this.inspectorOpen));
		palette.action(navigation, localize('ordito.readDiagram', "Read Diagram"), () => this.commandService.executeCommand('ordito.readContext'), { icon: Codicon.book, kind: 'navigation', description: localize('ordito.canvas.readDescription', "Open an accessible description of this diagram.") });
		const overview = palette.section(information, localize('ordito.canvas.overview', "Overview"), { compact: true });
		const visibleIds = new Set(getViewSelectionIds(this.project.model, view));
		palette.info(overview, localize('ordito.canvas.visibleElements', "Visible Elements"), String(this.project.model.semantics.elements.filter(element => visibleIds.has(element.id)).length), Codicon.symbolClass);
		if (scenario && view.kind === 'activity' && scenario.description.participantIds.length) {
			const participants = palette.disclosure(information, localize('ordito.scenario.participants', "Participants"), 'canvas-scenario-participants', { icon: Codicon.organization });
			for (const id of scenario.description.participantIds) {
				const element = model.semantics.elements.find(element => element.id === id);
				if (element) { palette.action(participants, element.name, () => this.elementMenu(id, 0, 0), { icon: elementIcon(element.kind), kind: 'navigation' }); }
			}
		}
		if (scenario && view.relationIds.length) {
			const relationships = palette.disclosure(information, localize('ordito.scenario.contextRelationships', "Context Relationships"), 'canvas-scenario-relations', { icon: Codicon.link });
			for (const id of view.relationIds) {
				const relation = model.semantics.relations.find(relation => relation.id === id);
				if (relation) { palette.action(relationships, relation.name || relationLabels[relation.kind], () => this.relationMenu(id, 0, 0), { icon: Codicon.link, kind: 'navigation' }); }
			}
		}
		if ((this.project.model.version === 4 || this.project.model.version === 5) && view.messagingId) { renderOrditoMessaging(palette.disclosure(information, localize('ordito.messaging.details', "Messaging Details"), 'canvas-messaging', { icon: Codicon.mail }), this.project.model, view.messagingId, this.controls, id => this.project.inspectElement(id)); }
		if (view.kind === 'state') { renderOrditoState(palette.disclosure(information, localize('ordito.state.lifecycle', "Lifecycle Details"), 'canvas-lifecycle', { icon: Codicon.symbolEvent }), this.project.model, view, this.controls, id => this.project.inspectElement(id), id => { this.inspectorOpen = true; this.project.selectElement(id); this.host.render(); this.host.focusSelection(); }); }
		if (scenario) { this.host.paragraph(palette.disclosure(information, localize('ordito.scenario.details', "Scenario Details"), 'canvas-scenario', { icon: Codicon.gitMerge }), localize('ordito.scenario.editHelp', "The layout follows the participants, steps, branches and order of the linked scenario.")); }
		if (view.kind === 'sequence') {
			const intent = interaction?.execution ? localize('ordito.sequence.executableIntent', "Executable sequence: calls, frames and their declared order come from the linked interaction. Verify independent cases before applying its code.") : interaction ? localize('ordito.sequence.scenarioIntent', "Scenario sequence: calls, branches and known order come from the linked scenario. They do not establish observed execution.") : localize('ordito.sequence.intent', "Declared sequence: invocations, reads and writes, one occurrence per relationship. Order is local to this diagram, not observed execution.");
			this.host.paragraph(palette.disclosure(information, localize('ordito.sequence.info', "Sequence Details"), 'canvas-sequence', { icon: Codicon.arrowSwap }), intent);
		}
		if (view.id.startsWith('semantic:')) { this.host.paragraph(palette.disclosure(information, localize('ordito.ai.info', "Interpretation Details"), 'canvas-interpretation', { icon: Codicon.info }), localize('ordito.ai.interpretationHint', "AI Interpretation · Review Inferred Responsibilities and Flows Against the Source.")); }
		const help = palette.disclosure(information, localize('ordito.canvasHelpMenu', "Canvas Help"), 'canvas-help-menu', { icon: Codicon.question });
		palette.info(help, localize('ordito.canvas.relationshipLegend', "Relationships"), localize('ordito.relation.legend', "Relationships: solid arrow = invocation; dashed arrow = dependency; dashed triangle = realization. Read, write and transition types are named on each connection."));
		palette.info(help, localize('ordito.canvas.navigationHelp', "Navigation"), localize('ordito.infiniteCanvasHelp', "Drag the background to pan. Scroll to move; Ctrl or Command + scroll to zoom at the pointer. Arrow keys pan when the canvas is focused. Home fits the diagram. Select an element or connection for floating details."));
		if (options.editable) {
			const management = palette.disclosure(parent, localize('ordito.canvas.manageDiagram', "Manage Diagram"), 'diagram-manage', { icon: Codicon.settingsGear });
			palette.action(management, localize('ordito.renameDiagram', "Rename Diagram"), () => this.commandService.executeCommand('ordito.renameDiagram'), { icon: Codicon.edit });
			const danger = palette.section(management, localize('ordito.canvas.removeDiagram', "Remove Diagram"), { tone: 'danger', description: localize('ordito.canvas.deleteHelp', "Elements and relationships remain available in the system.") });
			palette.action(danger, localize('ordito.deleteDiagram', "Delete Diagram"), () => this.commandService.executeCommand('ordito.deleteDiagram'), { icon: Codicon.trash, kind: 'destructive' });
		}
	}

	renderCanvas(parent: HTMLElement, model: SemanticModel, view: ModelView): void {
		this.canvas.canvasViewport = parent;
		parent.tabIndex = 0;
		this.controls.trackFocus('canvas', parent);
		parent.setAttribute('role', 'region');
		parent.setAttribute('aria-describedby', 'ordito-canvas-help');
		parent.setAttribute('aria-label', localize('ordito.canvas', "Diagram: {0}", view.name));
		parent.setAttribute('aria-roledescription', localize('ordito.infiniteCanvas', "Infinite Diagram Canvas"));
		this.canvas.installPan(parent);
		const interaction = getProjectedInteraction(model, view);
		if (!view.nodes.length && !interaction) {
			this.canvas.canvasContent = dom.append(dom.append(parent, dom.$('.ordito-canvas')), dom.$('.ordito-canvas-content'));
			this.canvas.worldBounds = { x: 0, y: 0, width: 1, height: 1 };
			const empty = dom.append(parent, dom.$('p.ordito-empty-canvas')); empty.textContent = localize('ordito.emptyDiagram', "This diagram has no elements.");
			return;
		}
		if (model.version === 5 && view.kind === 'activity' && view.interactionId) {
			const frame = dom.append(parent, dom.$('.ordito-canvas')), canvas = dom.append(frame, dom.$('.ordito-canvas-content'));
			this.canvas.canvasContent = canvas;
			const size = renderOrditoDescriptiveActivity(canvas, model, view.interactionId, this.controls, id => { this.inspectorOpen = true; this.relationSelection = undefined; this.project.selectElement(id); this.host.render(); }, this.project.selectedId);
			dom.size(canvas, size.width, size.height); dom.size(frame, 1, 1);
			this.canvas.worldBounds = { x: 0, y: 0, width: size.width, height: size.height }; canvas.style.transformOrigin = '0 0'; canvas.style.transform = `scale(${this.canvas.zoom})`;
			return;
		}
		const elements = new Map(model.semantics.elements.map(element => [element.id, element]));
		const pending = this.pendingConnection;
		const source = pending && elements.get(pending.from);
		let origin: { button: HTMLElement; outline?: DiagramObstacle['outline'] } | undefined;
		const targets = new Set<HTMLElement>();
		const registerConnectionNode = (id: string, button: HTMLElement, outline?: DiagramObstacle['outline']) => {
			if (!pending || !source) { return; }
			if (id === source.id) { origin = { button, outline }; }
			const target = elements.get(id);
			if (target && canConnectNodes(view, elements, pending.kind, source, target)) { targets.add(button); }
		};
		const installConnectionPreview = () => {
			if (origin) { this.canvas.installConnectionPreview(parent, origin.button, targets, origin.outline); }
		};
		if (view.kind === 'sequence') {
			const frame = dom.append(parent, dom.$('.ordito-canvas'));
			const canvas = dom.append(frame, dom.$('.ordito-canvas-content'));
			this.canvas.canvasContent = canvas;
			const selectRelation = (id: string) => { this.inspectorOpen = true; this.relationSelection = id; this.host.render(); };
			const size = renderOrditoSequence(canvas, model, view, this.controls, this.project.selectedId, id => { if (this.pendingConnection) { return this.finishConnection(id); } else { this.inspectorOpen = true; this.relationSelection = undefined; this.project.selectElement(id); this.host.render(); } return undefined; }, {
				selectRelation, selectedRelation: this.relationSelection,
				element: (target, id) => {
					this.installContextMenu(target, (x, y) => this.elementMenu(id, x, y));
					registerConnectionNode(id, target);
				},
				relation: (target, id) => {
					this.installContextMenu(target, (x, y) => this.relationMenu(id, x, y));
					if (dom.isSVGElement(target)) { this.canvas.interactions.add(dom.addDisposableListener(target, 'click', () => selectRelation(id))); }
				}
			});
			dom.size(canvas, size.width, size.height);
			dom.size(frame, 1, 1);
			this.canvas.worldBounds = { x: 0, y: 0, width: size.width, height: size.height };
			canvas.style.transformOrigin = '0 0';
			canvas.style.transform = `scale(${this.canvas.zoom})`;
			const sequence = getSequenceDiagram(model, view);
			if (!sequence.messages.length && (!interaction || !interaction.occurrenceIds.length && !interaction.frameIds.length)) { this.host.paragraph(parent, interaction?.execution ? localize('ordito.sequence.emptyExecutable', "No messages in the linked interaction. Use Edit Executable Interaction in Project to add behavior.") : interaction ? localize('ordito.sequence.emptyScenario', "The linked scenario has no messages yet.") : localize('ordito.sequence.empty', "No messages. Add an existing interaction or connect participants.")); }
			if (sequence.unsupported.length) {
				this.host.paragraph(parent, localize('ordito.sequence.unsupported', "Not rendered as sequence messages: {0}. These relationships remain in Properties and Read Diagram.", sequence.unsupported.map(relation => relation.name || relationLabels[relation.kind]).join(', ')));
			}
			installConnectionPreview();
			return;
		}

		const frame = dom.append(parent, dom.$('.ordito-canvas'));
		const canvas = dom.append(frame, dom.$('.ordito-canvas-content'));
		this.canvas.canvasContent = canvas;
		canvas.style.transformOrigin = '0 0';
		const svg = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('role', 'group');
		svg.setAttribute('aria-label', localize('ordito.connections', "Diagram Relationships"));
		canvas.appendChild(svg);
		const boundaries = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
		boundaries.setAttribute('aria-hidden', 'true');
		svg.appendChild(boundaries);
		const boundaryBoxes = notationBoundaries(model, view);
		const boundariesById = new Map(boundaryBoxes.map(box => [box.elementId, box]));
		for (const box of boundaryBoxes) {
			const rect = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
			rect.setAttribute('class', 'ordito-notation-boundary');
			rect.setAttribute('data-notation-kind', elements.get(box.elementId)!.kind);
			for (const key of ['x', 'y', 'width', 'height'] as const) { rect.setAttribute(key, String(box[key])); }
			const label = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'text');
			label.setAttribute('class', 'ordito-notation-boundary-label'); label.setAttribute('x', String(box.x + 12)); label.setAttribute('y', String(box.y + 24)); label.textContent = box.name;
			boundaries.append(rect);
			if (!view.nodes.some(node => node.elementId === box.elementId)) { boundaries.append(label); }
		}
		const paths = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
		const labels = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
		svg.append(paths, labels);
		const boxes = view.nodes.map((node): DiagramObstacle => {
			const element = elements.get(node.elementId)!;
			const outline = element.kind === 'decision' ? 'diamond' : element.kind === 'start' || element.kind === 'end' ? 'ellipse' : undefined;
			const boundary = boundariesById.get(node.elementId);
			if (boundary && element.kind === 'deploymentNode') {
				return { id: node.elementId, ...deploymentBoundaryHeader(boundary, element.name) };
			}
			return { id: node.elementId, outline, ...notationNodeSize(element), ...(boundary ? { x: boundary.x + 12, y: boundary.y + 6, height: 32 } : { x: node.x, y: node.y }) };
		});
		const relationships = model.semantics.relations.filter(relation => view.relationIds.includes(relation.id));
		const routes = routeDiagramConnections(boxes, relationships);
		const connections = relationships.map(relation => ({ relation, route: routes.get(relation.id) }));
		const points = [...connections.flatMap(connection => connection.route ?? []), ...boundaryBoxes.flatMap(box => [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y + box.height }])];

		const occupied: DiagramBox[] = [...boxes];
		for (const { relation, route } of connections) {
			if (!route || route.length < 2) { continue; }
			const end = route[route.length - 1];
			const previous = route[route.length - 2];
			const angle = Math.atan2(end.y - previous.y, end.x - previous.x);
			const path = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('data-relation-id', relation.id);
			path.setAttribute('d', `${route.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')} M ${end.x - 10 * Math.cos(angle - 0.5)} ${end.y - 10 * Math.sin(angle - 0.5)} L ${end.x} ${end.y} L ${end.x - 10 * Math.cos(angle + 0.5)} ${end.y - 10 * Math.sin(angle + 0.5)}`);
			const related = this.relationSelection === relation.id || this.inspectorOpen && (relation.from === this.project.selectedId || relation.to === this.project.selectedId);
			const visibleCaption = (this.showRelationshipLabels ?? !!notationRules[view.kind]) || related;
			const group = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
			group.setAttribute('class', `ordito-connection${this.relationSelection === relation.id ? ' selected' : ''}${related ? ' is-related' : ''}`);
			group.setAttribute('tabindex', '0'); group.setAttribute('role', 'button');
			group.setAttribute('data-relation-id', relation.id);
			const fromName = elements.get(relation.from)!.name;
			const toName = elements.get(relation.to)!.name;
			group.setAttribute('aria-label', localize('ordito.relation.accessible', "{0} · {1} → {2} · {3}", relationLabels[relation.kind], fromName, toName, relation.name));
			group.setAttribute('aria-description', [relation.condition, relation.errorCode].filter(Boolean).join(' · '));
			this.controls.trackFocus(`edge:${relation.id}`, group);
			if (['dependency', 'realization', 'implementation', 'include', 'extend'].includes(relation.kind)) { path.setAttribute('stroke-dasharray', '6 4'); }
			if (['realization', 'inheritance', 'implementation'].includes(relation.kind)) { path.setAttribute('d', path.getAttribute('d')! + ' Z'); }
			if (['association', 'composition', 'aggregation'].includes(relation.kind)) {
				path.setAttribute('d', route.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '));
				if (relation.kind !== 'association') {
					const start = route[0], next = route[1], dx = Math.sign(next.x - start.x), dy = Math.sign(next.y - start.y);
					path.setAttribute('d', path.getAttribute('d')! + ` M ${start.x} ${start.y} l ${dx * 9 - dy * 5} ${dy * 9 + dx * 5} l ${dx * 9 + dy * 5} ${dy * 9 - dx * 5} l ${-dx * 9 + dy * 5} ${-dy * 9 - dx * 5} Z`);
					if (relation.kind === 'composition') { path.classList.add('ordito-composition'); }
				}
			}
			group.appendChild(path); paths.appendChild(group);
			const hit = path.cloneNode() as SVGPathElement;
			hit.setAttribute('class', 'ordito-connection-hit'); hit.removeAttribute('data-relation-id'); hit.removeAttribute('stroke-dasharray');
			group.appendChild(hit);
			const candidatesAt = (x: number, y: number) => {
				const bounds = svg.getBoundingClientRect();
				const point = { x: (x - bounds.left) / this.canvas.zoom, y: (y - bounds.top) / this.canvas.zoom };
				return connections.filter(connection => connection.route?.slice(1).some((end, index) => {
					const start = connection.route![index];
					return point.x >= Math.min(start.x, end.x) - 8 / this.canvas.zoom && point.x <= Math.max(start.x, end.x) + 8 / this.canvas.zoom && point.y >= Math.min(start.y, end.y) - 8 / this.canvas.zoom && point.y <= Math.max(start.y, end.y) + 8 / this.canvas.zoom;
				})).map(connection => connection.relation);
			};
			const select = async (event?: MouseEvent) => {
				const candidates = event?.detail ? candidatesAt(event.clientX, event.clientY) : [];
				const chosen = candidates.length > 1 ? (await this.quick.pick(candidates.map(relation => ({ label: relation.name || relationLabels[relation.kind], description: relationLabels[relation.kind], relation })), { title: localize('ordito.relation.chooseOverlap', "Choose a Relationship at This Point") }))?.relation : relation;
				if (chosen) { this.inspectorOpen = true; this.relationSelection = chosen.id; group.focus(); this.host.render(); }
			};
			const context = (x: number, y: number) => {
				const candidates = candidatesAt(x, y);
				if (candidates.length > 1) { this.showMenu(x, y, candidates.map(relation => toAction({ id: `ordito.overlap.${relation.id}`, label: `${relationLabels[relation.kind]} · ${relation.name}`, run: () => this.runAction(() => this.relationMenu(relation.id, x, y)) }))); }
				else { this.relationMenu(relation.id, x, y); }
			};
			this.canvas.interactions.add(dom.addDisposableListener(group, 'click', (event: MouseEvent) => this.runAction(() => select(event))));
			this.canvas.interactions.add(dom.addDisposableListener(group, 'keydown', (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.runAction(() => select()); } }));
			this.installContextMenu(group, context);
			const caption = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g');
			caption.setAttribute('class', `ordito-edge-caption${visibleCaption ? ' is-visible' : ''}`); labels.appendChild(caption);
			const reveal = () => caption.classList.add('is-hovered');
			const conceal = () => caption.classList.remove('is-hovered');
			for (const target of [group, caption]) {
				this.canvas.interactions.add(dom.addDisposableListener(target, 'pointerenter', reveal));
				this.canvas.interactions.add(dom.addDisposableListener(target, 'pointerleave', conceal));
				this.canvas.interactions.add(dom.addDisposableListener(target, 'focus', reveal));
				this.canvas.interactions.add(dom.addDisposableListener(target, 'blur', conceal));
			}
			const label = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'text');
			label.setAttribute('class', 'ordito-connection-label');
			label.textContent = view.kind === 'state' && relation.kind === 'transition' ? stateTransitionLabel(relation) : [relationLabels[relation.kind], notationRelationLabel(relation), relation.condition ? `[${relation.condition}]` : '', relation.errorCode].filter(Boolean).join(' · ');
			label.setAttribute('data-relation-id', relation.id);
			this.canvas.interactions.add(dom.addDisposableListener(label, 'click', (event: MouseEvent) => this.runAction(() => select(event))));
			this.installContextMenu(label, context);
			caption.appendChild(label);
			const placement = placeConnectionLabel(route, label.getComputedTextLength() + 12, occupied, { allowNegativeCoordinates: true });
			if (visibleCaption) { occupied.push(placement.box); }
			const { x, y, width: labelWidth } = placement.box;
			const background = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
			background.setAttribute('class', 'ordito-connection-background');
			background.setAttribute('x', String(x)); background.setAttribute('y', String(y));
			background.setAttribute('width', String(labelWidth)); background.setAttribute('height', String(placement.box.height));
			caption.insertBefore(background, label);
			label.setAttribute('x', String(x + 6)); label.setAttribute('y', String(y + 14));
			if (placement.detached) {
				const leader = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
				leader.setAttribute('class', 'ordito-connection-leader');
				const attachmentX = Math.max(x, Math.min(placement.anchor.x, x + labelWidth));
				const attachmentY = Math.max(y, Math.min(placement.anchor.y, y + placement.box.height));
				leader.setAttribute('d', `M ${placement.anchor.x} ${placement.anchor.y} L ${attachmentX} ${attachmentY}`);
				caption.insertBefore(leader, background);
			}
		}
		const minX = Math.min(...occupied.map(box => box.x), ...points.map(point => point.x));
		const minY = Math.min(...occupied.map(box => box.y), ...points.map(point => point.y));
		const canvasWidth = Math.max(...occupied.map(box => box.x + box.width), ...points.map(point => point.x)) + 32;
		const canvasHeight = Math.max(...occupied.map(box => box.y + box.height), ...points.map(point => point.y)) + 32;
		this.canvas.worldBounds = { x: minX, y: minY, width: canvasWidth - minX, height: canvasHeight - minY };
		canvas.classList.toggle('is-focusing', this.inspectorOpen);
		dom.size(frame, 1, 1);
		dom.size(canvas, 1, 1);
		svg.setAttribute('width', '1'); svg.setAttribute('height', '1');
		// Measure labels at their logical size before applying the viewport zoom.
		canvas.style.transform = `scale(${this.canvas.zoom})`;
		const positions = new Map(boxes.map(box => [box.id, box]));
		const blocked = connections.filter(connection => !connection.route).length;
		if (blocked) {
			this.host.paragraph(parent, localize('ordito.routing.blocked', "{0} connections cannot be routed through overlapping nodes. Move the nodes apart; all relationships remain available in Properties and Read Diagram.", blocked));
		}
		for (const node of view.nodes) {
			const element = elements.get(node.elementId)!;
			const position = positions.get(element.id)!;
			const isBoundary = boundariesById.has(element.id);
			const isDeploymentHeader = isBoundary && element.kind === 'deploymentNode';
			const button = this.host.button(canvas, element.name, () => { if (this.pendingConnection) { return this.finishConnection(element.id); } else { this.inspectorOpen = true; this.relationSelection = undefined; this.project.selectElement(element.id); this.host.render(); } return undefined; }, `node:${element.id}`);
			button.classList.add('ordito-node');
			button.classList.toggle('is-boundary', isBoundary);
			button.dataset.kind = elementLabels[element.kind];
			button.setAttribute('aria-label', element.name);
			const selectedRelation = model.semantics.relations.find(relation => relation.id === this.relationSelection);
			button.classList.toggle('ordito-related-node', selectedRelation?.from === element.id || selectedRelation?.to === element.id);
			button.style.left = `${position.x}px`;
			button.style.top = `${position.y}px`;
			button.style.width = `${position.width}px`;
			button.style.height = `${position.height}px`;
			button.dataset.notationKind = element.kind;
			if (element.kind === 'useCase' || element.kind === 'decision' || isDeploymentHeader) {
				button.textContent = '';
				dom.append(button, dom.$('span.ordito-node-name')).textContent = element.name;
			}
			if (isDeploymentHeader) { prependOrditoIcon(button, elementIcon(element.kind)); }
			if (element.kind === 'decision') {
				const { width, height } = position;
				button.prepend(dom.$.SVG('svg', { class: 'ordito-decision-shape', 'aria-hidden': 'true' },
					dom.$.SVG('polygon', { points: `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}` })
				));
			}
			for (const line of isBoundary ? [] : notationLines(element)) { dom.append(button, dom.$('span.ordito-node-member')).textContent = line; }
			button.setAttribute('aria-pressed', String(!this.relationSelection && element.id === this.project.selectedId));
			button.setAttribute('aria-description', [elementLabels[element.kind], ...notationLines(element)].join(' · '));
			this.installContextMenu(button, (x, y) => this.elementMenu(element.id, x, y));
			registerConnectionNode(element.id, button, position.outline);
			if (this.project.editable) { this.canvas.installNodeEditing(button, view, element.id, model, isBoundary); }
		}
		// Keep the historical node-first tab order, followed by keyboard-accessible connections.
		canvas.appendChild(svg);
		installConnectionPreview();
	}

	private renderBlueprintActions(parent: HTMLElement, view: ModelView): void {
		if ((this.project.model.version !== 4 && this.project.model.version !== 5) || !view.subjectId || !['c4Context', 'c4Container', 'c4Component', 'class'].includes(view.kind)) { return; }
		const actions: { label: string; mode: BlueprintEditMode }[] = [
			{ label: localize('ordito.blueprint.editVisibility', "Edit Visible Elements"), mode: 'c4Visibility' },
			{ label: localize('ordito.blueprint.editDependencies', "Edit Context Dependencies"), mode: 'c4Dependencies' }
		];
		const palette = new OrditoActionMenu(this.controls);
		for (const { label, mode } of actions) {
			palette.action(parent, label, () => this.commandService.executeCommand('ordito.blueprint', undefined, mode), { icon: mode === 'c4Visibility' ? Codicon.eye : Codicon.references });
		}
	}

	renderEditingToolbar(parent: HTMLElement): void {
		const toolbar = dom.append(parent, dom.$('nav.ordito-editing'));
		toolbar.setAttribute('aria-label', localize('ordito.editing', "Diagram Editing"));
		if (this.project.modelUri) {
			const history = dom.append(toolbar, dom.$('div.ordito-editing-history'));
			history.setAttribute('role', 'group'); history.setAttribute('aria-label', localize('ordito.editing.history', "Save and History"));
			this.host.iconButton(history, localize('ordito.save', "Save"), Codicon.save, () => this.project.save(true)).disabled = !this.project.dirty;
			this.host.iconButton(history, localize('ordito.undo', "Undo"), Codicon.discard, () => this.project.undo()).disabled = !this.project.canUndo;
			this.host.iconButton(history, localize('ordito.redo', "Redo"), Codicon.redo, () => this.project.redo()).disabled = !this.project.canRedo;
		}
		const view = this.project.activeView;
		const interaction = view && getProjectedInteraction(this.project.model, view);
		const scenario = view && getEditableScenario(this.project.model, view);
		const editable = this.project.editable && !['element', 'impact', 'map'].includes(this.project.section);
		if (this.project.editable && this.project.section !== 'element' && this.project.section !== 'impact') {
			if (this.project.section === 'map' || !view) {
				this.host.button(toolbar, localize('ordito.addFeature', "Add Feature"), () => this.commandService.executeCommand('ordito.addFeature'));
			} else if (!interaction || scenario) {
				this.host.button(toolbar, view.kind === 'state' ? localize('ordito.state.addState', "Add State") : localize('ordito.addElement', "Add Element"), () => this.commandService.executeCommand('ordito.addElement'));
			}
		}
		if (view) {
			const options = this.controls.details(toolbar, localize('ordito.diagramOptions', "Diagram Options"), 'diagram-options', { popup: true });
			this.renderDiagramOptions(options, view, { popupId: 'diagram-options', canvas: false, editable, includeFeature: true });
			if (scenario && editable) {
				this.host.button(toolbar, view.kind === 'activity' ? localize('ordito.scenario.addStep', "Add Step") : localize('ordito.scenario.addMessage', "Add Message"), () => this.commandService.executeCommand('ordito.connect'), 'canvas-add-scenario-step');
			} else if (!interaction) { this.host.button(toolbar, localize('ordito.createRelationship', "Create Relationship…"), () => this.beginConnection(this.project.selectedId)).disabled = !this.project.editable; }
			if (!this.host.root.classList.contains('ordito-canvas-mode')) { this.host.button(toolbar, localize('ordito.fitDiagram', "Fit Diagram"), () => this.canvas.fitDiagram()); }
		} else if (this.project.section === 'element') {
			this.host.button(toolbar, localize('ordito.readElement', "Read Element Details"), () => this.commandService.executeCommand('ordito.readContext'));
		} else if (this.project.section === 'impact') {
			this.host.button(toolbar, localize('ordito.readImpact', "Read Change Impact"), () => this.commandService.executeCommand('ordito.readContext'));
		} else if (this.project.section === 'map') {
			this.host.button(toolbar, localize('ordito.readMap', "Read System Map"), () => this.commandService.executeCommand('ordito.readContext'));
		}
	}

	private reportError(error: unknown): void {
		this.notifications.error(orditoErrorNotification(error, 'edit', this.project.model));
		this.host.render();
	}

	private runAction(action: () => void | Promise<void>): void {
		try {
			const result = action();
			if (result) { void result.catch(error => this.reportError(error)); }
		} catch (error) { this.reportError(error); }
	}

	installContextMenu(target: HTMLElement | SVGElement, show: (x: number, y: number) => void): void {
		this.canvas.interactions.add(dom.addDisposableListener(target, 'contextmenu', (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); this.runAction(() => show(event.clientX, event.clientY)); }));
		this.canvas.interactions.add(dom.addDisposableListener(target, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { event.preventDefault(); event.stopPropagation(); const box = target.getBoundingClientRect(); this.runAction(() => show(box.left, box.bottom)); }
		}));
	}

	showMenu(x: number, y: number, actions: IAction[]): void {
		const restore = this.controls.captureFocus(this.host.root);
		this.contextMenus.showContextMenu({ getAnchor: () => ({ x, y }), getActions: () => actions, autoSelectItem: true, onHide: cancelled => { if (cancelled) { restore(); } } });
	}

	elementMenu(id: string, _x: number, _y: number): void {
		this.runAction(() => {
			const view = this.project.activeView;
			if (!this.project.model.semantics.elements.some(element => element.id === id) && (!view || !getViewSelectionIds(this.project.model, view).includes(id))) { return; }
			this.controls.setExpanded('ai-collaboration', false);
			this.controls.setExpanded('canvas-actions', false);
			this.controls.setExpanded('diagram-options', false);
			this.inspectorOpen = true; this.relationSelection = undefined;
			this.project.selectElement(id); this.host.render();
			if (!this.controls.focusTabGroup('element-inspector')) { this.controls.focusTabGroup('interaction-inspector'); }
		});
	}

	relationMenu(id: string, _x: number, _y: number): void {
		this.runAction(() => {
			if (!this.project.model.semantics.relations.some(relation => relation.id === id)) { return; }
			this.controls.setExpanded('ai-collaboration', false);
			this.controls.setExpanded('canvas-actions', false);
			this.controls.setExpanded('diagram-options', false);
			this.inspectorOpen = true; this.relationSelection = id; this.host.render();
			this.controls.focusTabGroup('relation-inspector');
		});
	}

	async beginConnection(id: string): Promise<void> {
		try {
			const view = this.project.activeView;
			const elements = new Map(this.project.model.semantics.elements.map(element => [element.id, element]));
			const source = elements.get(id);
			if (!view || !source) { this.notifications.error(orditoErrorNotification(new Error('No source element selected'), 'edit', this.project.model)); return; }
			const version = this.project.documentVersion;
			const kinds = (Object.keys(relationLabels) as RelationKind[]).filter(kind => acceptsNotationRelation(view.kind, { kind }) && (view.kind !== 'state' || kind === 'transition') && (view.kind !== 'sequence' || ['invocation', 'read', 'write'].includes(kind))
				&& view.nodes.some(node => canConnectNodes(view, elements, kind, source, elements.get(node.elementId)!)));
			const kind = kinds.length === 1 ? kinds[0] : (await this.quick.pick(kinds.map(kind => ({ label: relationLabels[kind], kind })), { title: localize('ordito.relationType', "Relationship Type") }))?.kind;
			if (!kind || version !== this.project.documentVersion || view.id !== this.project.activeView?.id) { return; }
			this.controls.setExpanded('canvas-actions', false);
			this.controls.setExpanded('canvas-code-unavailable', false);
			this.inspectorOpen = false;
			this.pendingConnection = { from: id, kind, viewId: view.id, version }; this.host.render();
			this.controls.focusTarget('canvas');
		} catch (error) {
			this.reportError(error);
		}
	}

	async finishConnection(id: string): Promise<void> {
		try {
			const pending = this.pendingConnection;
			if (!pending) { return; }
			const view = this.project.activeView;
			const elements = new Map(this.project.model.semantics.elements.map(element => [element.id, element]));
			const from = elements.get(pending.from);
			const to = elements.get(id);
			if (pending.version !== this.project.documentVersion || view?.id !== pending.viewId || !from || !to) {
				this.pendingConnection = undefined;
				this.notifications.error(orditoErrorNotification(new Error('The project changed while creating the relationship.'), 'edit', this.project.model));
				this.host.render(); return;
			}
			if (!canConnectNodes(view, elements, pending.kind, from, to)) { this.notifications.error(orditoErrorNotification(new Error(pending.kind === 'transition' ? 'Unsupported resource transition' : 'Relationship cannot be included in this diagram'), 'edit', this.project.model)); return; }
			this.pendingConnection = undefined;
			this.canvas.clearConnectionPreview();
			const parent = this.host.root.closest<HTMLElement>('.monaco-workbench') ?? this.host.root.ownerDocument.body;
			const value = await editOrditoConnectionDetails(parent, localize('ordito.relation.endpoints', "{0} → {1}", from.name, to.name));
			if (!value) { this.host.render(); return; }
			if (pending.version !== this.project.documentVersion) { this.notifications.error(orditoErrorNotification(new Error('The project changed while creating the relationship.'), 'edit', this.project.model)); return; }
			this.project.edit({ kind: 'relation', id: generateUuid(), viewId: pending.viewId, from: pending.from, to: id, relationKind: pending.kind, ...value });
		} catch (error) {
			this.reportError(error);
		}
	}

	constructor(
		private readonly host: OrditoCanvasSurfaceHost,
		private readonly canvas: OrditoCanvasController,
		private readonly controls: OrditoControls,
		private readonly project: OrditoProjectService,
		private readonly commandService: ICommandService,
		private readonly quick: IQuickInputService,
		private readonly contextMenus: IContextMenuService,
		private readonly notifications: INotificationService
	) {
	}
}
