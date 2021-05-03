import { Message } from './Message.js';
import { RenderedMessage } from './RenderedMessage.js';
import { Thread, UpdatedEvent } from './Thread.js';
import { LabelState, ThreadRow } from './views/ThreadRow.js';

export class RenderedCard extends HTMLElement {
  private boundRender_: () => void;

  constructor(public thread: Thread) {
    super();
    this.className =
      'absolute left-align reading-max-width p2 break-word card-shadow flex flex-column mx-auto thread-background-color';
    this.style.cssText = `
      top: 20px;
      right: 20px;
      bottom: 20px;
      left: 20px;
    `;
    this.boundRender_ = this.handleThreadUpdated_.bind(this);
  }

  connectedCallback() {
    this.thread.addEventListener(UpdatedEvent.NAME, this.boundRender_);
  }

  disconnectedCallback() {
    this.thread.removeEventListener(UpdatedEvent.NAME, this.boundRender_);
  }

  private handleThreadUpdated_() {
    this.render();
  }

  private async renderMessage_(message: Message) {
    const rendered = new RenderedMessage(message, await message.getQuoteElidedMessage());
    rendered.style.flex = '1';
    rendered.style.overflow = 'hidden';
    return rendered;
  }

  async render() {
    const messages = this.thread.getMessages();
    if (!messages.length) {
      return;
    }

    this.textContent = '';

    let labelContainer = document.createElement('div');
    labelContainer.className = 'ml2';
    let labelState = new LabelState(this.thread, '');
    ThreadRow.appendLabels(labelContainer, labelState, this.thread);
    this.append(labelContainer);

    const subject = document.createElement('div');
    subject.className = 'strongest p1 flex items-center';
    subject.append(this.thread.getSubject(), labelContainer);
    this.append(subject, await this.renderMessage_(messages[0]));

    if (messages.length > 1) {
      const divider = document.createElement('div');
      divider.className = 'p1 border-top border-bottom center';
      divider.textContent = messages.length > 2 ? `${messages.length - 2} more messages` : '\xA0';
      this.append(divider, await this.renderMessage_(messages[messages.length - 1]));
    }
  }
}
window.customElements.define('mt-rendered-card', RenderedCard);
