import './media/ordito.css';
import * as dom from '../../../../base/browser/dom.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { OrditoControls } from './orditoControls.js';
import { describeOrditoError } from './orditoErrors.js';
import { renderOrditoErrorNotice } from './orditoErrorNotice.js';
import { type OrditoAiDialogOptions, type OrditoAiMessage } from './orditoAiDialog.js';
import { type CodeAiProgress } from '../common/codeBridge.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import '../../../../base/browser/ui/codicons/codicon/codicon-modifiers.css';

/** A transient, focus-trapping surface. Only generated project artifacts outlive its closure. */
export class OrditoAiDialog extends Disposable {
	readonly element: HTMLDialogElement;
	readonly content: HTMLElement;
	get token() { return this.cancellation.token; }
	private readonly cancellation = this._register(new CancellationTokenSource());
	private readonly restoreFocus = OrditoControls.captureActiveFocus();
	private closed = false;
	private progress: HTMLElement | undefined;
	private executionStatus: HTMLElement | undefined;
	private transcript: HTMLElement | undefined;
	private turnActive = false;
	private readonly responses = new Map<string, { text: string; element: HTMLElement }>();
	private readonly messages: OrditoAiMessage[] = [];
	private readonly errorControls = this._register(new OrditoControls());

	constructor(parent: HTMLElement, private readonly options: OrditoAiDialogOptions) {
		super();
		this.element = dom.append(parent, dom.$<HTMLDialogElement>('dialog.ordito-ai-dialog'));
		this.element.setAttribute('aria-label', localize('ordito.ai.dialog.title', "Specsplice Assistant"));
		const header = dom.append(this.element, dom.$('header.ordito-ai-dialog-header'));
		dom.append(header, dom.$('h2')).textContent = localize('ordito.ai.dialog.title', "Specsplice Assistant");
		const close = dom.append(header, dom.$<HTMLButtonElement>('button'));
		close.type = 'button'; close.textContent = localize('ordito.ai.dialog.close', "Close");
		this._register(dom.addDisposableListener(close, 'click', () => { void this.close(); }));
		dom.append(this.element, dom.$('p.ordito-ai-dialog-hint')).textContent = localize('ordito.ai.dialog.transient', "This conversation resets when closed. Prepared diagrams stay in your project and update automatically.");
		this.content = dom.append(this.element, dom.$('div.ordito-ai-dialog-content'));
		this._register(dom.addDisposableListener(this.element, 'cancel', event => { event.preventDefault(); void this.close(); }));
		this.element.showModal();
	}

