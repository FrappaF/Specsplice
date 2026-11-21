import { orditoInteractionRows } from './orditoInteractionContent.js';
import { localize } from '../../../../nls.js';
import { isSourceEvidenceModel } from '../common/modelFoundation.js';
import { notationRelationLabel } from '../common/modelNotation.js';
import { ModelView, SemanticModel, SemanticRelation } from '../common/modelTypes.js';
import { describeBlueprint } from './orditoBlueprintContent.js';
import { notationLines } from '../common/diagramLayout.js';
import { getDiagramGroups, getEditableScenario, getProjectedInteraction } from '../common/visualNavigation.js';
import { getSystemMap } from '../common/systemMap.js';
import { getSequenceDiagram } from '../common/sequenceDiagram.js';
import { orditoMessagingRows } from './orditoMessagingContent.js';
import { orditoStateRows } from './orditoStateContent.js';
import { getStateDiagram } from '../common/stateDiagram.js';
import { elementLabels, relationLabels, viewLabels } from './orditoLabels.js';
import { describeChangeImpact, describeRecordedEvidence } from './orditoImpactContent.js';

/** Presentation state only: reading the diagram never edits or saves its document. */
export interface OrditoReadingState {
	readonly model: SemanticModel;
	readonly activeView: ModelView | undefined;
	readonly selectedId: string;
	readonly section: 'home' | 'diagram' | 'element' | 'map' | 'impact';
	readonly loading: boolean;
	readonly error: string | undefined;
	readonly saveError: string | undefined;
	readonly dirty: boolean;
	readonly editable: boolean;
	readonly diagnostics: readonly string[];
	readonly hasStructuralErrors?: boolean;
	readonly hasDiagramErrors?: boolean;
}

