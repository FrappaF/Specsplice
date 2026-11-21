import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { isSourceEvidenceModel } from '../common/modelFoundation.js';
import { OrditoProjectService, IOrditoProjectService } from './orditoProjectService.js';

export class OrditoInput extends EditorInput {
	static readonly ID = 'workbench.editor.ordito';
	static readonly RESOURCE = URI.from({ scheme: 'ordito-home', path: '/home' });
	private restoredName: string | undefined;
	constructor(@IOrditoProjectService private readonly project: OrditoProjectService) {
		super();
		this._register(project.onDidChange(() => {
			this._onDidChangeLabel.fire();
			this._onDidChangeDirty.fire();
			this._onDidChangeCapabilities.fire();
		}));
	}
	override get typeId(): string { return OrditoInput.ID; }
	override get editorId(): string { return OrditoInput.ID; }
	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Singleton | (this.project.editable ? 0 : EditorInputCapabilities.Readonly);
	}
	override isDirty(): boolean { return this.project.dirty; }
	override async save(): Promise<EditorInput | undefined> { return await this.project.save(true) ? this : undefined; }
	override async saveAs(): Promise<EditorInput | undefined> { return await this.project.saveAs() ? this : undefined; }
	override async revert(): Promise<void> { await this.project.revert(); }
	readonly resource = OrditoInput.RESOURCE;
	restoreName(name: string): void { this.restoredName = name === 'Ordito Home' || name === 'A.D.E Home' ? undefined : name; }
	override getName(): string {
		if (this.project.restoringContext) { return this.restoredName ?? localize('ordito.home', "Specsplice Home"); }
		if (!this.project.loading && !this.project.error && isSourceEvidenceModel(this.project.model)) { return localize('ordito.import.title', "Create Diagrams: {0}", this.project.model.name); }
		if (this.project.section === 'map' && !this.project.error && !this.project.loading) { return localize('ordito.map.name', "System Map: {0}", this.project.model.name); }
		if (this.project.section === 'impact' && !this.project.error && !this.project.loading) {
			return localize('ordito.impact.name', "Change Impact: {0}", this.project.model.semantics.elements.find(element => element.id === this.project.selectedId)?.name ?? this.project.model.name);
		}
		if (this.project.section === 'element' && !this.project.error && !this.project.loading) {
			return this.project.model.semantics.elements.find(element => element.id === this.project.selectedId)?.name ?? this.project.model.name;
		}
		return this.project.section === 'diagram' && !this.project.error && !this.project.loading
			? this.project.activeView?.name ?? this.project.model.name : localize('ordito.home', "Specsplice Home");
	}
	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return super.matches(other) || other instanceof OrditoInput;
	}
}
