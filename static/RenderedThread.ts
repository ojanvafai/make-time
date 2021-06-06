import { Action } from './Actions.js';
import { assert, notNull } from './Base.js';
import { RenderedMessage } from './RenderedMessage.js';
import { Thread } from './Thread.js';
import { NEXT_FULL_ACTION, PREVIOUS_FULL_ACTION } from './views/ThreadListView.js';
import { NEXT_ACTION, PREVIOUS_ACTION } from './views/ThreadListViewBase.js';

// Kinda gross that we need to expose the typescript output directory in the
// code. :(
// @ts-expect-error TypeScript doesn't know about paintWorklet
if (CSS && CSS.paintWorklet) {
  // @ts-expect-error TypeScript doesn't know about paintWorklet
  CSS.paintWorklet.addModule('./gen/HeaderFocusPainter.js');
}

export class RenderedThread extends HTMLElement {
  private spinner_?: HTMLElement;
  private focused_: HTMLElement | null;
  private shouldFocusFirstUnreadOnNextRenderMessages_: boolean;

  constructor(public thread: Thread) {
    super();
    this.className = 'absolute mx-auto left-0 right-0 thread-text-color reading-max-width';
    this.focused_ = null;
    this.shouldFocusFirstUnreadOnNextRenderMessages_ = false;
  }

  isAttached() {
    return !!this.parentNode;
  }

  isRendered() {
    return this.isAttached() && this.style.visibility !== 'hidden';
  }

  showSpinner(show: boolean) {
    if (show) {
      this.spinner_ = document.createElement('div');
      this.spinner_.append('loading...');
      this.spinner_.style.cssText = `
        text-align: center;
        padding: 8px;
        background-color: var(--border-and-hover-color);
      `;
      this.append(this.spinner_);
      this.spinner_.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (this.spinner_) {
      this.spinner_.remove();
    }
  }

  async render() {
    let messages = this.thread.getMessages();
    let alreadyRenderedMessages = [...this.children].filter((x) => x.classList.contains('message'));
    for (let i = 0; i < messages.length; i++) {
      let quoteElidedMessage = await messages[i].getQuoteElidedMessage();
      if (this.contains(quoteElidedMessage)) continue;

      const rendered = new RenderedMessage(messages[i], quoteElidedMessage, {
        renderAsCard: true,
      });
      if (this.childElementCount == 0) rendered.style.border = '0';

      // In theory this should never happen, but it seems to in some cases.
      // Since we can't figure out what's causing it, do a workaround so the
      // messages at least render.
      if (i < alreadyRenderedMessages.length) {
        console.error('Had to rerender already rendered message.');
        alreadyRenderedMessages[i].replaceWith(rendered);
      } else {
        this.append(rendered);
      }
    }

    if (this.shouldFocusFirstUnreadOnNextRenderMessages_ && messages.length) {
      let rendered: Element | null | undefined = Array.from(this.children).find((x) =>
        x.classList.contains('unread'),
      );
      if (!rendered) {
        rendered = this.lastElementChild;
      }
      this.shouldFocusFirstUnreadOnNextRenderMessages_ = false;
      if (rendered) {
        this.focusMessage_(rendered, { block: 'center' });
      }
    }
  }

  queueFocusFirstUnreadOnNextRenderMessages() {
    this.shouldFocusFirstUnreadOnNextRenderMessages_ = true;
    this.render();
  }

  moveFocus(action: Action, options?: ScrollIntoViewOptions) {
    let message: Element | null;
    switch (action) {
      case NEXT_ACTION:
        message = notNull(this.focused_).nextElementSibling;
        if (!message) return;
        break;

      case NEXT_FULL_ACTION:
        message = notNull(this.lastElementChild);
        break;

      case PREVIOUS_ACTION:
        message = notNull(this.focused_).previousElementSibling;
        if (!message) return;
        break;

      case PREVIOUS_FULL_ACTION:
        message = notNull(this.firstElementChild);
        break;

      default:
        throw new Error('This should never happen.');
    }

    if (message) this.focusMessage_(message, options);
  }

  focusMessage_(message: Element, options?: ScrollIntoViewOptions) {
    this.clearFocus_();
    this.focused_ = message as HTMLElement;
    this.focused_.style.backgroundImage = 'paint(header-focus)';
    this.getHeader_(this.focused_).scrollIntoView(options);
  }

  private clearFocus_() {
    if (!this.focused_) return;
    this.focused_.style.backgroundImage = '';
  }

  getMessageFromHeader_(header: Element) {
    return notNull(notNull(header).parentElement);
  }

  getHeader_(message: Element) {
    let header = message.firstChild as HTMLElement;
    assert(header.classList.contains('headers'));
    return header;
  }
}
window.customElements.define('mt-rendered-thread', RenderedThread);
