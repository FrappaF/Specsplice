import { orditoErrorNotification } from '../browser/orditoErrors.js';
import { localize } from '../../../../nls.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { editorBackground, editorForeground, inputBackground } from '../../../../platform/theme/common/colorRegistry.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { EDITOR_DRAG_AND_DROP_BACKGROUND } from '../../../common/theme.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IChatService } from '../../chat/common/chatService/chatService.js';
import { IChatSessionsService } from '../../chat/common/chatSessionsService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ChatAgentLocation } from '../../chat/common/constants.js';
import { ChatWidget } from '../../chat/browser/widget/chatWidget.js';
import { type IChatWidget } from '../../chat/browser/chat.js';
import { OrditoAiDialog } from '../browser/orditoAiDialogView.js';
import { IOrditoAiDialogService, type OrditoAiDialogOptions } from '../browser/orditoAiDialog.js';
import { type CodeAiProgress } from '../common/codeBridge.js';
import { type DiagramExplorationBudget } from '../common/diagramExplorationBudget.js';
import { OrditoDiagramBudgetForm, type OrditoDiagramBudgetFormOptions } from '../browser/orditoDiagramBudgetForm.js';

/** Hosts native chat or the headless CLI inside the same temporary Specsplice modal. */
class OrditoAiDialogService extends Disposable implements IOrditoAiDialogService {
	declare readonly _serviceBrand: undefined;
	private readonly current = this._register(new MutableDisposable<DisposableStore>());
	private readonly budgetForm = this._register(new MutableDisposable<OrditoDiagramBudgetForm>());
	private dialog: OrditoAiDialog | undefined;
	private widget: IChatWidget | undefined;
	private resource: string | undefined;
	private closing: Promise<void> = Promise.resolve();

	async open(options: OrditoAiDialogOptions): Promise<IChatWidget | undefined> {
		await this.closing;
		if (this.dialog) {
			if (options.resource?.toString() === this.resource || options.resource && options.resource.toString() === this.widget?.viewModel?.sessionResource.toString()) { this.widget?.focusInput(); return this.widget; }
			await this.close();
		}
		const store = new DisposableStore(); this.current.value = store;
		this.resource = options.resource?.toString();
		const dialog = store.add(new OrditoAiDialog(this.layout.activeContainer, { ...options, onClose: () => this.closing = (async () => {
			const resources = new Map([options.resource, this.widget?.viewModel?.sessionResource].filter(resource => !!resource).map(resource => [resource.toString(), resource]));
			this.dialog = undefined; this.widget = undefined; this.resource = undefined;
			try {
				for (const resource of resources.values()) {
					await this.chatService.cancelCurrentRequestForSession(resource, 'ordito-dialog-close');
					try { if (!resource.path.startsWith('/untitled-')) { await this.sessions.deleteChatSessionItem(resource, CancellationToken.None); } }
					finally { await this.chatService.removeHistoryEntry(resource); }
				}
			} catch (error) { this.notifications.error(orditoErrorNotification(error, 'ai')); }
			finally { store.dispose(); if (this.current.value === store) { this.current.clear(); } await options.onClose(); }
		})() }));
		this.dialog = dialog;
		if (!options.resource) { dialog.showConversation(); return undefined; }
		try {
			const scoped = store.add(this.contextKeys.createScoped(dialog.content));
			const instantiation = store.add(this.instantiation.createChild(new ServiceCollection([IContextKeyService, scoped])));
			const widget = store.add(instantiation.createInstance(ChatWidget, ChatAgentLocation.Chat, undefined, {
				autoScroll: true, renderFollowups: true, supportsFileReferences: true, enableImplicitContext: false, enableWorkingSet: 'explicit',
			}, { listForeground: editorForeground, listBackground: editorBackground, overlayBackground: EDITOR_DRAG_AND_DROP_BACKGROUND, inputEditorBackground: inputBackground, resultEditorBackground: editorBackground }));
			this.widget = widget; widget.render(dialog.content); widget.setVisible(true);
			const observer = new ResizeObserver(() => widget.layout(dialog.content.clientHeight, dialog.content.clientWidth));
			store.add(toDisposable(() => observer.disconnect())); observer.observe(dialog.content);
			const reference = await this.chatService.acquireOrLoadSession(options.resource, ChatAgentLocation.Chat, dialog.token, 'OrditoAiDialog');
			if (!reference) { throw new Error(localize('ordito.ai.dialog.loadFailed', "Could Not Load the Assistant Session.")); }
			if (this.dialog !== dialog) { reference.dispose(); return undefined; }
			store.add(reference); widget.setModel(reference.object);
			widget.layout(dialog.content.clientHeight, dialog.content.clientWidth); widget.focusInput();
			return widget;
		} catch (error) { const cancelled = dialog.token.isCancellationRequested; await dialog.close(); if (cancelled) { return undefined; } throw error; }
	}

	async close(): Promise<void> { await this.dialog?.close(); }
	async editDiagramBudget(options: OrditoDiagramBudgetFormOptions): Promise<DiagramExplorationBudget | undefined> {
		if (this.budgetForm.value) { return undefined; }
		const form = this.budgetForm.value = new OrditoDiagramBudgetForm(this.layout.activeContainer, options);
		try { return await form.edit(); }
		finally { this.budgetForm.clear(); }
	}

	updateProgress(message: string): void { this.dialog?.updateProgress(message); }
	updateConversation(event: CodeAiProgress): void { this.dialog?.updateConversation(event); }

	constructor(
		@IInstantiationService private readonly instantiation: IInstantiationService,
		@IContextKeyService private readonly contextKeys: IContextKeyService,
		@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService,
		@IChatService private readonly chatService: IChatService,
		@IChatSessionsService private readonly sessions: IChatSessionsService,
		@INotificationService private readonly notifications: INotificationService
	) { super(); }
}

registerSingleton(IOrditoAiDialogService, OrditoAiDialogService, InstantiationType.Delayed);