/** Describe visible semantic identities rather than SVG geometry or inferred runtime behavior. */
export function describeOrditoDiagram(state: OrditoReadingState): string {
	const title = localize('ordito.reading.title', "Specsplice Visual Workbench");
	if (state.loading) { return [title, localize('ordito.reading.loading', "Loading model. No current diagram is available.")].join('\n'); }
	if (state.error) { return [title, state.error, localize('ordito.reading.recovery', "Use Retry or Open Model to recover.")].join('\n'); }
	if (state.hasDiagramErrors ?? state.hasStructuralErrors) { return [title, localize('ordito.reading.draft', "Draft Needs Correction. Saving and Undo remain available. Correct the model specification before using its diagrams."), ...state.diagnostics].join('\n'); }
	if (!state.loading && !state.error && isSourceEvidenceModel(state.model)) { return [title, localize('ordito.reading.sourceEvidence', "Source Evidence Ready. Choose Build Diagrams with AI to create capability and flow diagrams. Files and symbols have not yet been interpreted into a semantic model."), ...state.diagnostics].join('\n'); }
	if (state.section === 'home') {
		return [title, localize('ordito.reading.home', "Home. Open Project continues saved work. Create Project starts a new design. Import Codebase builds a local source inventory. Examples and Model Files contains standalone model files and the read-only purchase example."),
			localize('ordito.reading.planned', "Import Codebase prepares a local inventory. Explore Architecture opens the exploration. Review a draft before applying it locally. Model to Code Review prepares supported executable changes; verification, application, commit and push are separate steps."), ...state.diagnostics].join('\n');
	}
	const model = state.model;
	const elements = new Map(model.semantics.elements.map(element => [element.id, element]));
	const view = state.section === 'element' || state.section === 'impact' || state.section === 'map' ? undefined : state.activeView;
	const lines = [title, localize('ordito.reading.system', "System: {0}", model.name),
		state.editable ? (state.dirty ? localize('ordito.reading.dirty', "Unsaved Changes") : localize('ordito.reading.saved', "Saved")) : localize('ordito.reading.readonly', "Read-only"),
		localize('ordito.reading.intent', "Design intent. Conditions are declarations, not execution results.")];
	if (state.saveError) { lines.push(state.saveError); }
	lines.push(...state.diagnostics);
	if (state.section === 'impact') {
		if (elements.has(state.selectedId)) { lines.push(...describeChangeImpact(model, state.selectedId)); }
		return lines.join('\n');
	}
	const describeRelation = (relation: SemanticRelation): void => {
		lines.push(localize('ordito.reading.relation', "{0} to {1}: {2}. {3}", elements.get(relation.from)!.name, elements.get(relation.to)!.name, relationLabels[relation.kind], notationRelationLabel(relation)));
		if (relation.condition) { lines.push(localize('ordito.reading.condition', "Condition: {0}", relation.condition)); }
		if (relation.errorCode) { lines.push(localize('ordito.reading.error', "Error: {0}", relation.errorCode)); }
		if (relation.kind === 'transition') { lines.push(localize('ordito.reading.stateEvent', "Transition Event: {0}", relation.name || localize('ordito.reading.noEvent', "Not Declared"))); }
	};
	if (state.section === 'map') {
		const overview = getSystemMap(model);
		lines.push(localize('ordito.reading.map', "System Map. Groups follow semantic containment; connections summarize declared relationships."));
		if (!overview.branches.length) { lines.push(localize('ordito.reading.emptyMap', "This system has no elements.")); }
		for (const branch of overview.branches) {
			lines.push('', localize('ordito.reading.group', "Group: {0}", branch.root.name));
			for (const { element } of branch.members) {
				lines.push(localize('ordito.reading.mapElement', "{0} ({1}), parent: {2}", element.name, elementLabels[element.kind], element.parentId ? elements.get(element.parentId)!.name : model.name));
			}
		}
		for (const group of getDiagramGroups(model)) {
			for (const diagram of group.views) { lines.push(localize('ordito.reading.mapDiagram', "{0}: {1}", group.name, diagram.name)); }
		}
		for (const connection of overview.connections) {
			lines.push('', localize('ordito.reading.mapConnection', "{0} to {1}: {2} relationships", elements.get(connection.from)!.name, elements.get(connection.to)!.name, connection.relations.length));
			for (const relation of connection.relations) { describeRelation(relation); }
		}
		return lines.join('\n');
	}
	if (!view && state.section !== 'element') {
		lines.push(model.semantics.elements.some(element => element.kind === 'feature')
			? localize('ordito.reading.noDiagramsExistingFeatures', "This project has no diagrams. Add a diagram to an existing feature to continue.")
			: localize('ordito.reading.noDiagrams', "This project has no diagrams. Add a feature to begin."));
		return lines.join('\n');
	}
	const visible = new Set(view?.nodes.map(node => node.elementId) ?? []);
	if (view) {
		const group = getDiagramGroups(model).find(group => group.views.some(candidate => candidate.id === view.id));
		lines.push(localize('ordito.reading.diagram', "Diagram: {0}", view.name), group?.featureId
			? localize('ordito.reading.feature', "Feature: {0}", group.name) : localize('ordito.reading.systemDiagram', "System Diagram"));
		lines.push(localize('ordito.diagramType', "Diagram Type: {0}", viewLabels[view.kind]));
		if (view.kind === 'sequence' && !view.interactionId) { lines.push(localize('ordito.reading.sequence', "Declared sequence. Participants follow their left-to-right order; numbered messages follow this diagram's order, not observed execution. One occurrence per relationship; no inferred replies, timing or combined fragments.")); }
		if ((model.version === 4 || model.version === 5) && view.messagingId) { lines.push(...orditoMessagingRows(model, view.messagingId).map(row => row.text)); }
		if (view.kind === 'state' && (model.version === 4 || model.version === 5) && view.stateMachineId) { lines.push(...orditoStateRows(model, view.stateMachineId).map(row => row.text)); }
		if (view.kind === 'state' && !view.stateMachineId) {
			const lifecycle = getStateDiagram(model, view);
			lines.push(localize('ordito.reading.stateIntent', "Declared resource lifecycles, not observed runtime states. Events and guards are declarations; no initial or final state is inferred."));
			for (const group of lifecycle.groups) {
				lines.push(localize('ordito.reading.stateGroup', "Resource: {0}. Visible states: {1} of {2}. Visible transitions: {3}.", group.resource.name, group.states.length, group.allStates.length, group.transitions.length));
				for (const element of group.states) { lines.push(localize('ordito.reading.stateOwner', "State {0} belongs to resource {1}.", element.name, group.resource.name)); }
			}
			if (lifecycle.unscopedStates.length) { lines.push(localize('ordito.reading.unscopedStates', "States without a declared resource: {0}.", lifecycle.unscopedStates.map(element => element.name).join(', '))); }
			if (lifecycle.contextElements.length || lifecycle.contextRelations.length) { lines.push(localize('ordito.reading.stateContext', "Additional context: {0} elements and {1} relationships; all are preserved below.", lifecycle.contextElements.length, lifecycle.contextRelations.length)); }
		}
		lines.push('', localize('ordito.reading.elements', "Elements in This Diagram: {0}", view.nodes.length));
		for (const [index, node] of view.nodes.entries()) {
			const element = elements.get(node.elementId)!;
			lines.push(localize('ordito.reading.element', "{0}. {1} ({2})", index + 1, element.name, elementLabels[element.kind]));
			if (element.description) { lines.push(element.description); }
		lines.push(...notationLines(element));
		}
		if (!view.nodes.length) { lines.push(localize('ordito.reading.empty', "This diagram has no elements.")); }
	} else {
		const element = elements.get(state.selectedId);
		if (!element) { return lines.join('\n'); }
		lines.push(localize('ordito.reading.details', "Element Details: {0}", element.name), elementLabels[element.kind]);
		if (element.description) { lines.push(element.description); }
		lines.push(...notationLines(element));
		const children = model.semantics.elements.filter(child => child.parentId === element.id);
		if (children.length) { lines.push(localize('ordito.reading.children', "Contained Elements: {0}", children.map(child => child.name).join(', '))); }
		if (element.kind === 'feature') {
			const owned = getDiagramGroups(model).find(group => group.featureId === element.id)?.views ?? [];
			lines.push(localize('ordito.reading.featureDiagrams', "Feature Diagrams: {0}", owned.map(candidate => candidate.name).join(', ')));
		} else {
			const views = model.views.filter(candidate => candidate.nodes.some(node => node.elementId === element.id));
			if (views.length) { lines.push(localize('ordito.reading.perspectives', "Diagrams Containing This Element: {0}", views.map(candidate => candidate.name).join(', '))); }
			else { lines.push(localize('ordito.reading.unplaced', "This element is not placed in a diagram.")); }
		}
	}

	const relations = model.semantics.relations.filter(relation => view ? view.relationIds.includes(relation.id) : relation.from === state.selectedId || relation.to === state.selectedId);
	lines.push('', view ? localize('ordito.reading.relations', "Relationships in This Diagram: {0}", relations.length) : localize('ordito.reading.detailRelations', "Related Relationships: {0}", relations.length));
	if ((view?.kind === 'sequence' || view?.kind === 'activity') && (model.version === 4 || model.version === 5) && view.interactionId) {
		lines.push(localize('ordito.reading.scenario', "Declared scenario. Occurrences, conditions and explicit partial order describe intent; they do not establish observed execution."));
		lines.push(...orditoInteractionRows(model, view.interactionId).map(row => `${'  '.repeat(row.depth)}${row.text}`));
	} else if (view?.kind === 'sequence') {
		const sequence = getSequenceDiagram(model, view);
		for (const [index, relation] of sequence.messages.entries()) {
			lines.push(localize('ordito.reading.messageNumber', "Message {0}", index + 1));
			describeRelation(relation);
		}
		for (const relation of sequence.unsupported) {
			lines.push(localize('ordito.reading.unsupportedMessage', "Not Rendered as a Sequence Message:"));
			describeRelation(relation);
		}
	} else { for (const relation of relations) { describeRelation(relation); } }
	if ((model.version === 4 || model.version === 5)) {
		for (const elementId of view ? view.nodes.map(node => node.elementId) : [state.selectedId]) { lines.push(...describeBlueprint(model, elementId)); }
	}
	const selected = state.section === 'element' || visible.has(state.selectedId) ? elements.get(state.selectedId) : undefined;
	if (selected) {
		lines.push('', localize('ordito.reading.selected', "Selected Element: {0}", selected.name));
		if (selected.parentId) { lines.push(localize('ordito.reading.parent', "Parent: {0}", elements.get(selected.parentId)!.name)); }
		if (selected.behavior) {
			for (const field of selected.behavior.inputs) { lines.push(localize('ordito.reading.input', "Input: {0} ({1}), {2}", field.name, field.type, field.required ? localize('ordito.reading.required', "Required") : localize('ordito.reading.optional', "Optional"))); }
			for (const field of selected.behavior.outputs) { lines.push(localize('ordito.reading.output', "Output: {0} ({1}), {2}", field.name, field.type, field.required ? localize('ordito.reading.required', "Required") : localize('ordito.reading.optional', "Optional"))); }
			for (const condition of selected.behavior.preconditions) { lines.push(localize('ordito.reading.precondition', "Precondition: {0}", condition)); }
			for (const condition of selected.behavior.postconditions) { lines.push(localize('ordito.reading.postcondition', "Postcondition: {0}", condition)); }
			for (const error of selected.behavior.errors) { lines.push(localize('ordito.reading.behaviorError', "Error {0}: {1}", error.code, error.description)); }
			for (const permission of selected.behavior.permissions) { lines.push(localize('ordito.reading.permission', "Authorization: {0}, {1}", elements.get(permission.actorId)!.name, permission.capability)); }
			for (const criterion of selected.behavior.acceptanceCriteria) { lines.push(localize('ordito.reading.criterion', "Given {0}, when {1}, then {2}.", criterion.given, criterion.when, criterion.then)); }
		}
		const related = view ? model.semantics.relations.filter(relation => !view.relationIds.includes(relation.id) && (relation.from === selected.id || relation.to === selected.id)) : [];
		if (related.length) {
			lines.push(localize('ordito.reading.otherRelations', "Other Relationships of the Selected Element, Not Shown in This Diagram:"));
			for (const relation of related) { describeRelation(relation); }
		}
		lines.push(localize('ordito.reading.evidence', "Code mappings: {0}. Verification records: {1}.", model.codeMappings.filter(mapping => mapping.elementId === selected.id).length, model.verifications.filter(verification => verification.elementId === selected.id).length));
		lines.push(...describeRecordedEvidence(model, selected.id));
	}
	return lines.join('\n');
}

