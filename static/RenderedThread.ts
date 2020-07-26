import {Action} from './Actions.js';
import {assert, collapseArrow, expandArrow, notNull} from './Base.js';
import {Message} from './Message.js';
import {QuoteElidedMessage} from './QuoteElidedMessage.js';
import {Thread} from './Thread.js';
import {NEXT_FULL_ACTION, PREVIOUS_FULL_ACTION} from './views/ThreadListView.js';
import {NEXT_ACTION, PREVIOUS_ACTION} from './views/ThreadListViewBase.js';

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
      color: var(--thread-text-color);
      position: absolute;
      left: 0;
      right: 0;
      max-width: var(--max-width);
      margin: auto;
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
        background-color: var(--border-and-hover-color);
      `;
      this.append(this.spinner_);
      this.spinner_.scrollIntoView({'block': 'center', 'behavior': 'smooth'});
    } else if (this.spinner_) {
      this.spinner_.remove();
    }
  }

  async render() {
    let messages = this.thread.getMessages();
    let alreadyRenderedMessages =
        [...this.children].filter(x => x.classList.contains('message'));
    for (let i = 0; i < messages.length; i++) {
      let quoteElidedMessage = await messages[i].getQuoteElidedMessage();
      if (this.contains(quoteElidedMessage))
        continue;

      let rendered = this.renderMessage_(messages[i], quoteElidedMessage);
      if (this.childElementCount == 0)
        rendered.style.border = '0';

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
        message = notNull(this.focused_).nextElementSibling;
        if (!message)
          return;
        break;

      case NEXT_FULL_ACTION:
        message = notNull(this.lastElementChild);
        break;

      case PREVIOUS_ACTION:
        message = notNull(this.focused_).previousElementSibling;
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
    this.focused_ = message as HTMLElement;
    this.focused_.style.backgroundImage = 'paint(header-focus)';
    this.getHeader_(this.focused_).scrollIntoView(options);
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

  renderMessage_(
      processedMessage: Message, quoteElidedMessage: QuoteElidedMessage) {
    var messageDiv = document.createElement('div');
    messageDiv.style.cssText = `
      padding: 8px;
      word-break: break-word;
      margin: 16px 0 24px;
      box-shadow: 0px 0px 8px var(--border-and-hover-color);
      background-color: var(--thread-background-color);
    `;
    messageDiv.className = 'message';
    messageDiv.classList.add(processedMessage.isUnread ? 'unread' : 'read');

    var headerDiv = document.createElement('div');
    headerDiv.classList.add('headers');
    headerDiv.style.cssText = `
      white-space: pre-wrap;
      margin-bottom: 16px;
    `;

    let from = document.createElement('div');
    from.className = 'contains-pii';
    from.style.flex = '1';

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

    let date = document.createElement('div');
    date.style.color = 'var(--dim-text-color)';
    date.append(this.dateString_(processedMessage.date));

    let topRow = document.createElement('div');
    topRow.style.cssText = `
      display: flex;
      margin-bottom: 4px;
    `;
    topRow.append(from, date);

    let to = document.createElement('div');
    to.style.cssText = `
      cursor: pointer;
      overflow: hidden;
    `;

    let expander = document.createElement('span');
    expander.classList.add('expander');
    expander.style.cssText = `
      cursor: pointer;
      font-size: 75%;
      width: 18px;
      margin-left: -2px;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      -webkit-user-select: none;
      border-radius: 3px;
    `;

    let bottomRow = document.createElement('div');
    bottomRow.style.cssText = `
      display: flex;
      align-items: center;
      color: var(--dim-text-color);
      font-size: 90%;
    `;
    bottomRow.append(expander, to);

    let toggleClamp = () => {
      let shouldMinify = to.style.whiteSpace !== 'nowrap';
      to.style.whiteSpace = shouldMinify ? 'nowrap' : '';
      expander.textContent = '';
      expander.append(shouldMinify ? expandArrow() : collapseArrow());
      bottomRow.style.fontSize = shouldMinify ? '90%' : '';
      this.renderTo_(processedMessage, to, shouldMinify);
    };
    to.addEventListener('click', toggleClamp);
    expander.addEventListener('click', toggleClamp);
    toggleClamp();

    headerDiv.append(topRow, bottomRow);

    if (processedMessage.isDraft) {
      let draft = document.createElement('div');
      draft.style.cssText = `
        font-weight: bold;
        margin-top: 10px;
      `;
      draft.append('DRAFT MESSAGE');
      headerDiv.append(draft);
    }

    var bodyContainer = document.createElement('div');
    bodyContainer.className = 'message-body contains-pii';
    // Rather than have nested scrollbars, clip overflow. This matches gmail.
    bodyContainer.style.overflowY = 'hidden';
    bodyContainer.style.overflowX = 'auto';
    bodyContainer.append(quoteElidedMessage);

    messageDiv.append(headerDiv, bodyContainer);
    return messageDiv;
  }

  renderTo_(
      processedMessage: Message, container: HTMLElement,
      shouldMinify: boolean) {
    container.textContent = '';

    if (processedMessage.to) {
      this.appendAddresses_(
          container, 'to',
          shouldMinify ? Message.minifyAddressList(processedMessage.parsedTo) :
                         processedMessage.to);
    }
    if (processedMessage.cc) {
      this.appendAddresses_(
          container, 'cc',
          shouldMinify ? Message.minifyAddressList(processedMessage.parsedCc) :
                         processedMessage.cc);
    }
    if (processedMessage.bcc) {
      this.appendAddresses_(
          container, 'bcc',
          shouldMinify ? Message.minifyAddressList(processedMessage.parsedBcc) :
                         processedMessage.bcc);
    }
  }

  appendAddresses_(container: HTMLElement, name: string, value: string) {
    let div = document.createElement('div');
    let b = document.createElement('b');
    b.append(`${name}: `);
    let valueContainer = document.createElement('span');
    valueContainer.className = 'contains-pii';
    valueContainer.append(value);
    div.append(b, valueContainer);
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
