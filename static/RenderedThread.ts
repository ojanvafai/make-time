import {notNull, parseAddressList} from './Base.js';
import {Message} from './Message.js';
import {Thread} from './Thread.js';

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

export class RenderedThread extends HTMLElement {
  private spinner_: HTMLElement|undefined;

  constructor(public thread: Thread) {
    super();
    this.style.cssText = `
      background-color: white;
      position: absolute;
      left: 0;
      right: 0;
      max-width: 1000px;
    `;
  }

  isRendered() {
    return !!this.parentNode;
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

  firstUnreadMessageHeader() {
    let message = this.querySelector('.unread');
    if (!message)
      return null;
    return this.getHeader_(message);
  }

  lastMessageHeader() {
    return this.getHeader_(notNull(this.lastElementChild));
  }

  getHeader_(message: Element) {
    return notNull(message.querySelector('.headers'));
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
      font-size: 90%;
      color: grey;
      display: flex;
    `;

    let from = document.createElement('div');
    from.style.cssText = `color: black`;

    if (processedMessage.from) {
      let parsed = parseAddressList(processedMessage.from)[0];
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
      font-size: 90%;
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
        color: black;
        font-weight: bold;
        margin-top: 10px;
      `;
      draft.append('DRAFT MESSAGE');
      headerDiv.append(draft);
    }

    var bodyContainer = document.createElement('div');
    bodyContainer.classList.add('message-body');
    bodyContainer.style.overflow = 'auto';
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
