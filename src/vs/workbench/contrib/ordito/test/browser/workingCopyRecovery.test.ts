import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IEditorIdentifier, IEditorPane } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IFilesConfigurationService } from '../../../../services/filesConfiguration/common/filesConfigurationService.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { IWorkingCopyBackupService } from '../../../../services/workingCopy/common/workingCopyBackup.js';
import { WorkingCopyBackupTracker } from '../../../../services/workingCopy/common/workingCopyBackupTracker.js';
import { IWorkingCopyEditorHandler, WorkingCopyEditorService } from '../../../../services/workingCopy/common/workingCopyEditorService.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';

class RecoveryTracker extends WorkingCopyBackupTracker {
	protected override onFinalBeforeShutdown(): boolean { return false; }
	restoreWith(handler: IWorkingCopyEditorHandler): Promise<void> { return this.restoreBackups(handler); }
}

suite('Specsplice working copy recovery', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	test('a generic backup handler reuses the specialized editor association', async () => {
		const identifier = { resource: URI.parse('test:/project/.ordito/model.json'), typeId: '' };
		const visual = store.add(new class extends EditorInput {
			override readonly typeId = 'visual-test';
			override readonly resource = URI.parse('visual:/home');
		}());
		let opened = 0;
		const editors = new class extends mock<IEditorService>() {
			override getEditors(): IEditorIdentifier[] { return [{ editor: visual, groupId: 1 }]; }
			override isVisible(): boolean { return true; }
			override async openEditors(): Promise<IEditorPane[]> { opened++; return []; }
		}();
		const associations = store.add(new WorkingCopyEditorService(editors));
		const specialized: IWorkingCopyEditorHandler = {
			handles: copy => copy.resource.toString() === identifier.resource.toString(),
			isOpen: (copy, editor) => copy.resource.toString() === identifier.resource.toString() && editor === visual,
			createEditor: () => visual
		};
		store.add(associations.registerHandler(specialized));
		let created = 0;
		const generic: IWorkingCopyEditorHandler = { handles: () => true, isOpen: () => false, createEditor: () => { created++; return visual; } };
		const backups = new class extends mock<IWorkingCopyBackupService>() { override async getBackups() { return [identifier]; } }();
		const copies = new class extends mock<IWorkingCopyService>() {
			override readonly modifiedWorkingCopies = [];
			override readonly onDidRegister = Event.None;
			override readonly onDidUnregister = Event.None;
			override readonly onDidChangeDirty = Event.None;
			override readonly onDidChangeContent = Event.None;
		}();
		const lifecycle = new class extends mock<ILifecycleService>() {
			override readonly onBeforeShutdown = Event.None;
			override readonly onWillShutdown = Event.None;
			override async when(): Promise<void> { }
		}();
		const tracker = store.add(new RecoveryTracker(backups, copies, new NullLogService(), lifecycle, new (mock<IFilesConfigurationService>())(), associations, editors));
		await tracker.restoreWith(generic);
		assert.deepStrictEqual({ created, opened, editor: associations.findEditor(identifier)?.editor }, { created: 0, opened: 0, editor: visual });
	});
});
