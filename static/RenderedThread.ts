import {Action} from './Actions.js';
import {assert, defined, notNull} from './Base.js';
import {Message} from './Message.js';
import {Thread} from './Thread.js';
import {NEXT_ACTION, NEXT_FULL_ACTION, PREVIOUS_ACTION, PREVIOUS_FULL_ACTION} from './views/ThreadListView.js';

let formattingOptions: {
  year?: string;
  month?: string;
  day?: string;
  hour?: string;
  minute?: string;
} = {
  hour: 'numeric',
  minute: 'numeric',
}

let SAME_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, formattingOptions);

formattingOptions.month = 'short';
formattingOptions.day = 'numeric';

let DIFFERENT_DAY_FORMATTER =
    new Intl.DateTimeFormat(undefined, formattingOptions);

formattingOptions.year = 'numeric';
let DIFFERENT_YEAR_FORMATTER =
    new Intl.DateTimeFormat(undefined, formattingOptions);

// Kinda gross that we need to expose the typescript output directory in the
// code. :(
// @ts-ignore
if (CSS && CSS.paintWorklet)
  // @ts-ignore
  CSS.paintWorklet.addModule('./gen/HeaderFocusPainter.js');

export class RenderedThread extends HTMLElement {
  private spinner_?: HTMLElement;
  private focused_: HTMLElement|null;

  constructor(public thread: Thread) {
    super();
    this.style.cssText = `
      background-color: white;
      position: absolute;
      left: 0;
      right: 0;
      max-width: 1000px;
    `;
    this.focused_ = null;
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
        background: #ddd;
      `;
      this.append(this.spinner_);
      this.spinner_.scrollIntoView({'block': 'center', 'behavior': 'smooth'});
    } else if (this.spinner_) {
      this.spinner_.remove();
    }
  }

  render() {
    let messages = this.thread.getMessages();
    let alreadyRenderedMessages =
        [...this.children].filter(x => x.classList.contains('message'));
    // Only append new messages.
    messages = messages.slice(alreadyRenderedMessages.length);
    for (let message of messages) {
      let rendered = this.renderMessage_(message);
      if (this.childElementCount == 0)
        rendered.style.border = '0';
      this.append(rendered);
    }
  }

  focusFirstUnread() {
    let messages = Array.from(this.children);
    let message = messages.find(x => x.classList.contains('unread'));

    if (!message) {
      // lastElementChild is null if if we try to render a thread before we have
      // ever fetched its message data.
      // TODO: Queue up the focus so that we call focusFirstUnread once the
      // messages have loaded.
      if (!this.lastElementChild)
        return;
      message = this.lastElementChild;
    }

    this.focusMessage_(message, {'block': 'center'});
  }

  moveFocus(action: Action, options?: ScrollIntoViewOptions) {
    let message: Element|null;
    switch (action) {
      case NEXT_ACTION:
        message = this.getMessageFromHeader_(notNull(this.focused_))
                      .nextElementSibling;
        if (!message)
          return;
        break;

      case NEXT_FULL_ACTION:
        message = notNull(this.lastElementChild);
        break;

      case PREVIOUS_ACTION:
        message = this.getMessageFromHeader_(notNull(this.focused_))
                      .previousElementSibling;
        if (!message)
          return;
        break;

      case PREVIOUS_FULL_ACTION:
        message = notNull(this.firstElementChild);
        break;

      default:
        throw new Error('This should never happen.');
    }

    if (message)
      this.focusMessage_(message, options);
  }

  focusMessage_(message: Element, options?: ScrollIntoViewOptions) {
    this.clearFocus_();
    this.focused_ = this.getHeader_(defined(message));
    this.focused_.style.backgroundImage = 'paint(header-focus)';
    this.focused_.scrollIntoView(options);
  }

  private clearFocus_() {
    if (!this.focused_)
      return;
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

  renderMessage_(processedMessage: Message) {
    var messageDiv = document.createElement('div');
    messageDiv.style.cssText = `
      padding: 0 8px;
      word-break: break-word;
    `;
    messageDiv.className = 'message';
    messageDiv.classList.add(processedMessage.isUnread ? 'unread' : 'read');

    let rightItems = document.createElement('div');
    rightItems.classList.add('date');
    let date = document.createElement('div');
    date.append(this.dateString_(processedMessage.date));
    rightItems.append(date);

    var headerDiv = document.createElement('div');
    headerDiv.classList.add('headers');
    headerDiv.style.cssText = `
      background-color: #ddd;
      padding: 8px;
      margin: 0 -8px;
      border-top: 1px solid;
      white-space: pre-wrap;
      color: grey;
      display: flex;
    `;

    let from = document.createElement('div');
    from.style.cssText = `color: #000000bb`;

    if (processedMessage.parsedFrom.length) {
      let parsed = processedMessage.parsedFrom[0];
      if (parsed.name) {
        let b = document.createElement('b');
        b.append(parsed.name);
        from.append(b, ' <', parsed.address, '>');
      } else {
        from.append(parsed.address);
      }
    }

    let to = document.createElement('div');
    to.style.cssText = `
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
    `;

    let expander = document.createElement('span');
    expander.classList.add('expander');
    expander.style.cssText = `
      padding: 0 3px;
      user-select: none;
      float: right;
    `;
    expander.onclick = () => {
      let existing = window.getComputedStyle(to).webkitLineClamp;
      // Wow. Setting this to 'none' doens't work. But setting it to 'unset'
      // returns 'none' from computed style.
      to.style.webkitLineClamp = existing == 'none' ? '1' : 'unset';
    };
    expander.append('▾');
    rightItems.append(expander);

    if (processedMessage.to)
      this.appendAddresses_(to, 'to', processedMessage.to);
    if (processedMessage.cc)
      this.appendAddresses_(to, 'cc', processedMessage.cc);
    if (processedMessage.bcc)
      this.appendAddresses_(to, 'bcc', processedMessage.bcc);

    let addressContainer = document.createElement('div');
    addressContainer.style.cssText = `flex: 1;`;
    addressContainer.append(from, to);

    headerDiv.append(addressContainer, rightItems);

    if (processedMessage.isDraft) {
      let draft = document.createElement('div');
      draft.style.cssText = `
        color: #000000bb;
        font-weight: bold;
        margin-top: 10px;
      `;
      draft.append('DRAFT MESSAGE');
      headerDiv.append(draft);
    }

    var bodyContainer = document.createElement('div');
    bodyContainer.classList.add('message-body');
    // Rather than have nested scrollbars, clip overflow. This matches gmail.
    bodyContainer.style.overflowY = 'hidden';
    bodyContainer.style.overflowX = 'auto';
    bodyContainer.append(processedMessage.getQuoteElidedMessage().getDom());

    messageDiv.append(headerDiv, bodyContainer);
    return messageDiv;
  }

  appendAddresses_(container: HTMLElement, name: string, value: string) {
    let div = document.createElement('div');
    div.style.cssText = `overflow: hidden;`;
    let b = document.createElement('b');
    b.append(`${name}: `);
    div.append(b, value);
    container.append(div);
  }

  private dateString_(date: Date) {
    let formatter: Intl.DateTimeFormat;
    let today = new Date();
    if (today.getFullYear() != date.getFullYear()) {
      formatter = DIFFERENT_YEAR_FORMATTER;
    } else if (
        today.getMonth() != date.getMonth() ||
        today.getDate() != date.getDate()) {
      formatter = DIFFERENT_DAY_FORMATTER;
    } else {
      formatter = SAME_DAY_FORMATTER;
    }
    return formatter.format(date);
  }
}
window.customElements.define('mt-rendered-thread', RenderedThread);
