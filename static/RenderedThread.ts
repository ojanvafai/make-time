import {Message} from './Message.js';
import {Thread} from './Thread.js';

export class RenderedThread extends HTMLElement {
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

  // TODO: We should be listening to update events on Thread and doing
  // appendMessages instead of manually doing it here and remove the update
  // method from RenderedThread since threads can be updated outside of
  // RenderedThread and we want to update RenderedThread in those cases as well.
  async update() {
    await this.thread.update();
    this.render();
  }

  isRendered() {
    return !!this.parentNode;
  }

  render() {
    let messages = this.thread.getMessages();
    // Only append new messages.
    messages = messages.slice(this.childElementCount);
    for (let message of messages) {
      let rendered = this.renderMessage_(message);
      if (this.childElementCount == 0)
        rendered.style.border = '0';
      this.append(rendered);
    }
  }

  renderMessage_(processedMessage: Message) {
    var messageDiv = document.createElement('div');
    messageDiv.style.cssText = `
      padding: 0 8px;
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
      if (processedMessage.from.includes('<')) {
        let b = document.createElement('b');
        b.append(<string>processedMessage.fromName);
        from.append(b, ' <', (<string[]>processedMessage.fromEmails)[0], '>');
      } else {
        from.append(processedMessage.from);
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

  dateString_(date: Date) {
    let options: {[property: string]: string} = {
      hour: 'numeric',
      minute: 'numeric',
    };

    let today = new Date();
    if (today.getFullYear() != date.getFullYear())
      options.year = 'numeric';

    if (today.getMonth() != date.getMonth() ||
        today.getDate() != date.getDate()) {
      options.month = 'short';
      options.day = 'numeric';
    }

    return date.toLocaleString(undefined, options);
  }
}
window.customElements.define('mt-rendered-thread', RenderedThread);