/** Keyboard guidance uses native keybinding placeholders, resolved by Accessible View. */
export function describeOrditoHelp(state: OrditoReadingState): string {
	const interaction = state.activeView && getProjectedInteraction(state.model, state.activeView);
	const scenario = state.activeView && getEditableScenario(state.model, state.activeView);
	return [localize('ordito.help.title', "Specsplice Accessibility Help"),
		localize('ordito.help.groups', "System and feature groups in the sidebar expand or collapse with Enter or Space on their summary. Their state is saved separately for each project document. Related Diagrams links to diagrams containing a feature's descendants without changing the diagram's owner. Choosing an element keeps the sidebar controls in place."),
		localize('ordito.help.map', "System Map is a layered atlas of actors, areas, features and elements, including objects not placed in diagrams. Click an object to add a cumulative filter; its separate arrow opens a lower level. Each filter has its own remove button. Filters remain active when changing levels or pages. Search finds objects throughout the system. Inspect opens element details, and diagram buttons open their views. Relationships expands to show original directed relationships, conditions and source and target buttons. The system breadcrumb opens the map. Read System Map reads the complete semantic model; Back and Forward include the map."),
		localize('ordito.help.semanticNavigation', "Search System filters elements and diagrams by type and searches names, ancestry and diagram names. Unplaced elements open Element Details. The Semantic Path opens ancestor details; Back and Forward restore navigation within the current project. Diagrams Containing This Element changes perspective while preserving the selected identity."),
		localize('ordito.help.navigation', "The diagram fills the editor. Open Project and Diagrams are in the canvas header; More Actions opens secondary controls. Tab and Shift+Tab move between controls, elements, relationships and floating properties. Enter or Space activates a button or opens an options section. Escape closes properties. Focus the background and use arrow keys to pan, or Home to fit; Control or Command plus scroll zooms at the pointer."),
		localize('ordito.help.behavior', "Edit Behavioral Contract in Properties edits inputs, outputs, preconditions, postconditions and errors through native choices. Escape cancels the current entry. Each completed change can be undone. Edit Relationship Error assigns or clears a declared source error; clear references before removing or renaming an error."),
		localize('ordito.help.sequence', "Sequence diagrams show participants and ordered declared messages. Add Existing Message reuses an invocation, read or write and includes its endpoints. Participant positions are derived from their order. Use the background to pan and Fit Diagram to zoom."),
		localize('ordito.help.states', "State diagrams group declared states by their resource. Add State creates a state for a resource in the diagram; Add Existing State and Add Existing Transition reuse identities. Include Resource Lifecycle adds the resource's declared states and transitions without moving existing nodes. Transition Table lists sources, targets, events, conditions and errors. Properties edits shared events and contracts; removing a state or relationship from the diagram preserves the system and other views. Initial/final states, nested states and execution are not inferred."),
		localize('ordito.help.impact', "Show Change Impact in Properties reviews containment, reverse directed relationships and authorization references. Each potential dependent includes a reason; ownership context is separate. Follow elements and diagrams with Enter or Space. Recorded Evidence preserves every code reference, outcome and revision without establishing current implementation or freshness. Read Change Impact reads the current report; Back and Forward include this view."),
		localize('ordito.help.reading', "Use <keybinding:editor.action.accessibleView> to read the current diagram as text. The view includes elements, relationships, conditions and details of the selected element. Escape returns to the previous control."),
		state.section === 'home'
			? localize('ordito.help.home', "On Home, choose Open Project, Create Project or Import Codebase. Examples and Model Files contains additional help. A new empty project offers Add Pure Quantity Feature or Design a Feature from Scratch.")
			: localize('ordito.help.selection', "Focus an element and press Enter or Space to select it and update Properties. Each diagram keeps its own selection."),
		state.loading ? localize('ordito.help.loading', "The model is loading. Wait for it to finish before selecting or editing elements.")
			: state.error ? localize('ordito.help.invalid', "The model is unavailable or invalid. Use Retry or Open Model. The previous diagram is not current.")
			: state.section === 'impact' ? localize('ordito.help.impactContext', "You are reviewing model change impact. The report updates with the current document and does not edit the model or run tests. Inspect Recorded Evidence opens metadata; its paths are not executed. Element Details returns to the selected identity.")
			: state.section === 'element' ? localize('ordito.help.details', "You are in Element Details. Follow relationships or contained elements, or choose a diagram containing this element. Writable projects allow renaming, description changes, behavioral contract editing and deletion from the Properties actions.")
			: state.editable && scenario ? localize('ordito.help.scenarioContext', "Use Add Element or Add Existing Element to add participants. Select a participant, step or branch with Enter or Space to see its editing actions in Properties. Open the Diagram menu and choose Edit Scenario to change the linked flow. Changes appear in all diagrams linked to this scenario.")
			: state.editable && interaction?.execution ? localize('ordito.help.executableInteractionContext', "Select a participant or step with Enter or Space to see its properties. Open the Diagram menu and choose Edit Executable Interaction to change the linked behavior.")
			: state.editable && state.activeView?.kind === 'sequence' ? localize('ordito.help.sequenceContext', "Select a participant or message with Enter or Space. Participants are ordered from Properties rather than dragged. Sequence Message Options orders or removes message occurrences. Message conditions and errors remain shared across all diagrams.")
			: state.editable
			? localize('ordito.help.editing', "Arrow keys move the focused element. Shift increases the step. Focus the diagram background to pan with arrow keys. Add Element creates an element; Connect Selection creates a compatible relationship.")
			: localize('ordito.help.readonly', "Editing is unavailable in the read-only example or a read-only file. Open a writable project to edit. Focus the diagram background to pan with arrow keys."),
		localize('ordito.help.options', "More Actions contains editing and Diagram Options. Project Actions contains Reload Project, Save Project Copy and Diagram Navigation, which reopens the sidebar. AI Settings is separate from project tasks. Spread Out arranges the diagram with more space; Fit Diagram adapts it to the available area. Select an element and open Details and Actions for its shared contract and secondary operations."),
		localize('ordito.help.commands', "Open the Command Palette with <keybinding:workbench.action.showCommands> for all Specsplice commands. Save with <keybinding:workbench.action.files.save>, undo with <keybinding:undo>, and redo with <keybinding:redo>."),
		localize('ordito.help.recovery', "Save Project Copy preserves the original file and visual context. Reload Project asks before discarding unsaved changes. Save errors remain visible; an invalid model hides the previous diagram until it is repaired."),
		localize('ordito.help.tools', "Files, Terminal, Debug and Git open technical tools. Return to Model (<keybinding:ordito.showDiagram>) returns to the same diagram, map or element details and selection."),
		localize('ordito.help.limits', "The model describes design intent. Conditions do not execute code. Import Codebase first analyzes source evidence; Build Diagrams with AI interprets it using the chosen model. Update Code proposes code changes for review. Chat with Codex opens the connected account conversation; Update Diagrams refreshes the model after source changes. AI output requires review.")].join('\n\n');
}