	showConversation(): void {
		const transcript = dom.append(this.content, dom.$('div.ordito-ai-transcript'));
		this.transcript = transcript;
		transcript.setAttribute('role', 'log'); transcript.setAttribute('aria-live', 'polite');
		const status = dom.append(this.content, dom.$('p.ordito-ai-dialog-status')); status.setAttribute('role', 'status');
		this.executionStatus = status;
		this.progress = dom.append(this.content, dom.$('p.ordito-ai-dialog-status'));
		const errors = dom.append(this.content, dom.$('div.ordito-ai-dialog-error'));
		const clearError = () => this.errorControls.render(errors, () => dom.clearNode(errors));
		const form = dom.append(this.content, dom.$<HTMLFormElement>('form.ordito-ai-composer'));
		const input = dom.append(form, dom.$<HTMLTextAreaElement>('textarea'));
		input.setAttribute('aria-label', localize('ordito.ai.dialog.message', "Message the Assistant")); input.rows = 3;
		input.placeholder = localize('ordito.ai.dialog.placeholder', "Describe the diagrams or changes you need…");
		input.setAttribute('aria-description', localize('ordito.ai.dialog.keyboard', "Enter to Send. Shift+Enter for a New Line."));
		input.value = this.options.prompt ?? '';
		const send = dom.append(form, dom.$<HTMLButtonElement>('button')); send.type = 'submit'; send.textContent = localize('ordito.ai.dialog.send', "Send");
		const setSending = (active: boolean) => {
			send.disabled = active || !input.value.trim() || !this.options.send; send.setAttribute('aria-busy', String(active)); dom.clearNode(send);
			if (active) { const icon = renderIcon(ThemeIcon.modify(Codicon.loading, 'spin')); icon.setAttribute('aria-hidden', 'true'); send.appendChild(icon); }
			dom.append(send, dom.$('span')).textContent = active ? localize('ordito.ai.dialog.sending', "Working…") : localize('ordito.ai.dialog.send', "Send");
		};
		this._register(dom.addDisposableListener(input, 'input', () => { send.disabled = this.turnActive || !input.value.trim() || !this.options.send; }));
		setSending(false);
		this._register(dom.addDisposableListener(input, 'keydown', (event: KeyboardEvent) => {
			if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) { return; }
			event.preventDefault(); event.stopPropagation();
			if (!event.repeat && !send.disabled) { form.requestSubmit(send); }
		}));
		const append = (message: OrditoAiMessage) => {
			const article = dom.append(transcript, dom.$('article.ordito-ai-message'));
			dom.append(article, dom.$('strong')).textContent = message.role === 'user' ? localize('ordito.ai.dialog.you', "You") : localize('ordito.ai.dialog.assistant', "Assistant");
			dom.append(article, dom.$('div')).textContent = message.text;
			transcript.scrollTop = transcript.scrollHeight;
		};
		this._register(dom.addDisposableListener(form, 'submit', async event => {
			event.preventDefault();
			const text = input.value.trim();
			if (!text || send.disabled || !this.options.send) { return; }
			this.messages.push({ role: 'user', text }); append(this.messages[this.messages.length - 1]); input.value = '';
			setSending(true); input.disabled = true; this.content.setAttribute('aria-busy', 'true');
			this.turnActive = true; this.responses.clear(); clearError();
			status.setAttribute('role', 'status');
			status.textContent = localize('ordito.ai.dialog.working', "Working… You Can Close This Dialog to Stop. Completed Drafts Are Saved.");
			try {
				const response = await this.options.send(structuredClone(this.messages), this.cancellation.token);
				if (this.closed) { return; }
				this.messages.push({ role: 'assistant', text: response });
				if (![...this.responses.values()].some(item => item.text.trimEnd() === response.trimEnd())) { append(this.messages[this.messages.length - 1]); }
				status.textContent = '';
			} catch (error) {
				if (!this.closed) {
					status.textContent = '';
					this.errorControls.render(errors, () => { dom.clearNode(errors); renderOrditoErrorNotice(errors, describeOrditoError(error, 'ai'), this.errorControls); });
				}
			} finally {
				this.turnActive = false;
				if (!this.closed) { setSending(false); input.disabled = false; this.content.setAttribute('aria-busy', 'false'); input.focus(); }
			}
		}));
		input.focus();
	}

	updateProgress(message: string): void { if (!this.closed && this.progress) { this.progress.textContent = message; } }

	updateConversation(event: CodeAiProgress): void {
		if (this.closed || !this.turnActive || !this.executionStatus || !this.transcript) { return; }
		if (event.kind === 'message' && event.text) {
			const id = event.itemId ?? 'response';
			let item = this.responses.get(id);
			if (!item) {
				const article = dom.append(this.transcript, dom.$('article.ordito-ai-message'));
				dom.append(article, dom.$('strong')).textContent = localize('ordito.ai.dialog.assistant', "Assistant");
				item = { text: '', element: dom.append(article, dom.$('div')) }; this.responses.set(id, item);
			}
			item.text = event.text; item.element.textContent = event.text;
			this.transcript.scrollTop = this.transcript.scrollHeight;
		}
		const tools: Record<string, string> = {
			ordito_project_inspect: localize('ordito.ai.progress.inspect', "Inspecting the Project and Saved Drafts…"),
			ordito_source_search: localize('ordito.ai.progress.search', "Searching Project Sources…"),
			ordito_source_read: localize('ordito.ai.progress.read', "Reading Project Sources…"),
			ordito_feature_catalog: localize('ordito.ai.progress.features', "Saving the Identified Features…"),
			ordito_diagram_plan: localize('ordito.ai.progress.plan', "Planning the Next Diagrams…"),
			ordito_model_query: localize('ordito.ai.progress.reuse', "Checking the Shared Model…"),
			ordito_model_propose: localize('ordito.ai.progress.propose', "Preparing a Diagram Draft…"),
			ordito_view_preview: localize('ordito.ai.progress.preview', "Checking a Diagram Preview…"),
			ordito_proposal_discard: localize('ordito.ai.progress.discard', "Archiving an Obsolete Invalid Draft…")
		};
		this.executionStatus.textContent = event.kind === 'connecting' ? localize('ordito.ai.progress.connect', "Connecting to the Assistant and Project Tools…") : event.kind === 'waiting' ? localize('ordito.ai.progress.waiting', "The Provider Connection Was Interrupted. Waiting for Its Retry… You Can Close the Assistant to Stop.") : event.kind === 'tool' ? tools[event.tool ?? ''] ?? localize('ordito.ai.progress.tool', "Updating Project Diagrams…") : localize('ordito.ai.progress.thinking', "Waiting for the Assistant…");
	}

	async close(): Promise<void> {
		if (this.closed) { return; }
		this.closed = true; this.cancellation.cancel(); this.messages.length = 0;
		this.element.close(); this.element.remove();
		try { await this.options.onClose(); }
		finally { this.dispose(); this.restoreFocus(); }
	}

	override dispose(): void {
		this.cancellation.cancel(); this.element.remove(); this.messages.length = 0;
		super.dispose();
	}
}
