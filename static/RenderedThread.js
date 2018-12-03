export class RenderedThread {
  constructor(thread) {
    this.thread = thread;
    this.dom_ = null;
    this.queued_ = [];
  }

  queueTillRendered_() {
    return new Promise(resolve => this.queued_.push(resolve));
  }

  processRenderingQueue_() {
    for (let request of this.queued_) {
      request();
    }
    this.queued_ = [];
  }

  remove() {
    this.dom_.remove();
  }

  async update() {
    await this.thread.updateMessageDetails(true);
    await this.appendMessages_();
  }

  async appendMessages_() {
    if (!this.dom_) {
      this.dom_ = document.createElement('div');
      this.dom_.style.cssText = `
        background-color: white;
        position: absolute;
        left: 0;
        right: 0;
        max-width: 1000px;
      `;
    }

    let messages = await this.thread.getMessages();
    // Only append new messages.
    messages = messages.slice(this.dom_.childElementCount);
    for (let message of messages) {
      let rendered = this.renderMessage_(message);
      if (this.dom_.childElementCount == 0)
        rendered.style.border = '0';
      this.dom_.append(rendered);
    }
  }

  async render(newContainer) {
    // No need to block on fetching messages if we've already rendering some of them.
    if (this.dom_) {
      // Intentionally don't await this so the messages are rendered ASAP.
      this.update();
    } else {
      await this.fetchAndAppendMessages_();
    }

    if (this.dom_.parentNode != newContainer)
      newContainer.append(this.dom_);

    return this.dom_;
  }

  async fetchAndAppendMessages_() {
    // If we're in the middle of rendering this thread, then queue up rendering requests
    // to be processed when we finish instead of kicking off another set of network requests
    // to render this thread.
    if (this.isFetching_) {
      await this.queueTillRendered_();
      return;
    }

    this.isFetching_ = true;
    await this.appendMessages_();
    this.isFetching_ = false;

    this.processRenderingQueue_();
  }

  renderMessage_(processedMessage) {
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

    if (processedMessage.from.includes('<')) {
      let b = document.createElement('b');
      b.append(processedMessage.fromName);
      from.append(b, ' <', processedMessage.fromEmails[0], '>');
    } else {
      from.append(processedMessage.from);
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
      let existing = window.getComputedStyle(to)['-webkit-line-clamp'];
      // Wow. Setting this to 'none' doens't work. But setting it to 'unset'
      // returns 'none' from computed style.
      to.style['-webkit-line-clamp'] = existing == 'none' ? '1' : 'unset';
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

  appendAddresses_(container, name, value) {
    let div = document.createElement('div');
    div.style.cssText = `overflow: hidden;`;
    let b = document.createElement('b');
    b.append(`${name}: `);
    div.append(b, value);
    container.append(div);
  }

  dateString_(date) {
    let options = {
      hour: 'numeric',
      minute: 'numeric',
    };

    let today = new Date();
    if (today.getFullYear() != date.getFullYear())
      options.year = 'numeric';

    if (today.getMonth() != date.getMonth() || today.getDate() != date.getDate()) {
      options.month = 'short';
      options.day = 'numeric';
    }

    return date.toLocaleString(undefined, options);
  }
}
